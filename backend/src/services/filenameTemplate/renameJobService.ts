import path from "path";
import { db } from "../../db";
import { downloadHistory, videos } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { LEGACY_DOWNLOAD_FILENAME_TEMPLATE } from "../../types/settings";
import { logger } from "../../utils/logger";
import {
  pathExistsSafeSync,
  resolveSafeChildPath,
} from "../../utils/security";
import {
  removeMediaServerArtifactsForVideo,
  syncMediaServerArtifactsForRecord,
  syncMediaServerShowArtifactsForShowRoot,
} from "../mediaServerExport";
import { moveSmallThumbnailMirrorSync } from "../thumbnailMirrorService";
import * as storageService from "../storageService";
import { bumpVideosListRevision } from "../storageService/videoListRevision";
import { buildContextFromVideoRecord } from "./contextBuilder";
import { resolveManagedWebPath } from "./pathHelpers";
import { planMediaServerExportPaths } from "../mediaServerExport/pathPlanner";
import {
  resolveFilenameNamingConfig,
  toFilenameNamingRuntimeConfig,
} from "./config";
import { planVideoOutputPaths } from "./renderer";
import { acquireRenameLock, releaseRenameLock } from "./renameLockService";
import {
  assignDateCollisionIndexes,
  buildStoredSourceOptionsMap,
} from "./sourceOptions";
import { FilenameTemplateSourceOptions } from "./types";
import { Video } from "../storageService/types";
import {
  allocateOutputFamilySync,
  moveOutputFamilyWithJournalSync,
} from "./outputPathAllocator";

export interface RenameJobItem {
  videoId: string;
  title: string;
  status: "pending" | "success" | "skipped" | "failed";
  skipReason?: string;
  error?: string;
  oldVideoPath?: string;
  newVideoPath?: string;
}

export interface RenameJob {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  lockedAt: number;
  template: string;
  total: number;
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  currentVideoId?: string;
  currentTitle?: string;
  items: RenameJobItem[];
  cancelRequested: boolean;
}

// The active job snapshot is kept in-process for UI polling. It is cleared by
// server restarts and is not shared with other app instances.
let activeJob: RenameJob | null = null;

export function getActiveRenameJob(): RenameJob | null {
  return activeJob;
}

export function getRenameJobById(jobId: string): RenameJob | null {
  if (activeJob && activeJob.id === jobId) return activeJob;
  return null;
}

export function cancelRenameJob(jobId: string): boolean {
  if (!activeJob || activeJob.id !== jobId) return false;
  activeJob.cancelRequested = true;
  return true;
}

/**
 * Starts a batch rename job.
 * Returns the job on success or throws if a job is already running or prerequisites aren't met.
 */
export async function startRenameJob(
  settings: {
    downloadFilenameMode?: string;
    downloadFilenamePresetId?: string;
    downloadFilenameTemplate?: string;
  },
  moveThumbnailsToVideoFolder: boolean,
  moveSubtitlesToVideoFolder: boolean
): Promise<RenameJob> {
  if (activeJob && activeJob.status === "running") {
    throw new Error("A rename job is already running.");
  }

  // Per design §23, the rename job runs for any saved preset including
  // "legacy" — the planner falls back to formatVideoFilename for legacy so
  // already-legacy files are detected as no-ops and the job is safe to re-run.
  const resolvedNaming = resolveFilenameNamingConfig(settings);
  const template =
    resolvedNaming.mode === "legacy"
      ? LEGACY_DOWNLOAD_FILENAME_TEMPLATE
      : resolvedNaming.template || "";

  const jobId = `rename_${Date.now()}`;
  const now = Date.now();

  if (!acquireRenameLock(jobId)) {
    throw new Error("Could not acquire rename lock.");
  }

  // Snapshot all videos
  const allVideos = storageService.getVideos();
  const job: RenameJob = {
    id: jobId,
    status: "running",
    lockedAt: now,
    template,
    total: allVideos.length,
    processed: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    items: [],
    cancelRequested: false,
  };
  activeJob = job;

  // Run the job asynchronously
  processRenameJob(
    job,
    allVideos,
    settings,
    moveThumbnailsToVideoFolder,
    moveSubtitlesToVideoFolder
  ).catch((err) => {
    logger.error("Rename job process error:", err);
    if (activeJob && activeJob.id === jobId) {
      activeJob.status = "failed";
      releaseRenameLock();
    }
  });

  return job;
}

