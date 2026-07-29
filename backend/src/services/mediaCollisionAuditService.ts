import type { MediaIdentity } from "./filenameTemplate/outputPathAllocator";
import {
  canonicalizeManagedPath,
  resolveManagedWebPath,
} from "./filenameTemplate/pathHelpers";
import * as storageService from "./storageService";
import type { MediaType, Video } from "./storageService/types";
import { normalizeMediaType } from "./storageService/types";
import { extractSourceVideoId } from "../utils/helpers";
import { pathExistsSafeSync } from "../utils/security";

export type MediaCollisionAuditReason =
  | "duplicate_path"
  | "missing_file"
  | "companion_path_collision"
  | "invalid_managed_path";

export type MediaSourceTrackingAuditReason =
  | "missing_source_video_id"
  | "source_video_id_mismatch"
  | "unresolvable_source_video_id";

export type MediaCollisionRecoverability =
  | "intact_single_owner"
  | "ambiguous_overwrite"
  | "missing";

export type MediaCollisionRecommendedAction =
  | "none"
  | "batch_rename"
  | "redownload";

export type MediaCollisionArtifactType = "video" | "thumbnail" | "subtitle";

export interface MediaCollisionAuditIdentity extends MediaIdentity {
  localVideoId: string;
}

export interface MediaCollisionAuditArtifact {
  artifactType: MediaCollisionArtifactType;
  language?: string;
  localVideoId: string;
  webPath: string;
  absolutePath: string | null;
  fileExists: boolean;
}

export interface MediaCollisionAuditItem {
  normalizedPath: string;
  fileExists: boolean;
  localVideoIds: string[];
  identities: Array<MediaCollisionAuditIdentity | null>;
  artifacts: MediaCollisionAuditArtifact[];
  reasons: MediaCollisionAuditReason[];
  recoverability: MediaCollisionRecoverability;
  recommendedAction: MediaCollisionRecommendedAction;
}

export interface MediaSourceTrackingAuditItem {
  localVideoId: string;
  sourceUrl: string;
  platform: string;
  storedSourceVideoId: string | null;
  derivedSourceVideoId: string | null;
  videoPath: string | null;
  reason: MediaSourceTrackingAuditReason;
  recommendedAction: "redownload" | "manual_review";
}

export interface MediaCollisionAuditSummary {
  totalVideos: number;
  managedArtifacts: number;
  skippedExternalArtifacts: number;
  duplicatePathGroups: number;
  missingArtifacts: number;
  invalidManagedPaths: number;
  sourceTrackingIssues: number;
}

export interface MediaCollisionAuditResult {
  generatedAt: string;
  summary: MediaCollisionAuditSummary;
  items: MediaCollisionAuditItem[];
  sourceTrackingIssues: MediaSourceTrackingAuditItem[];
  humanSummary: string;
}

type ArtifactCandidate = {
  artifactType: MediaCollisionArtifactType;
  language?: string;
  webPath: string;
};

type ArtifactRef = MediaCollisionAuditArtifact & {
  normalizedPath: string;
  identity: MediaCollisionAuditIdentity | null;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPartNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value > 0 ? Math.trunc(value) : null;
}

function normalizePlatform(value: string | null): string {
  return value ? value.toLocaleLowerCase() : "unknown";
}

function buildIdentity(video: Video): MediaCollisionAuditIdentity | null {
  const sourceUrl = readString(video.sourceUrl);
  const derived = sourceUrl ? extractSourceVideoId(sourceUrl) : null;
  const sourceVideoId =
    readString(video.sourceVideoId) || readString(derived?.id) || null;
  const platform = normalizePlatform(
    readString(derived?.platform) || readString(video.source)
  );
  const mediaType: MediaType = normalizeMediaType(video.mediaType);

  if (!sourceVideoId && platform === "unknown") {
    return null;
  }

  return {
    platform,
    sourceVideoId,
    mediaType,
    partNumber: readPartNumber(video.partNumber),
    localVideoId: video.id,
  };
}

