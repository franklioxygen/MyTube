import { ValidationError } from "../errors/DownloadErrors";
import { buildBilibiliDownloadTask } from "./bilibiliDownloadTask";
import * as downloadService from "./downloadService";
import downloadManager from "./downloadManager";
import { createDownloadModeRetryMetadata } from "./downloadRetryMetadata";
import { normalizeMediaType } from "./storageService/types";
import type { Video } from "./storageService/types";
import * as storageService from "./storageService";
import {
  recordEvent,
  normalizeSurface,
  platformFromUrl,
} from "./statistics";
import {
  getMissAVPlaceholderTitle,
  isBilibiliUrl,
  isMissAVUrl,
  isTwitchVideoUrl,
  isYouTubeUrl,
  isValidUrl,
  processVideoUrl,
  trimBilibiliUrl,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import { validateUrl } from "../utils/security";
import { normalizeAudioFormat } from "../types/settings";
import {
  auditMediaCollisions,
  type MediaCollisionAuditReason,
  type MediaCollisionRecommendedAction,
  type MediaSourceTrackingAuditReason,
} from "./mediaCollisionAuditService";

export type MediaCollisionRepairAction = "redownload";
export type MediaCollisionRepairReason =
  | MediaCollisionAuditReason
  | MediaSourceTrackingAuditReason;

export interface MediaCollisionRepairRequest {
  localVideoId: string;
  action: MediaCollisionRepairAction;
  confirm?: boolean;
}

export interface MediaCollisionRepairFinding {
  normalizedPath: string | null;
  reasons: MediaCollisionRepairReason[];
  recommendedAction: MediaCollisionRecommendedAction;
}

export interface MediaCollisionRepairPreview {
  localVideoId: string;
  action: MediaCollisionRepairAction;
  title: string;
  author?: string;
  sourceUrl: string;
  sourceVideoId: string | null;
  platform: string;
  mediaType: "video" | "audio";
  currentVideoPath: string | null;
  findings: MediaCollisionRepairFinding[];
  requiresConfirmation: true;
}

export interface MediaCollisionRepairResult {
  applied: boolean;
  preview: MediaCollisionRepairPreview;
  queuedDownload?: {
    downloadId: string;
    sourceUrl: string;
    downloadType: string;
  };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAction(value: unknown): MediaCollisionRepairAction | null {
  return value === "redownload" ? "redownload" : null;
}

function buildInitialTitle(video: Video, resolvedUrl: string): string {
  const title = readNonEmptyString(video.title);
  if (title) {
    return title;
  }
  if (isYouTubeUrl(resolvedUrl)) {
    return "YouTube Video";
  }
  if (isBilibiliUrl(resolvedUrl)) {
    return "Bilibili Video";
  }
  if (isTwitchVideoUrl(resolvedUrl)) {
    return "Twitch Video";
  }
  if (isMissAVUrl(resolvedUrl)) {
    return getMissAVPlaceholderTitle(resolvedUrl);
  }
  return "Media Collision Repair";
}

function getDownloadType(resolvedUrl: string): string {
  if (isMissAVUrl(resolvedUrl)) {
    return "missav";
  }
  if (isBilibiliUrl(resolvedUrl)) {
    return "bilibili";
  }
  return "youtube";
}

function collectRedownloadFindings(
  localVideoId: string
): MediaCollisionRepairFinding[] {
  const audit = auditMediaCollisions();
  const findings: MediaCollisionRepairFinding[] = [];

  for (const item of audit.items) {
    if (
      item.recommendedAction !== "redownload" ||
      !item.localVideoIds.includes(localVideoId)
    ) {
      continue;
    }

    findings.push({
      normalizedPath: item.normalizedPath,
      reasons: item.reasons,
      recommendedAction: item.recommendedAction,
    });
  }

  for (const issue of audit.sourceTrackingIssues) {
    if (
      issue.localVideoId !== localVideoId ||
      issue.recommendedAction !== "redownload"
    ) {
      continue;
    }

    findings.push({
      normalizedPath: issue.videoPath ?? null,
      reasons: [issue.reason],
      recommendedAction: "redownload",
    });
  }

  return findings;
}

async function resolveRepairDownloadInput(video: Video): Promise<{
  resolvedUrl: string;
  sourceVideoId: string | null;
  platform: string;
}> {
  const sourceUrl = readNonEmptyString(video.sourceUrl);
  if (!sourceUrl) {
    throw new ValidationError(
      "Selected video does not have a source URL to redownload",
      "localVideoId",
    );
  }

  const { videoUrl, sourceVideoId, platform } = await processVideoUrl(sourceUrl);
  const validatedUrl = validateUrl(videoUrl);
  if (!isValidUrl(validatedUrl)) {
    throw new ValidationError(
      "Selected video source URL is not a valid URL",
      "localVideoId",
    );
  }

  return {
    resolvedUrl: isBilibiliUrl(validatedUrl)
      ? trimBilibiliUrl(validatedUrl)
      : validatedUrl,
    sourceVideoId: readNonEmptyString(sourceVideoId),
    platform: readNonEmptyString(platform) ?? platformFromUrl(validatedUrl),
  };
}

async function queueRedownload(
  video: Video,
  preview: MediaCollisionRepairPreview,
): Promise<MediaCollisionRepairResult["queuedDownload"]> {
  const settings = storageService.getSettings();
  const audioFormat = normalizeAudioFormat(settings?.audioFormat);
  const effectiveAudioOnly =
    preview.mediaType === "audio" && !isMissAVUrl(preview.sourceUrl);
  const downloadType = getDownloadType(preview.sourceUrl);
  const downloadId = `${Date.now()}-repair-${video.id}`;
  const initialTitle = buildInitialTitle(video, preview.sourceUrl);

  const enqueuedEventId = recordEvent({
    eventType: "download_enqueued",
    actorRole: "admin",
    surface: normalizeSurface("web"),
    sessionId: null,
    relatedEventId: null,
    platform: platformFromUrl(preview.sourceUrl),
    sourceKind: "manual",
    payload: {
      repairAction: preview.action,
      repairSource: "media_collision_audit",
      localVideoId: preview.localVideoId,
      reasons: preview.findings.flatMap((finding) => finding.reasons),
    },
  });

  const retryMetadata =
    effectiveAudioOnly && downloadType !== "missav"
      ? createDownloadModeRetryMetadata({ audioOnly: true, audioFormat })
      : undefined;

  const downloadTask = async (registerCancel: (cancel: () => void) => void) => {
    if (downloadType === "bilibili") {
      return buildBilibiliDownloadTask({
        downloadUrl: preview.sourceUrl,
        downloadId,
        initialTitle,
        audioOnly: effectiveAudioOnly,
        audioFormat,
        onTitleUpdate: (id, title) => {
          storageService.updateActiveDownloadTitle(id, title);
          downloadManager.updateTaskTitle(id, title);
        },
      })(registerCancel);
    }

    if (downloadType === "missav") {
      const videoData = await downloadService.downloadMissAVVideo(
        preview.sourceUrl,
        downloadId,
        registerCancel,
      );
      return { success: true, video: videoData };
    }

    const videoData = effectiveAudioOnly
      ? await downloadService.downloadYouTubeVideo(preview.sourceUrl, {
          downloadId,
          onStart: registerCancel,
          audioOnly: true,
          audioFormat,
        })
      : await downloadService.downloadYouTubeVideo(
          preview.sourceUrl,
          downloadId,
          registerCancel,
        );
    return { success: true, video: videoData };
  };

  downloadManager
    .addDownload(
      downloadTask,
      downloadId,
      initialTitle,
      preview.sourceUrl,
      downloadType,
      {
        actorRole: "admin",
        surface: "web",
        sourceKind: "manual",
        relatedEventId: null,
        enqueuedEventId,
      },
      retryMetadata,
    )
    .then((result: unknown) => {
      logger.info("Media collision repair redownload completed:", result);
    })
    .catch((error: unknown) => {
      logger.error("Media collision repair redownload failed:", error);
    });

  return {
    downloadId,
    sourceUrl: preview.sourceUrl,
    downloadType,
  };
}

export async function repairMediaCollisionFinding(
  input: MediaCollisionRepairRequest,
): Promise<MediaCollisionRepairResult> {
  const localVideoId = readNonEmptyString(input.localVideoId);
  if (!localVideoId) {
    throw new ValidationError("localVideoId is required", "localVideoId");
  }

  const action = normalizeAction(input.action);
  if (!action) {
    throw new ValidationError("Unsupported media collision repair action", "action");
  }

  const video = storageService.getVideoById(localVideoId);
  if (!video) {
    throw new ValidationError("Selected video was not found", "localVideoId");
  }

  const findings = collectRedownloadFindings(localVideoId);
  if (findings.length === 0) {
    throw new ValidationError(
      "Selected video does not have an audit finding that can be repaired by redownload",
      "localVideoId",
    );
  }

  const { resolvedUrl, sourceVideoId, platform } =
    await resolveRepairDownloadInput(video);
  const preview: MediaCollisionRepairPreview = {
    localVideoId,
    action,
    title: video.title,
    author: readNonEmptyString(video.author) ?? undefined,
    sourceUrl: resolvedUrl,
    sourceVideoId,
    platform,
    mediaType: normalizeMediaType(video.mediaType),
    currentVideoPath: readNonEmptyString(video.videoPath),
    findings,
    requiresConfirmation: true,
  };

  if (input.confirm !== true) {
    return {
      applied: false,
      preview,
    };
  }

  const queuedDownload = await queueRedownload(video, preview);
  return {
    applied: true,
    preview,
    queuedDownload,
  };
}