/**
 * For each video in the snapshot, precompute the FilenameTemplateSourceOptions
 * the renderer needs. Without this, buildContextFromVideoRecord falls back to
 * sourceCollectionType="unknown" and mediaPlaylistIndex=undefined, which makes
 * presets like channel_year_date_index render "...e<MMDD>00" for every same-day
 * item. Per design §16 step 3, the rename job is responsible for sourcing this
 * context from the video's collection membership and computing date-collision
 * indexes from the snapshot.
 */
function precomputeSourceOptions(
  allVideos: Video[]
): Map<string, FilenameTemplateSourceOptions> {
  const sourceOptionsByVideoId = buildStoredSourceOptionsMap(allVideos);
  assignDateCollisionIndexes(allVideos, sourceOptionsByVideoId);
  return sourceOptionsByVideoId;
}

type ManagedSubtitleTarget = {
  currentPath: string;
  currentRootDir: string;
  targetPath: string;
  targetRootDir: string;
  newPath: string;
  newFilename: string;
  language: string;
};

function buildSubtitleRelativePath(
  videoRelative: string,
  subtitleFilename: string
): string {
  const videoRelativeDir = path.dirname(videoRelative);
  return videoRelativeDir && videoRelativeDir !== "."
    ? `${videoRelativeDir}/${subtitleFilename}`
    : subtitleFilename;
}

function buildManagedSubtitleTargets(
  subtitles: NonNullable<Video["subtitles"]>,
  videoRelative: string,
  subtitleBase: string
): ManagedSubtitleTarget[] {
  const managedTargets: ManagedSubtitleTarget[] = [];

  for (const subtitle of subtitles) {
    const resolved = resolveManagedWebPath(subtitle.path);
    if (!resolved) continue;

    const subtitleExt = path.extname(subtitle.filename);
    const newSubtitleFilename = `${subtitleBase}.${subtitle.language}${subtitleExt}`;
    const subtitleRelative = buildSubtitleRelativePath(
      videoRelative,
      newSubtitleFilename
    );

    if (subtitle.path.startsWith("/videos/")) {
      managedTargets.push({
        currentPath: resolved.absolutePath,
        currentRootDir: resolved.rootDir,
        targetPath: resolveSafeChildPath(VIDEOS_DIR, subtitleRelative),
        targetRootDir: VIDEOS_DIR,
        newPath: `/videos/${subtitleRelative}`,
        newFilename: newSubtitleFilename,
        language: subtitle.language,
      });
      continue;
    }

    managedTargets.push({
      currentPath: resolved.absolutePath,
      currentRootDir: resolved.rootDir,
      targetPath: resolveSafeChildPath(SUBTITLES_DIR, subtitleRelative),
      targetRootDir: SUBTITLES_DIR,
      newPath: `/subtitles/${subtitleRelative}`,
      newFilename: newSubtitleFilename,
      language: subtitle.language,
    });
  }

  return managedTargets;
}

async function processRenameJob(
  job: RenameJob,
  allVideos: Video[],
  settings: {
    downloadFilenameMode?: string;
    downloadFilenamePresetId?: string;
    downloadFilenameTemplate?: string;
  },
  moveThumbnailsToVideoFolder: boolean,
  moveSubtitlesToVideoFolder: boolean
): Promise<void> {
  const sourceOptionsByVideoId = precomputeSourceOptions(allVideos);

  for (const video of allVideos) {
    if (job.cancelRequested) {
      job.status = "cancelled";
      releaseRenameLock();
      return;
    }

    job.currentVideoId = video.id;
    job.currentTitle = video.title;

    const item = await processOneVideo(
      video,
      job,
      settings,
      moveThumbnailsToVideoFolder,
      moveSubtitlesToVideoFolder,
      sourceOptionsByVideoId.get(video.id) || {}
    );

    job.items.push(item);
    job.processed++;
    if (item.status === "success") {
      job.succeeded++;
    } else if (item.status === "skipped") {
      job.skipped++;
    } else {
      job.failed++;
    }
  }

  job.status = "completed";
  job.currentVideoId = undefined;
  job.currentTitle = undefined;
  releaseRenameLock();
}