function collectArtifactCandidates(video: Video): ArtifactCandidate[] {
  const candidates: ArtifactCandidate[] = [];
  const videoPath = readString(video.videoPath);
  const thumbnailPath = readString(video.thumbnailPath);

  if (videoPath) {
    candidates.push({ artifactType: "video", webPath: videoPath });
  }
  if (thumbnailPath) {
    candidates.push({ artifactType: "thumbnail", webPath: thumbnailPath });
  }

  for (const subtitle of video.subtitles || []) {
    const subtitlePath = readString(subtitle?.path);
    if (!subtitlePath) {
      continue;
    }
    candidates.push({
      artifactType: "subtitle",
      language: readString(subtitle.language) || undefined,
      webPath: subtitlePath,
    });
  }

  return candidates;
}

function isManagedPathCandidate(webPath: string): boolean {
  return (
    webPath.startsWith("/videos/") ||
    webPath.startsWith("/images/") ||
    webPath.startsWith("/subtitles/")
  );
}

function resolveArtifact(
  video: Video,
  identity: MediaCollisionAuditIdentity | null,
  candidate: ArtifactCandidate
): ArtifactRef | { skipped: true } {
  if (!isManagedPathCandidate(candidate.webPath)) {
    return { skipped: true };
  }

  const resolved = resolveManagedWebPath(candidate.webPath);
  if (!resolved) {
    return {
      ...candidate,
      localVideoId: video.id,
      absolutePath: null,
      fileExists: false,
      identity,
      normalizedPath: canonicalizeManagedPath(candidate.webPath),
    };
  }

  let fileExists = false;
  try {
    fileExists = pathExistsSafeSync(resolved.absolutePath, resolved.rootDir);
  } catch {
    fileExists = false;
  }

  return {
    ...candidate,
    localVideoId: video.id,
    absolutePath: resolved.absolutePath,
    fileExists,
    identity,
    normalizedPath: canonicalizeManagedPath(candidate.webPath),
  };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function uniqueIdentities(
  refs: ArtifactRef[]
): Array<MediaCollisionAuditIdentity | null> {
  const seen = new Set<string>();
  const identities: Array<MediaCollisionAuditIdentity | null> = [];

  for (const ref of refs) {
    const key = ref.identity
      ? JSON.stringify({
          platform: ref.identity.platform,
          sourceVideoId: ref.identity.sourceVideoId,
          mediaType: ref.identity.mediaType,
          partNumber: ref.identity.partNumber ?? null,
          localVideoId: ref.identity.localVideoId,
        })
      : `null:${ref.localVideoId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    identities.push(ref.identity);
  }

  return identities;
}

function buildAuditItem(
  normalizedPath: string,
  refs: ArtifactRef[],
  reasons: MediaCollisionAuditReason[]
): MediaCollisionAuditItem {
  const localVideoIds = uniqueSorted(refs.map((ref) => ref.localVideoId));
  const fileExists = refs.some((ref) => ref.fileExists);
  const hasMissing = refs.some((ref) => !ref.fileExists);
  const hasDuplicate = reasons.includes("duplicate_path");

  const recoverability: MediaCollisionRecoverability = hasMissing
    ? "missing"
    : hasDuplicate
    ? "ambiguous_overwrite"
    : "intact_single_owner";
  const recommendedAction: MediaCollisionRecommendedAction = hasMissing
    ? "redownload"
    : hasDuplicate
    ? "redownload"
    : reasons.includes("companion_path_collision")
    ? "batch_rename"
    : "none";

  return {
    normalizedPath,
    fileExists,
    localVideoIds,
    identities: uniqueIdentities(refs),
    artifacts: refs.map(
      ({ artifactType, language, localVideoId, webPath, absolutePath, fileExists }) => ({
        artifactType,
        language,
        localVideoId,
        webPath,
        absolutePath,
        fileExists,
      })
    ),
    reasons,
    recoverability,
    recommendedAction,
  };
}

function findSourceTrackingIssue(
  video: Video
): MediaSourceTrackingAuditItem | null {
  const sourceUrl = readString(video.sourceUrl);
  if (!sourceUrl) {
    return null;
  }

  const storedSourceVideoId = readString(video.sourceVideoId);
  const derived = extractSourceVideoId(sourceUrl);
  const derivedSourceVideoId = readString(derived.id);
  let reason: MediaSourceTrackingAuditReason | null = null;

  if (storedSourceVideoId && derivedSourceVideoId && storedSourceVideoId !== derivedSourceVideoId) {
    reason = "source_video_id_mismatch";
  } else if (!storedSourceVideoId && derivedSourceVideoId) {
    reason = "missing_source_video_id";
  } else if (storedSourceVideoId && !derivedSourceVideoId) {
    reason = "unresolvable_source_video_id";
  }

  if (!reason) {
    return null;
  }

  return {
    localVideoId: video.id,
    sourceUrl,
    platform: normalizePlatform(readString(derived.platform)),
    storedSourceVideoId,
    derivedSourceVideoId,
    videoPath: readString(video.videoPath),
    reason,
    recommendedAction:
      reason === "source_video_id_mismatch" ? "manual_review" : "redownload",
  };
}

function buildHumanSummary(summary: MediaCollisionAuditSummary): string {
  return [
    `Scanned ${summary.totalVideos} video rows and ${summary.managedArtifacts} managed artifacts.`,
    `Found ${summary.duplicatePathGroups} duplicate path groups, ${summary.missingArtifacts} missing managed artifacts, ${summary.invalidManagedPaths} invalid managed paths, and ${summary.sourceTrackingIssues} source tracking issues.`,
  ].join(" ");
}

export function auditMediaCollisions(): MediaCollisionAuditResult {
  const videos = storageService.getVideos();
  const refsByPath = new Map<string, ArtifactRef[]>();
  const invalidRefs: ArtifactRef[] = [];
  const sourceTrackingIssues: MediaSourceTrackingAuditItem[] = [];
  let skippedExternalArtifacts = 0;

  for (const video of videos) {
    const identity = buildIdentity(video);
    const sourceTrackingIssue = findSourceTrackingIssue(video);
    if (sourceTrackingIssue) {
      sourceTrackingIssues.push(sourceTrackingIssue);
    }

    for (const candidate of collectArtifactCandidates(video)) {
      const ref = resolveArtifact(video, identity, candidate);
      if ("skipped" in ref) {
        skippedExternalArtifacts += 1;
        continue;
      }

      if (!ref.absolutePath) {
        invalidRefs.push(ref);
      }

      const existing = refsByPath.get(ref.normalizedPath) || [];
      existing.push(ref);
      refsByPath.set(ref.normalizedPath, existing);
    }
  }

  const items: MediaCollisionAuditItem[] = [];
  let duplicatePathGroups = 0;
  let missingArtifacts = 0;

  for (const [normalizedPath, refs] of refsByPath.entries()) {
    const reasons: MediaCollisionAuditReason[] = [];
    const localVideoIds = uniqueSorted(refs.map((ref) => ref.localVideoId));
    const artifactTypes = uniqueSorted(refs.map((ref) => ref.artifactType));
    const invalidPathCount = refs.filter((ref) => !ref.absolutePath).length;
    const missingCount = refs.filter((ref) => !ref.fileExists).length;

    if (localVideoIds.length > 1) {
      reasons.push("duplicate_path");
      duplicatePathGroups += 1;
    }
    if (artifactTypes.length > 1) {
      reasons.push("companion_path_collision");
    }
    if (missingCount > 0) {
      reasons.push("missing_file");
      missingArtifacts += missingCount;
    }
    if (invalidPathCount > 0) {
      reasons.push("invalid_managed_path");
    }

    if (reasons.length === 0) {
      continue;
    }

    items.push(buildAuditItem(normalizedPath, refs, reasons));
  }

  const summary: MediaCollisionAuditSummary = {
    totalVideos: videos.length,
    managedArtifacts: Array.from(refsByPath.values()).reduce(
      (count, refs) => count + refs.length,
      0
    ),
    skippedExternalArtifacts,
    duplicatePathGroups,
    missingArtifacts,
    invalidManagedPaths: invalidRefs.length,
    sourceTrackingIssues: sourceTrackingIssues.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    summary,
    items,
    sourceTrackingIssues,
    humanSummary: buildHumanSummary(summary),
  };
}
