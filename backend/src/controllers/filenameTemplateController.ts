import { Request, Response } from "express";
import * as storageService from "../services/storageService";
import {
  FILENAME_TEMPLATE_PRESETS,
  validateTemplate,
  renderFilenameTemplate,
  buildContextFromYtDlpInfo,
  getActiveRenameJob,
  getRenameJobById,
  cancelRenameJob,
  startRenameJob,
} from "../services/filenameTemplate";
import { FilenameTemplateContext } from "../services/filenameTemplate/types";
import { logger } from "../utils/logger";
import { sendBadRequest } from "../utils/response";

const SAMPLE_CONTEXT: FilenameTemplateContext = {
  title: "Sample Video",
  id: "dQw4w9WgXcQ",
  ext: "mp4",
  uploader: "Sample Channel",
  channel: "Sample Channel",
  uploadDate: "20260430",
  uploadYear: "2026",
  uploadMonth: "04",
  uploadDay: "30",
  durationSeconds: 212,
  durationString: "03-32",
  artistName: "Sample Channel",
  sourceCustomName: "Sample Channel",
  sourceCollectionName: "Sample Channel",
  sourceCollectionId: "UC_channel_id",
  sourceCollectionType: "channel",
  mediaPlaylistIndex: 1,
  mediaPlaylistIndexWithinDate: 1,
  platform: "youtube",
  sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};

export async function getFilenameTemplatePresets(
  req: Request,
  res: Response
): Promise<void> {
  res.json({ presets: FILENAME_TEMPLATE_PRESETS });
}

export async function validateFilenameTemplate(
  req: Request,
  res: Response
): Promise<void> {
  const { template, sourceCollectionType } = req.body as {
    template?: string;
    sourceCollectionType?: "channel" | "playlist" | "single" | "unknown";
  };

  if (!template || typeof template !== "string") {
    sendBadRequest(res, "template is required");
    return;
  }

  const result = validateTemplate(template, sourceCollectionType);

  let rendered: { videoPath: string; thumbnailPath: string; subtitlePath: string } | null = null;
  if (result.valid) {
    try {
      const videoCtx = { ...SAMPLE_CONTEXT, ext: "mp4" };
      if (sourceCollectionType) {
        videoCtx.sourceCollectionType = sourceCollectionType;
      }
      const videoRendered = renderFilenameTemplate({
        template,
        context: videoCtx,
        mode: "video",
        extension: "mp4",
      });
      const thumbRendered = renderFilenameTemplate({
        template,
        context: { ...videoCtx, ext: "jpg" },
        mode: "thumbnail",
        extension: "jpg",
      });
      const subRendered = renderFilenameTemplate({
        template,
        context: { ...videoCtx, ext: "vtt" },
        mode: "subtitle",
        extension: "vtt",
        subtitleLanguage: "en",
      });
      rendered = {
        videoPath: videoRendered.relativePath,
        thumbnailPath: thumbRendered.relativePath.replace(/\.vtt$/, ".jpg").replace(/\.mp4$/, ".jpg"),
        subtitlePath: subRendered.relativePath.replace(/\.vtt\.vtt$/, ".en.vtt"),
      };
    } catch (e) {
      // If rendering fails during preview (e.g. due to sanitization), still return validation result
      logger.debug("Template preview render failed:", e);
    }
  }

  res.json({ ...result, rendered });
}

export async function previewFilenameTemplate(
  req: Request,
  res: Response
): Promise<void> {
  const { template, sourceCollectionType } = req.body as {
    template?: string;
    sourceCollectionType?: "channel" | "playlist" | "single" | "unknown";
  };

  if (!template || typeof template !== "string") {
    sendBadRequest(res, "template is required");
    return;
  }

  const ctx = { ...SAMPLE_CONTEXT };
  if (sourceCollectionType) ctx.sourceCollectionType = sourceCollectionType;

  try {
    const videoRendered = renderFilenameTemplate({
      template,
      context: { ...ctx, ext: "mp4" },
      mode: "video",
      extension: "mp4",
    });
    const thumbBasename = `${videoRendered.basenameWithoutExt}.jpg`;
    const thumbPath = videoRendered.directory
      ? `${videoRendered.directory}/${thumbBasename}`
      : thumbBasename;
    const subBasename = `${videoRendered.basenameWithoutExt}.en.vtt`;
    const subPath = videoRendered.directory
      ? `${videoRendered.directory}/${subBasename}`
      : subBasename;

    res.json({
      videoPath: videoRendered.relativePath,
      thumbnailPath: thumbPath,
      subtitlePath: subPath,
      warnings: videoRendered.warnings,
    });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function startBatchRename(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Check for active downloads
    const { activeDownloads, queuedDownloads } = storageService.getDownloadStatus();
    if (activeDownloads.length > 0) {
      res.status(409).json({
        error: "Cannot start batch rename while downloads are active.",
        code: "active_downloads",
      });
      return;
    }
    if (queuedDownloads.length > 0) {
      res.status(409).json({
        error: "Cannot start batch rename while downloads are queued.",
        code: "queued_downloads",
      });
      return;
    }

    const settings = storageService.getSettings();
    const job = await startRenameJob(
      settings,
      settings.moveThumbnailsToVideoFolder || false,
      settings.moveSubtitlesToVideoFolder || false
    );

    res.status(202).json({
      jobId: job.id,
      status: job.status,
      total: job.total,
    });
  } catch (e) {
    const code =
      e instanceof Error && (e as any).code
        ? (e as any).code
        : "rename_failed";
    res.status(400).json({
      error: e instanceof Error ? e.message : String(e),
      code,
    });
  }
}

export async function getRenameJobStatus(
  req: Request,
  res: Response
): Promise<void> {
  const { jobId } = req.params;
  const job = getRenameJobById(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  res.json(job);
}

export async function cancelBatchRename(
  req: Request,
  res: Response
): Promise<void> {
  const { jobId } = req.params;
  const cancelled = cancelRenameJob(jobId);
  if (!cancelled) {
    res.status(404).json({ error: "Job not found or already completed." });
    return;
  }
  res.json({ success: true });
}