async function processOneVideo(
  video: Video,
  job: RenameJob,
  settings: {
    downloadFilenameMode?: string;
    downloadFilenamePresetId?: string;
    downloadFilenameTemplate?: string;
  },
  moveThumbnailsToVideoFolder: boolean,
  moveSubtitlesToVideoFolder: boolean,
  sourceOptions: FilenameTemplateSourceOptions
): Promise<RenameJobItem> {
  const item: RenameJobItem = {
    videoId: video.id,
    title: video.title,
    status: "pending",
    oldVideoPath: video.videoPath || undefined,
  };

  try {
    // Resolve current local video path
    const videoPathResolved = video.videoPath
      ? resolveManagedWebPath(video.videoPath)
      : null;

    if (!videoPathResolved) {
      item.status = "skipped";
      if (video.videoPath?.startsWith("cloud:")) {
        item.skipReason = "cloud_rename_not_supported";
      } else if (video.videoPath?.startsWith("mount:")) {
        item.skipReason = "external_mount_path";
      } else if (
        video.videoPath?.startsWith("http://") ||
        video.videoPath?.startsWith("https://")
      ) {
        item.skipReason = "external_http_path";
      } else {
        item.skipReason = "no_local_video_path";
      }
      return item;
    }

    if (!pathExistsSafeSync(videoPathResolved.absolutePath, [VIDEOS_DIR])) {
      item.status = "skipped";
      item.skipReason = "video_file_missing";
      return item;
    }

    // Build context from video record + precomputed source options
    // (collection membership and per-day collision index).
    const context = buildContextFromVideoRecord(video, sourceOptions);

    // Determine video extension
    const videoExt =
      path.extname(video.videoFilename || videoPathResolved.relativePath).replace(".", "") ||
      "mp4";

    // Plan output
    const planned = planVideoOutputPaths({
      naming: toFilenameNamingRuntimeConfig(settings),
      context,
      videoExtension: videoExt,
      moveThumbnailsToVideoFolder,
      moveSubtitlesToVideoFolder,
    });

    // Check thumbnail
    const thumbResolved = video.thumbnailPath
      ? resolveManagedWebPath(video.thumbnailPath)
      : null;

    // Check subtitles
    const subtitles: typeof video.subtitles = video.subtitles || [];

    const subtitleFiles = subtitles.flatMap((subtitle) => {
      const resolved = resolveManagedWebPath(subtitle.path);
      if (!resolved) return [];
      return [
        {
          language: subtitle.language,
          extension:
            path.extname(subtitle.filename || resolved.relativePath) || ".vtt",
        },
      ];
    });
    const ownedManagedPaths = [
      videoPathResolved.absolutePath,
      ...(thumbResolved ? [thumbResolved.absolutePath] : []),
      ...subtitles.flatMap((subtitle) => {
        const resolved = resolveManagedWebPath(subtitle.path);
        return resolved ? [resolved.absolutePath] : [];
      }),
    ];

    const reservation = allocateOutputFamilySync({
      videoRelativePath: planned.video.relativePath,
      thumbnailRelativePath: planned.thumbnail.relativePath,
      subtitleBaseRelativePath: planned.subtitle.baseNameWithoutLanguageOrExt,
      subtitleBaseDir: moveSubtitlesToVideoFolder ? VIDEOS_DIR : SUBTITLES_DIR,
      subtitleFiles,
      thumbnailBaseDir: moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR,
      identity: {
        platform: context.platform || "unknown",
        sourceVideoId: context.sourceVideoId || null,
        mediaType: video.mediaType === "audio" ? "audio" : "video",
        localVideoId: video.id,
      },
      existingLocalVideoId: video.id,
      ownedManagedPaths,
      thumbnailRequired: Boolean(thumbResolved),
      subtitleRequired: subtitleFiles.length > 0,
    });

    try {
      const videoRelative = reservation.videoRelativePath;
      const thumbRelative = reservation.thumbnailRelativePath;
      const subBase = reservation.subtitleBaseRelativePath;
      const newVideoAbsPath = resolveSafeChildPath(VIDEOS_DIR, videoRelative);
      const subtitleTargets = buildManagedSubtitleTargets(
        subtitles,
        videoRelative,
        subBase
      );
      const newThumbAbsPath = thumbResolved
        ? resolveSafeChildPath(
            moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR,
            thumbRelative
          )
        : null;

      const newVideoWebPath = `/videos/${videoRelative}`;

    // Check if already at target
      const currentVideoRelative = videoPathResolved.relativePath;
      const alreadyAtTarget = currentVideoRelative === videoRelative;

    // Idempotent no-op detection: skip only if every managed file family
    // (video, thumbnail if any, every local subtitle) already resolves to its
    // planned target. Subtitles whose path is not a managed local path are
    // ignored for this check because we never move them. (Design §23.5)
      let anyChange = !alreadyAtTarget;

      if (!anyChange && thumbResolved) {
        anyChange = thumbResolved.absolutePath !== newThumbAbsPath;
      }

      if (!anyChange) {
        for (const subtitleTarget of subtitleTargets) {
          if (subtitleTarget.currentPath !== subtitleTarget.targetPath) {
            anyChange = true;
            break;
          }
        }
      }

      if (!anyChange) {
        item.status = "skipped";
        item.skipReason = "already_matches";
        return item;
      }

    // Collect moves to perform
      const moves: Array<{
        from: string;
        fromBase: string;
        to: string;
        toBase: string;
        kind?: "video" | "thumbnail" | "subtitle" | "sidecar";
      }> = [];

    // Video move
      if (!alreadyAtTarget) {
        moves.push({
          from: videoPathResolved.absolutePath,
          fromBase: VIDEOS_DIR,
          to: newVideoAbsPath,
          toBase: VIDEOS_DIR,
          kind: "video",
        });
      }

    // Thumbnail move
      let newThumbWebPath = video.thumbnailPath || null;
      let newThumbFilename = video.thumbnailFilename || null;
      if (thumbResolved) {
        const thumbTargetBase = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;
        const thumbTargetPath = newThumbAbsPath;
        if (!thumbTargetPath) {
          throw new Error("Thumbnail target path could not be resolved");
        }
        if (thumbResolved.absolutePath !== thumbTargetPath) {
          moves.push({
            from: thumbResolved.absolutePath,
            fromBase: thumbResolved.rootDir,
            to: thumbTargetPath,
            toBase: thumbTargetBase,
            kind: "thumbnail",
          });
          newThumbWebPath = moveThumbnailsToVideoFolder
            ? `/videos/${thumbRelative}`
            : `/images/${thumbRelative}`;
          newThumbFilename = path.basename(thumbRelative);
        }
      }

      // Subtitle moves
      const newSubtitles: typeof video.subtitles = [];

      for (const sub of subtitles) {
        const subtitleTarget = subtitleTargets.find(
          (target) =>
            target.language === sub.language && target.currentPath === resolveManagedWebPath(sub.path)?.absolutePath
        );
        if (!subtitleTarget) {
          newSubtitles.push(sub);
          continue;
        }

        if (subtitleTarget.currentPath === subtitleTarget.targetPath) {
          newSubtitles.push(sub);
          continue;
        }

        moves.push({
          from: subtitleTarget.currentPath,
          fromBase: subtitleTarget.currentRootDir,
          to: subtitleTarget.targetPath,
          toBase: subtitleTarget.targetRootDir,
          kind: "subtitle",
        });
        newSubtitles.push({
          language: subtitleTarget.language,
          filename: subtitleTarget.newFilename,
          path: subtitleTarget.newPath,
        });
      }

      moveOutputFamilyWithJournalSync(moves, () => {
        // Commit DB update in one transaction. If this throws, the journaled
        // move helper rolls the already-moved family back before surfacing the
        // error to the job item.
        db.transaction(() => {
          const now = new Date().toISOString();
          db.update(videos)
            .set({
              videoFilename: path.basename(videoRelative),
              videoPath: newVideoWebPath,
              thumbnailFilename: newThumbFilename ?? video.thumbnailFilename,
              thumbnailPath: newThumbWebPath,
              subtitles: newSubtitles.length > 0 ? JSON.stringify(newSubtitles) : video.subtitles ? JSON.stringify(video.subtitles) : null,
              updatedAt: now,
            } as any)
            .where(eq(videos.id, video.id))
            .run();

          // Update successful download_history rows
          db.update(downloadHistory)
            .set({
              videoPath: newVideoWebPath,
              thumbnailPath: newThumbWebPath,
            } as any)
            .where(
              and(
                eq(downloadHistory.videoId, video.id),
                eq(downloadHistory.status, "success")
              )
            )
            .run();
        });
      });

      // Move small thumbnail mirror
      if (
        video.thumbnailPath &&
        newThumbWebPath &&
        video.thumbnailPath !== newThumbWebPath
      ) {
        try {
          moveSmallThumbnailMirrorSync(video.thumbnailPath, newThumbWebPath);
        } catch (e) {
          logger.warn("Failed to move small thumbnail mirror:", e);
        }
      }

      bumpVideosListRevision();

      const oldMediaServerPlan = planMediaServerExportPaths(video);
      const updatedVideo = storageService.getVideoById(video.id);
      if (updatedVideo) {
        removeMediaServerArtifactsForVideo(video);
        if (oldMediaServerPlan?.tvLayout.showRootRelativeDir) {
          syncMediaServerShowArtifactsForShowRoot(
            oldMediaServerPlan.tvLayout.showRootRelativeDir
          );
        }
        syncMediaServerArtifactsForRecord(updatedVideo);
      }

      item.status = "success";
      item.newVideoPath = newVideoWebPath;
    } finally {
      reservation.release();
    }
  } catch (err) {
    item.status = "failed";
    item.error =
      err instanceof Error ? err.message : String(err);
    logger.error(`Rename job failed for video ${video.id}:`, err);
  }

  return item;
}
