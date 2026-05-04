import fs from "fs-extra";
import path from "path";
import { db } from "../../db";
import { downloadHistory, videos } from "../../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import {
  ensureDirSafeSync,
  moveSafeSync,
  pathExistsSafeSync,
  resolveSafeChildPath,
} from "../../utils/security";
import { moveSmallThumbnailMirrorSync } from "../thumbnailMirrorService";
import * as storageService from "../storageService";
import { buildContextFromVideoRecord } from "./contextBuilder";
import { dedupeRelativePath, applyDedupeToRelatedPaths } from "./dedupe";
import { resolveManagedWebPath } from "./pathHelpers";
import { getPresetById } from "./presets";
import { planVideoOutputPaths } from "./renderer";
import { acquireRenameLock, releaseRenameLock } from "./renameLockService";
import { Video } from "../storageService/types";

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
  settings: { downloadFilenamePresetId?: string; downloadFilenameTemplate?: string },
  moveThumbnailsToVideoFolder: boolean,
  moveSubtitlesToVideoFolder: boolean
): Promise<RenameJob> {
  if (activeJob && activeJob.status === "running") {
    throw new Error("A rename job is already running.");
  }

  // Per design §23, the rename job runs for any saved preset including
  // "legacy" — the planner falls back to formatVideoFilename for legacy so
  // already-legacy files are detected as no-ops and the job is safe to re-run.
  const presetId = settings.downloadFilenamePresetId || "legacy";
  let template: string;
  if (presetId === "legacy") {
    template = "{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}";
  } else if (presetId === "custom") {
    template = settings.downloadFilenameTemplate || "";
  } else {
    template = getPresetById(presetId)?.template || "";
  }

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

async function processRenameJob(
  job: RenameJob,
  allVideos: Video[],
  settings: { downloadFilenamePresetId?: string; downloadFilenameTemplate?: string },
  moveThumbnailsToVideoFolder: boolean,
  moveSubtitlesToVideoFolder: boolean
): Promise<void> {
  const reservedPaths = new Set<string>();

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
      reservedPaths
    );

    job.items.push(item);
    job.processed++;
    if (item.status === "success") {
      job.succeeded++;
      if (item.newVideoPath) reservedPaths.add(item.newVideoPath);
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
  settings: { downloadFilenamePresetId?: string; downloadFilenameTemplate?: string },
  moveThumbnailsToVideoFolder: boolean,
  moveSubtitlesToVideoFolder: boolean,
  reservedPaths: Set<string>
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

    // Build context from video record
    const context = buildContextFromVideoRecord(video);

    // Determine video extension
    const videoExt =
      path.extname(video.videoFilename || videoPathResolved.relativePath).replace(".", "") ||
      "mp4";

    // Plan output
    const planned = planVideoOutputPaths({
      settings,
      context,
      videoExtension: videoExt,
      moveThumbnailsToVideoFolder,
      moveSubtitlesToVideoFolder,
    });

    // Deduplicate
    let videoRelative = planned.video.relativePath;
    videoRelative = dedupeRelativePath(videoRelative, VIDEOS_DIR, reservedPaths);

    const { thumbnail: thumbRelative, subtitleBase: subBase } =
      applyDedupeToRelatedPaths(
        planned.video.relativePath,
        videoRelative,
        planned.thumbnail.relativePath,
        planned.subtitle.baseNameWithoutLanguageOrExt
      );

    // resolveSafeChildPath validates traversal and that the result is inside
    // VIDEOS_DIR; throws otherwise. videoRelative is sanitized planner output.
    const newVideoAbsPath = resolveSafeChildPath(VIDEOS_DIR, videoRelative);
    const newVideoWebPath = `/videos/${videoRelative}`;

    // Check if already at target
    const currentVideoRelative = videoPathResolved.relativePath;
    const alreadyAtTarget = currentVideoRelative === videoRelative;

    // Check thumbnail
    const thumbResolved = video.thumbnailPath
      ? resolveManagedWebPath(video.thumbnailPath)
      : null;

    // Check subtitles
    const subtitles: typeof video.subtitles = video.subtitles || [];

    // Idempotent no-op detection: skip only if every managed file family
    // (video, thumbnail if any, every local subtitle) already resolves to its
    // planned target. Subtitles whose path is not a managed local path are
    // ignored for this check because we never move them. (Design §23.5)
    let anyChange = !alreadyAtTarget;

    if (!anyChange && thumbResolved) {
      const thumbTargetBase = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;
      const newThumbAbsPath = resolveSafeChildPath(thumbTargetBase, thumbRelative);
      anyChange = thumbResolved.absolutePath !== newThumbAbsPath;
    }

    if (!anyChange) {
      for (const sub of subtitles) {
        const subResolved = resolveManagedWebPath(sub.path);
        if (!subResolved) continue;
        const subExt = path.extname(sub.filename);
        const newSubFilename = `${subBase}.${sub.language}${subExt}`;
        // Compute the planned subtitle path relative to the appropriate root,
        // then route through resolveSafeChildPath for validation.
        const videoDir = path.dirname(videoRelative);
        const subRelative = videoDir && videoDir !== "."
          ? `${videoDir}/${newSubFilename}`
          : newSubFilename;
        const newSubAbsPath = sub.path.startsWith("/videos/")
          ? resolveSafeChildPath(VIDEOS_DIR, subRelative)
          : resolveSafeChildPath(SUBTITLES_DIR, subRelative);
        if (subResolved.absolutePath !== newSubAbsPath) {
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
      const newThumbAbsPath = resolveSafeChildPath(thumbTargetBase, thumbRelative);
      if (thumbResolved.absolutePath !== newThumbAbsPath) {
        moves.push({
          from: thumbResolved.absolutePath,
          fromBase: thumbResolved.rootDir,
          to: newThumbAbsPath,
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
    const subtitleMoves: Array<{
      from: string;
      fromBase: string;
      to: string;
      toBase: string;
      newPath: string;
      newFilename: string;
      language: string;
    }> = [];

    for (const sub of subtitles) {
      const subResolved = resolveManagedWebPath(sub.path);
      if (!subResolved) {
        newSubtitles.push(sub);
        continue;
      }
      const subExt = path.extname(sub.filename);
      const newSubFilename = `${subBase}.${sub.language}${subExt}`;

      // Preserve storage family: /videos or /subtitles
      let subTargetBase: string;
      let subWebPrefix: string;
      // Compute the planned subtitle relative path under VIDEOS_DIR
      // (regardless of storage family) so resolveSafeChildPath can validate.
      const videoRelDir = path.dirname(videoRelative);
      const subRelative = videoRelDir && videoRelDir !== "."
        ? `${videoRelDir}/${newSubFilename}`
        : newSubFilename;
      if (sub.path.startsWith("/videos/")) {
        const newSubAbsPath = resolveSafeChildPath(VIDEOS_DIR, subRelative);
        subTargetBase = VIDEOS_DIR;
        subWebPrefix = "/videos/";
        subtitleMoves.push({
          from: subResolved.absolutePath,
          fromBase: subResolved.rootDir,
          to: newSubAbsPath,
          toBase: VIDEOS_DIR,
          newPath: `/videos/${subRelative}`,
          newFilename: newSubFilename,
          language: sub.language,
        });
      } else {
        const newSubAbsPath = resolveSafeChildPath(SUBTITLES_DIR, subRelative);
        subTargetBase = SUBTITLES_DIR;
        subWebPrefix = "/subtitles/";
        subtitleMoves.push({
          from: subResolved.absolutePath,
          fromBase: subResolved.rootDir,
          to: newSubAbsPath,
          toBase: SUBTITLES_DIR,
          newPath: `/subtitles/${subRelative}`,
          newFilename: newSubFilename,
          language: sub.language,
        });
      }
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
          ensureDirSafeSync(path.dirname(smv.to), smv.toBase);
          moveSafeSync(smv.from, smv.fromBase, smv.to, smv.toBase);
          newSubtitles.push({
            language: smv.language,
            filename: smv.newFilename,
            path: smv.newPath,
          });
        } catch (e) {
          logger.warn(`Failed to move subtitle ${smv.from}:`, e);
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
