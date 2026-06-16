import fs from "fs-extra";
import path from "path";
import { db } from "../../db";
import { downloadHistory, videos } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { LEGACY_DOWNLOAD_FILENAME_TEMPLATE } from "../../types/settings";
import { logger } from "../../utils/logger";
import {
  ensureDirSafeSync,
  moveSafeSync,
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
import { buildContextFromVideoRecord } from "./contextBuilder";
import { applyDedupeToRelatedPaths } from "./dedupe";
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

// Keep worst-case sibling collision scans bounded without blocking realistic
// rename runs that only need a handful of numeric suffix attempts.
const MAX_OUTPUT_FAMILY_DEDUPE_ATTEMPTS = 1000;

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

function appendNumericSuffixToRelativePath(
  relativePath: string,
  suffixNumber: number
): string {
  const dotIdx = relativePath.lastIndexOf(".");
  const stem = dotIdx > 0 ? relativePath.slice(0, dotIdx) : relativePath;
  const ext = dotIdx > 0 ? relativePath.slice(dotIdx) : "";
  return `${stem}_${suffixNumber}${ext}`;
}

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

function hasOutputPathConflict(
  absolutePath: string,
  allowedBaseDir: string,
  currentOutputFamilyPaths: Set<string>
): boolean {
  // Paths already owned by this video's current managed file family are not
  // conflicts. They represent in-place no-ops or moves within the same family.
  if (currentOutputFamilyPaths.has(absolutePath)) {
    return false;
  }
  return pathExistsSafeSync(absolutePath, [allowedBaseDir]);
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

    const currentManagedPaths = new Set<string>([videoPathResolved.absolutePath]);
    if (thumbResolved) {
      currentManagedPaths.add(thumbResolved.absolutePath);
    }
    for (const subtitle of subtitles) {
      const resolved = resolveManagedWebPath(subtitle.path);
      if (resolved) {
        currentManagedPaths.add(resolved.absolutePath);
      }
    }

    let videoRelative = planned.video.relativePath;
    let thumbRelative = planned.thumbnail.relativePath;
    let subBase = planned.subtitle.baseNameWithoutLanguageOrExt;
    let newVideoAbsPath = resolveSafeChildPath(VIDEOS_DIR, videoRelative);
    let subtitleTargets = buildManagedSubtitleTargets(
      subtitles,
      videoRelative,
      subBase
    );
    let newThumbAbsPath = thumbResolved
      ? resolveSafeChildPath(
          moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR,
          thumbRelative
        )
      : null;

    for (
      let dedupeAttempt = 0;
      dedupeAttempt <= MAX_OUTPUT_FAMILY_DEDUPE_ATTEMPTS;
      dedupeAttempt += 1
    ) {
      if (dedupeAttempt > 0) {
        videoRelative = appendNumericSuffixToRelativePath(
          planned.video.relativePath,
          dedupeAttempt
        );
        ({ thumbnail: thumbRelative, subtitleBase: subBase } =
          applyDedupeToRelatedPaths(
            planned.video.relativePath,
            videoRelative,
            planned.thumbnail.relativePath,
            planned.subtitle.baseNameWithoutLanguageOrExt
          ));
        newVideoAbsPath = resolveSafeChildPath(VIDEOS_DIR, videoRelative);
        subtitleTargets = buildManagedSubtitleTargets(
          subtitles,
          videoRelative,
          subBase
        );
        newThumbAbsPath = thumbResolved
          ? resolveSafeChildPath(
              moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR,
              thumbRelative
            )
          : null;
      }

      const thumbTargetBase = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;
      const familyHasConflict =
        hasOutputPathConflict(newVideoAbsPath, VIDEOS_DIR, currentManagedPaths) ||
        (newThumbAbsPath !== null &&
          hasOutputPathConflict(
            newThumbAbsPath,
            thumbTargetBase,
            currentManagedPaths
          )) ||
        subtitleTargets.some((target) =>
          hasOutputPathConflict(
            target.targetPath,
            target.targetRootDir,
            currentManagedPaths
          )
        );

      if (!familyHasConflict) {
        break;
      }

      if (dedupeAttempt === MAX_OUTPUT_FAMILY_DEDUPE_ATTEMPTS) {
        throw new Error(
          `Could not find a free output path family for ${planned.video.relativePath} after ${MAX_OUTPUT_FAMILY_DEDUPE_ATTEMPTS} attempts`
        );
      }
    }

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
    }> = [];

    // Video move
    if (!alreadyAtTarget) {
      moves.push({
        from: videoPathResolved.absolutePath,
        fromBase: VIDEOS_DIR,
        to: newVideoAbsPath,
        toBase: VIDEOS_DIR,
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
        });
        newThumbWebPath = moveThumbnailsToVideoFolder
          ? `/videos/${thumbRelative}`
          : `/images/${thumbRelative}`;
        newThumbFilename = path.basename(thumbRelative);
      }
    }

    // Subtitle moves
    const newSubtitles: typeof video.subtitles = [];
    const subtitleMoves: ManagedSubtitleTarget[] = [];

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

      subtitleMoves.push(subtitleTarget);
    }

    // Execute moves
    const completedMoves: typeof moves = [];
    try {
      for (const mv of moves) {
        ensureDirSafeSync(path.dirname(mv.to), mv.toBase);
        moveSafeSync(mv.from, mv.fromBase, mv.to, mv.toBase);
        completedMoves.push(mv);
      }

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

      // Subtitle moves
      for (const smv of subtitleMoves) {
        try {
          ensureDirSafeSync(path.dirname(smv.targetPath), smv.targetRootDir);
          moveSafeSync(
            smv.currentPath,
            smv.currentRootDir,
            smv.targetPath,
            smv.targetRootDir
          );
          newSubtitles.push({
            language: smv.language,
            filename: smv.newFilename,
            path: smv.newPath,
          });
        } catch (e) {
          logger.warn(`Failed to move subtitle ${smv.currentPath}:`, e);
          const orig = subtitles.find((s) => s.language === smv.language);
          if (orig) newSubtitles.push(orig);
        }
      }
    } catch (moveErr) {
      // Attempt rollback
      for (const mv of completedMoves.reverse()) {
        try {
          if (pathExistsSafeSync(mv.to, [VIDEOS_DIR, IMAGES_DIR, SUBTITLES_DIR])) {
            moveSafeSync(mv.to, mv.toBase, mv.from, mv.fromBase);
          }
        } catch (rbErr) {
          logger.warn("Rollback move failed:", rbErr);
        }
      }
      throw moveErr;
    }

    // Commit DB update in one transaction
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
  } catch (err) {
    item.status = "failed";
    item.error =
      err instanceof Error ? err.message : String(err);
    logger.error(`Rename job failed for video ${video.id}:`, err);
  }

  return item;
}
