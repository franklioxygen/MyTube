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
  cleanupPlaylistTvLibrary,
  runPlaylistTvExport,
} from "./playlistTvSync";
import {
  getMediaServerCopyFallback,
  getMediaServerExportLayout,
  removeMediaServerArtifactsForVideo,
  syncMediaServerArtifactsForRecord,
} from "./syncService";
import { sweepOrphanMediaServerArtifacts } from "./orphanSweep";
import type {
  MediaServerExportJob,
  MediaServerExportJobCounts,
  MediaServerExportJobItem,
  MediaServerExportLayout,
  MediaServerExportMode,
  MediaServerExportSkip,
} from "./types";

/**
 * Item and failure lists are bounded: a library with tens of thousands of
 * videos would otherwise grow a job payload the settings page has to poll.
 */
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

function recordItem(
  job: MediaServerExportJob,
  item: MediaServerExportJobItem
): void {
  if (job.items.length < MAX_REPORTED_ITEMS) {
    job.items.push(item);
  }
  if (item.status === "success") {
    job.succeeded++;
  } else if (item.status === "skipped") {
    job.skipped++;
  } else if (item.status === "failed") {
    job.failed++;
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
  const layout = getMediaServerExportLayout(requestedLayout);
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
  try {
    if (job.cancelRequested) {
      job.status = "cancelled";
      return;
    }

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

function processPlaylistTvJob(job: MediaServerExportJob): void {
  if (job.action === "cleanup") {
    const { removedPaths, failures } = cleanupPlaylistTvLibrary();
    job.sweptFiles = removedPaths.length;
    job.sweptList = removedPaths.slice(0, MAX_REPORTED_ITEMS);
    job.counts.removedArtifacts = removedPaths.length;
    job.total = removedPaths.length + failures.length;
    job.processed = job.total;
    // Cleanup does not emit one callback per artifact, so account for the
    // successfully removed files directly. Otherwise the completed-job summary
    // misleadingly reports "0 cleaned" even when the mirror was emptied.
    job.succeeded = removedPaths.length;
    for (const failure of failures) {
      recordItem(job, {
        videoId: failure.videoId ?? "",
        title: failure.title,
        status: "failed",
        errorCode: failure.reason,
        error: failure.detail,
      });
    }
    job.phase = "completed";
    job.status = "completed";
    return;
  }

  // Episode failures are reported immediately through onEpisodeFinished so the
  // UI can show live progress. Show-, season-, and sweep-level failures have no
  // episode callback and must be copied from the final result below. Keep the
  // actual failure objects so episode failures are not counted twice.
  const reportedMaterializationFailures = new Set<MediaServerExportSkip>();
  const result = runPlaylistTvExport({
    mode: job.mode as Exclude<MediaServerExportMode, "off">,
    copyFallback: getMediaServerCopyFallback(),
    isCancelled: () => job.cancelRequested,
    onPhase: (phase, plan) => {
      job.phase = phase;
      if (phase === "materialize" && plan) {
        // In this layout the unit of work is an episode occurrence, not a
        // library video: one video can appear in several seasons.
        job.total = plan.shows.reduce(
          (total, show) =>
            total +
            show.seasons.reduce(
              (seasonTotal, season) => seasonTotal + season.episodes.length,
              0
            ),
          0
        );
      }
    },
    onEpisodeStart: (videoId, title) => {
      job.currentVideoId = videoId;
      job.currentTitle = title;
    },
    onEpisodeFinished: ({ videoId, title, failure }) => {
      job.processed++;
      if (failure) {
        reportedMaterializationFailures.add(failure);
      }
      recordItem(job, {
        videoId,
        title,
        status: failure ? "failed" : "success",
        errorCode: failure?.reason,
        error: failure?.detail,
      });
    },
  });

  for (const failure of result.failures) {
    if (reportedMaterializationFailures.has(failure)) {
      continue;
    }
    recordItem(job, {
      videoId: failure.videoId ?? "",
      title: failure.title,
      status: "failed",
      errorCode: failure.reason,
      error: failure.detail,
    });
  }

  for (const issue of result.issues) {
    recordItem(job, {
      videoId: issue.videoId ?? "",
      title: issue.title,
      status: "skipped",
      skipReason: issue.reason,
      error: issue.detail,
    });
  }
  for (const skip of result.plan.skips) {
    recordItem(job, {
      videoId: skip.videoId ?? "",
      title: skip.title,
      status: "skipped",
      skipReason: skip.reason,
      error: skip.detail,
    });
  }

  job.counts = result.counts;
  job.sweptFiles = result.removedPaths.length;
  job.sweptList = result.removedPaths.slice(0, MAX_REPORTED_ITEMS);
  if (result.cancelled) {
    job.status = "cancelled";
    return;
  }
  job.phase = "completed";
  job.status = "completed";
}

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

    recordItem(job, processOneAdjacentVideo(job, video, allVideos));
    job.processed++;
  }

  job.phase = "completed";
  job.status = "completed";
}

function processOneAdjacentVideo(
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
