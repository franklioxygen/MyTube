import { Request, Response } from "express";
import * as storageService from "../services/storageService";
import {
  DEPRECATED_TEMPLATE_ALIASES,
  FILENAME_TEMPLATE_PRESETS,
  FILENAME_TEMPLATE_INFORMATION_NOTES,
  FILENAME_TEMPLATE_REFERENCE_SECTIONS,
  validateTemplate,
  renderFilenameTemplate,
  getActiveRenameJob,
  getRenameJobById,
  cancelRenameJob,
  startRenameJob,
  planVideoOutputPaths,
} from "../services/filenameTemplate";
import {
  normalizeFilenameNamingSettings,
  resolveFilenameNamingConfig,
  toFilenameNamingRuntimeConfig,
  validateFilenameNamingSelection,
} from "../services/filenameTemplate/config";
import { FilenameTemplateContext } from "../services/filenameTemplate/types";
import { DownloadFilenameMode, DownloadFilenamePresetId } from "../types/settings";
import { logger } from "../utils/logger";
import { getStringParam } from "../utils/paramUtils";
import { sendBadRequest } from "../utils/response";

type PreviewScenario = "channel" | "playlist" | "single";

type FilenameTemplatePreviewResult = {
  videoPath: string;
  thumbnailPath: string;
  subtitlePath: string;
  warnings: Array<{ code: string; message: string }>;
};

const SAMPLE_CONTEXT_BASE: Omit<
  FilenameTemplateContext,
  | "sourceCustomName"
  | "sourceCollectionName"
  | "sourceCollectionId"
  | "sourceCollectionType"
  | "mediaPlaylistIndex"
  | "mediaPlaylistIndexWithinDate"
> = {
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
  platform: "youtube",
  sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};

const SAMPLE_CONTEXTS: Record<PreviewScenario, FilenameTemplateContext> = {
  channel: {
    ...SAMPLE_CONTEXT_BASE,
    sourceCustomName: "Sample Channel",
    sourceCollectionName: "Sample Channel",
    sourceCollectionId: "UC_channel_id",
    sourceCollectionType: "channel",
  },
  playlist: {
    ...SAMPLE_CONTEXT_BASE,
    sourceCustomName: "Sample Channel",
    sourceCollectionName: "Sample Playlist",
    sourceCollectionId: "PL_playlist_id",
    sourceCollectionType: "playlist",
    mediaPlaylistIndex: 3,
    mediaPlaylistIndexWithinDate: 3,
  },
  single: {
    ...SAMPLE_CONTEXT_BASE,
    sourceCustomName: "Sample Channel",
    sourceCollectionName: "",
    sourceCollectionId: "",
    sourceCollectionType: "single",
  },
};

type BatchRenameRequestOverrides = {
  downloadFilenameMode?: DownloadFilenameMode;
  downloadFilenamePresetId?: DownloadFilenamePresetId;
  downloadFilenameTemplate?: string;
  moveThumbnailsToVideoFolder?: boolean;
  moveSubtitlesToVideoFolder?: boolean;
};

export async function getFilenameTemplatePresets(
  req: Request,
  res: Response
): Promise<void> {
  res.json({
    presets: FILENAME_TEMPLATE_PRESETS.map((preset) => ({
      ...preset,
      examplePath: buildPresetExamplePath(preset),
    })),
  });
}

