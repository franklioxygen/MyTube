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
  removeMediaServerArtifactsForVideo,
  syncMediaServerArtifactsForRecord,
} from "./syncService";
import { sweepOrphanMediaServerArtifacts } from "./orphanSweep";
import type {
  MediaServerExportJob,
  MediaServerExportJobItem,
  MediaServerExportMode,
} from "./types";

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

export async function startMediaServerExportJob(
  requestedMode?: MediaServerExportMode
): Promise<MediaServerExportJob> {
  if (activeJob && activeJob.status === "running") {
    throw new Error("A media server export rebuild job is already running.");
  }

  const savedMode = storageService.getSettings().mediaServerExportMode || "off";
  const mode = requestedMode || savedMode;
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
    action,
    total: allVideos.length,
    processed: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    sweptFiles: 0,
    sweptList: [],
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

  const sweepResult = sweepOrphanMediaServerArtifacts(allVideos);
  job.sweptFiles = sweepResult.sweptFiles;
  job.sweptList = sweepResult.sweptList;

  for (const video of allVideos) {
    if (job.cancelRequested) {
      job.status = "cancelled";
      releaseRenameLock();
      return;
    }

    job.currentVideoId = video.id;
    job.currentTitle = video.title;

    const item = processOneVideo(job, video, allVideos);
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
      });
    } else {
      syncMediaServerArtifactsForRecord(video, {
        modeOverride: job.mode === "off" ? undefined : job.mode,
        libraryVideos: allVideos,
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
