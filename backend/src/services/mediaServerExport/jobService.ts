import { VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import { pathExistsSafeSync } from "../../utils/security";
import {
  acquireRenameLock,
  releaseRenameLock,
} from "../filenameTemplate/renameLockService";
import { resolveManagedWebPath } from "../filenameTemplate/pathHelpers";
import * as storageService from "../storageService";
import type { Video } from "../storageService";
import {
  getMediaServerExportLayout,
  removeMediaServerArtifactsForVideo,
  syncMediaServerArtifactsForRecord,
} from "./syncService";
import { cleanupMediaServerMirror } from "./hierarchyMaterializer";
import { syncPlaylistTvLibrary } from "./playlistTvSync";
import { sweepOrphanMediaServerArtifacts } from "./orphanSweep";
import type {
  MediaServerExportJob,
  MediaServerExportJobCounts,
  MediaServerExportJobItem,
  MediaServerExportLayout,
  MediaServerExportMode,
} from "./types";

/** Bounded so a large library cannot produce an unbounded API payload. */
const MAX_REPORTED_ITEMS = 500;

let activeJob: MediaServerExportJob | null = null;

export function getActiveMediaServerExportJob(): MediaServerExportJob | null {
  return activeJob;
}

export function getMediaServerExportJobById(
  jobId: string
): MediaServerExportJob | null {
  if (activeJob && activeJob.id === jobId) {
    return activeJob;
  }
  return null;
}

export function cancelMediaServerExportJob(jobId: string): boolean {
  if (!activeJob || activeJob.id !== jobId) {
    return false;
  }
  activeJob.cancelRequested = true;
  return true;
}

function emptyCounts(): MediaServerExportJobCounts {
  return {
    shows: 0,
    seasons: 0,
    episodes: 0,
    linkedMedia: 0,
    copiedMedia: 0,
    unchangedArtifacts: 0,
    removedArtifacts: 0,
  };
}

function pushItem(job: MediaServerExportJob, item: MediaServerExportJobItem): void {
  if (job.items.length < MAX_REPORTED_ITEMS) {
    job.items.push(item);
  }

  job.processed += 1;
  if (item.status === "success") {
    job.succeeded += 1;
  } else if (item.status === "skipped") {
    job.skipped += 1;
  } else if (item.status === "failed") {
    job.failed += 1;
  }
}

export async function startMediaServerExportJob(
  requestedMode?: MediaServerExportMode,
  requestedLayout?: MediaServerExportLayout
): Promise<MediaServerExportJob> {
  if (activeJob && activeJob.status === "running") {
    throw new Error("A media server export rebuild job is already running.");
  }

  const savedMode = storageService.getSettings().mediaServerExportMode || "off";
  const mode = requestedMode || savedMode;
  // The layout comes from the request so the action cannot change between the
  // user's confirmation and execution — cleanup in the wrong layout would
  // delete the wrong set of files.
  const layout = requestedLayout ?? getMediaServerExportLayout();
  const action = mode === "off" ? "cleanup" : "rebuild";

  const jobId = `media_export_${Date.now()}`;
  if (!acquireRenameLock(jobId)) {
    throw new Error("Could not acquire library maintenance lock.");
  }

  const allVideos = storageService.getVideos();
  const job: MediaServerExportJob = {
    id: jobId,
    status: "running",
    lockedAt: Date.now(),
    mode,
    layout,
    action,
    phase: "snapshot",
    total: allVideos.length,
    processed: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    sweptFiles: 0,
    sweptList: [],
    counts: emptyCounts(),
    items: [],
    cancelRequested: false,
  };

  activeJob = job;

  setImmediate(() => {
    processMediaServerExportJob(job, allVideos).catch((error) => {
      logger.error("Media server export rebuild job process error:", error);
      if (activeJob && activeJob.id === jobId) {
        activeJob.status = "failed";
        releaseRenameLock();
      }
    });
  });

  return job;
}

async function processMediaServerExportJob(
  job: MediaServerExportJob,
  allVideos: Video[]
): Promise<void> {
  if (job.cancelRequested) {
    job.status = "cancelled";
    releaseRenameLock();
    return;
  }

  try {
    if (job.layout === "playlist_tv") {
      processPlaylistTvJob(job);
    } else {
      processAdjacentJob(job, allVideos);
    }
  } finally {
    job.currentVideoId = undefined;
    job.currentTitle = undefined;
    releaseRenameLock();
  }
}

// ---------------------------------------------------------------------------
// playlist_tv (issue #411)
// ---------------------------------------------------------------------------

function processPlaylistTvJob(job: MediaServerExportJob): void {
  if (job.action === "cleanup") {
    job.phase = "sweep";
    // Catalog assignments are deliberately retained so a later re-enable reuses
    // the same season and episode numbers.
    const cleanup = cleanupMediaServerMirror();
    job.counts = { ...job.counts, ...cleanup.counts };
    job.sweptFiles = cleanup.counts.removedArtifacts;
    job.total = cleanup.counts.removedArtifacts;
    job.processed = cleanup.counts.removedArtifacts;
    job.succeeded = cleanup.counts.removedArtifacts;

    for (const failure of cleanup.failures) {
      pushItem(job, {
        videoId: failure.videoId ?? "",
        title: failure.title ?? "",
        status: "failed",
        errorCode: failure.reason,
        error: failure.detail,
      });
    }

    job.phase = "completed";
    job.status = job.cancelRequested ? "cancelled" : "completed";
    return;
  }

  job.phase = "catalog_reconcile";
  const summary = syncPlaylistTvLibrary({
    mode: job.mode === "off" ? "nfo" : job.mode,
    copyFallbackEnabled:
      (storageService.getSettings() as { mediaServerCopyFallback?: boolean })
        .mediaServerCopyFallback !== false,
    isCancelled: () => job.cancelRequested,
  });

  job.phase = "materialize";
  job.counts = summary.counts;
  job.sweptFiles = summary.counts.removedArtifacts;
  // In playlist_tv the meaningful unit is the episode assignment, not the raw
  // video row, so `total` is restated once the plan is known.
  job.total = summary.counts.episodes + summary.failures.length;
  job.succeeded = summary.counts.episodes;
  job.processed = summary.counts.episodes;

  for (const issue of summary.reconcileIssues) {
    pushItem(job, {
      videoId: issue.videoId ?? "",
      title: "",
      status: "skipped",
      skipReason: issue.reason,
      error: issue.detail,
    });
  }

  for (const failure of summary.failures) {
    pushItem(job, {
      videoId: failure.videoId ?? "",
      title: failure.title ?? "",
      status: "failed",
      errorCode: failure.reason,
      error: failure.detail,
    });
  }

  job.phase = job.cancelRequested ? "materialize" : "completed";
  // Per-item failures do not fail the job; only a global catalog/database
  // failure does, and that arrives as a thrown error.
  job.status = job.cancelRequested ? "cancelled" : "completed";
}

// ---------------------------------------------------------------------------
// adjacent (unchanged behavior)
// ---------------------------------------------------------------------------

function processAdjacentJob(
  job: MediaServerExportJob,
  allVideos: Video[]
): void {
  job.phase = "sweep";
  const sweepResult = sweepOrphanMediaServerArtifacts(allVideos);
  job.sweptFiles = sweepResult.sweptFiles;
  job.sweptList = sweepResult.sweptList;

  job.phase = "materialize";
  for (const video of allVideos) {
    if (job.cancelRequested) {
      job.status = "cancelled";
      return;
    }

    job.currentVideoId = video.id;
    job.currentTitle = video.title;
    pushItem(job, processOneVideo(job, video, allVideos));
  }

  job.phase = "completed";
  job.status = "completed";
}

function processOneVideo(
  job: MediaServerExportJob,
  video: Video,
  allVideos: Video[]
): MediaServerExportJobItem {
  const item: MediaServerExportJobItem = {
    videoId: video.id,
    title: video.title,
    status: "pending",
  };

  try {
    const resolved = video.videoPath ? resolveManagedWebPath(video.videoPath) : null;
    if (!resolved || resolved.prefix !== "/videos") {
      item.status = "skipped";
      if (video.videoPath?.startsWith("cloud:")) {
        item.skipReason = "cloud_path";
      } else if (video.videoPath?.startsWith("mount:")) {
        item.skipReason = "mount_path";
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

    if (!pathExistsSafeSync(resolved.absolutePath, VIDEOS_DIR)) {
      item.status = "skipped";
      item.skipReason = "video_file_missing";
      return item;
    }

    if (job.action === "cleanup") {
      removeMediaServerArtifactsForVideo(video, {
        libraryVideos: allVideos,
        layoutOverride: "adjacent",
      });
    } else {
      syncMediaServerArtifactsForRecord(video, {
        modeOverride: job.mode === "off" ? undefined : job.mode,
        libraryVideos: allVideos,
        layoutOverride: "adjacent",
      });
    }
    item.status = "success";
  } catch (error) {
    item.status = "failed";
    item.error = error instanceof Error ? error.message : String(error);
    logger.error(`Media server export rebuild failed for video ${video.id}:`, error);
  }

  return item;
}