export async function getFilenameTemplateCatalog(
  _req: Request,
  res: Response
): Promise<void> {
  res.json({
    presets: FILENAME_TEMPLATE_PRESETS.map((preset) => ({
      ...preset,
      examplePath: buildPresetExamplePath(preset),
    })),
    deprecatedPresetAliases: Object.values(DEPRECATED_TEMPLATE_ALIASES)
      .filter((alias) => alias.matchedPresetId !== "legacy")
      .map((alias) => ({
        id: alias.matchedPresetId,
        labelKey: alias.labelKey,
        mapsToCurrentPresetId: alias.mapsToCurrentPresetId,
      })),
    informationNotes: FILENAME_TEMPLATE_INFORMATION_NOTES,
    referenceSections: FILENAME_TEMPLATE_REFERENCE_SECTIONS,
  });
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
      const videoCtx =
        sourceCollectionType && sourceCollectionType in SAMPLE_CONTEXTS
          ? { ...SAMPLE_CONTEXTS[sourceCollectionType as PreviewScenario], ext: "mp4" }
          : { ...SAMPLE_CONTEXTS.channel, ext: "mp4" };
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
  const { mode, template } = req.body as {
    mode?: DownloadFilenameMode;
    template?: string;
  };

  if (
    mode !== "legacy" &&
    (!template || typeof template !== "string")
  ) {
    sendBadRequest(res, "template is required");
    return;
  }

  const previewSelection = {
    downloadFilenameMode: mode || "template",
    downloadFilenameTemplate: template,
  };
  const validation = validateFilenameNamingSelection(previewSelection);
  const resolved = resolveFilenameNamingConfig(previewSelection);

  if (validation.errors.length > 0) {
    res.json({
      valid: false,
      errors: validation.errors.map((error) => error.message),
      resolved,
      previews: null,
    });
    return;
  }

  const naming = toFilenameNamingRuntimeConfig(previewSelection);
  const previews = {
    channel: renderPreviewScenario(naming, SAMPLE_CONTEXTS.channel),
    playlist: renderPreviewScenario(naming, SAMPLE_CONTEXTS.playlist),
    single: renderPreviewScenario(naming, SAMPLE_CONTEXTS.single),
  };

  res.json({
    valid: true,
    errors: [],
    resolved,
    previews,
  });
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

    const savedSettings = storageService.getSettings();
    const overrides = (req.body || {}) as BatchRenameRequestOverrides;

    const normalizedNamingOverrides = normalizeFilenameNamingSettings(
      savedSettings,
      overrides
    );
    const namingValidation = validateFilenameNamingSelection({
      ...savedSettings,
      ...normalizedNamingOverrides,
    });
    if (namingValidation.errors.length > 0) {
      const [error] = namingValidation.errors;
      res.status(400).json({
        error: error.message,
        code:
          error.field === "downloadFilenamePresetId"
            ? "invalid_preset"
            : "invalid_template",
      });
      return;
    }

    const settings = {
      ...savedSettings,
      ...normalizedNamingOverrides,
      ...(overrides.moveThumbnailsToVideoFolder !== undefined
        ? { moveThumbnailsToVideoFolder: overrides.moveThumbnailsToVideoFolder }
        : {}),
      ...(overrides.moveSubtitlesToVideoFolder !== undefined
        ? { moveSubtitlesToVideoFolder: overrides.moveSubtitlesToVideoFolder }
        : {}),
    };

    // Batch rename uses the current UI selection if provided in the request;
    // Save only controls future download defaults.
    if (settings.downloadFilenameMode === "template") {
      const tpl = settings.downloadFilenameTemplate || "";
      const validation = validateTemplate(tpl);
      if (!validation.valid) {
        const templateScope = overrides.downloadFilenameTemplate !== undefined
          ? "Current"
          : "Saved";
        res.status(400).json({
          error: `${templateScope} template is invalid: ${validation.errors.join("; ")}`,
          code: "invalid_template",
        });
        return;
      }
    }

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
  const jobId = getStringParam(req.params.jobId) ?? "";
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
  const jobId = getStringParam(req.params.jobId) ?? "";
  const cancelled = cancelRenameJob(jobId);
  if (!cancelled) {
    res.status(404).json({ error: "Job not found or already completed." });
    return;
  }
  res.json({ success: true });
}

function renderPreviewScenario(
  naming: ReturnType<typeof toFilenameNamingRuntimeConfig>,
  context: FilenameTemplateContext
): FilenameTemplatePreviewResult {
  const planned = planVideoOutputPaths({
    naming,
    context,
    videoExtension: "mp4",
    thumbnailExtension: "jpg",
    moveThumbnailsToVideoFolder: false,
    moveSubtitlesToVideoFolder: false,
  });
  const subtitleFilename = `${planned.subtitle.baseNameWithoutLanguageOrExt}.en.vtt`;
  const subtitlePath = planned.subtitle.relativeDirectory
    ? `${planned.subtitle.relativeDirectory}/${subtitleFilename}`
    : subtitleFilename;

  return {
    videoPath: planned.video.relativePath,
    thumbnailPath: planned.thumbnail.relativePath,
    subtitlePath,
    warnings: planned.warnings,
  };
}

function buildPresetExamplePath(
  preset: (typeof FILENAME_TEMPLATE_PRESETS)[number]
): string {
  const preferredScenario = preset.recommendedSourceTypes[0] || "single";
  const naming = toFilenameNamingRuntimeConfig({
    downloadFilenameMode: preset.kind,
    downloadFilenameTemplate: preset.template,
  });

  return renderPreviewScenario(naming, SAMPLE_CONTEXTS[preferredScenario]).videoPath;
}
