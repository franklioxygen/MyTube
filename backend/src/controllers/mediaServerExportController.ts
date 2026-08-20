import { Request, Response } from "express";
import * as storageService from "../services/storageService";
import {
  cancelMediaServerExportJob,
  getMediaServerExportJobById,
  startMediaServerExportJob,
} from "../services/mediaServerExport/jobService";
import { MEDIA_SERVER_LIBRARY_DIR } from "../config/paths";
import type {
  MediaServerExportLayout,
  MediaServerExportMode,
} from "../types/settings";
import { getStringParam } from "../utils/paramUtils";

type RebuildRequest = {
  mediaServerExportMode?: MediaServerExportMode;
  /**
   * Issue #411. Sent by the client so the action cannot change between the
   * user's confirmation and execution — cleaning the wrong layout would delete
   * the wrong set of files.
   */
  mediaServerExportLayout?: MediaServerExportLayout;
};

export async function startMediaServerExportRebuild(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { activeDownloads, queuedDownloads } = storageService.getDownloadStatus();
    if (activeDownloads.length > 0) {
      res.status(409).json({
        error: "Cannot rebuild media server sidecars while downloads are active.",
        code: "active_downloads",
      });
      return;
    }
    if (queuedDownloads.length > 0) {
      res.status(409).json({
        error: "Cannot rebuild media server sidecars while downloads are queued.",
        code: "queued_downloads",
      });
      return;
    }

    const body = (req.body || {}) as RebuildRequest;
    const requestedMode = body.mediaServerExportMode;
    if (
      requestedMode !== undefined &&
      requestedMode !== "off" &&
      requestedMode !== "nfo" &&
      requestedMode !== "nfo_and_source_json"
    ) {
      res.status(400).json({
        error: "Invalid media server export mode.",
        code: "unsupported_export_mode",
      });
      return;
    }

    const requestedLayout = body.mediaServerExportLayout;
    if (
      requestedLayout !== undefined &&
      requestedLayout !== "adjacent" &&
      requestedLayout !== "playlist_tv"
    ) {
      res.status(400).json({
        error: "Invalid media server export layout.",
        code: "unsupported_export_layout",
      });
      return;
    }

    const job = await startMediaServerExportJob(requestedMode, requestedLayout);
    res.status(202).json({
      jobId: job.id,
      status: job.status,
      action: job.action,
      mode: job.mode,
      layout: job.layout,
      phase: job.phase,
      total: job.total,
      processed: job.processed,
      succeeded: job.succeeded,
      skipped: job.skipped,
      failed: job.failed,
      counts: job.counts,
      mediaServerLibraryPath: MEDIA_SERVER_LIBRARY_DIR,
    });
  } catch (error) {
    const code =
      error instanceof Error && (error as any).code
        ? (error as any).code
        : "media_server_export_rebuild_failed";
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error),
      code,
    });
  }
}

export async function getMediaServerExportRebuildStatus(
  req: Request,
  res: Response
): Promise<void> {
  const jobId = getStringParam(req.params.jobId) ?? "";
  const job = getMediaServerExportJobById(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  res.json(job);
}

export async function cancelMediaServerExportRebuild(
  req: Request,
  res: Response
): Promise<void> {
  const jobId = getStringParam(req.params.jobId) ?? "";
  const cancelled = cancelMediaServerExportJob(jobId);
  if (!cancelled) {
    res.status(404).json({ error: "Job not found or already completed." });
    return;
  }
  res.json({ success: true });
}

/**
 * Read-only scope of a managed-library rebuild, so the confirmation dialog can
 * state how many videos and shows the run will produce before it is started.
 */
export const getMediaServerExportScope = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const { previewMediaServerExportScope } = await import(
    "../services/mediaServerExport/scopePreview"
  );
  res.json(previewMediaServerExportScope());
};
