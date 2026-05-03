import path from "path";
import {
  IMAGES_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import { formatVideoFilename } from "../../utils/helpers";
import { resolveSafeChildPath } from "../../utils/security";
import { computeAliases } from "./aliases";
import { getPresetById } from "./presets";
import {
  enforcePathLengthLimit,
  replaceSegmentSeparators,
  sanitizeRelativePath,
} from "./sanitize";
import {
  FilenameTemplateContext,
  RenderedMediaPath,
  RenderFilenameTemplateInput,
  TemplateWarning,
} from "./types";
import { validateTemplate } from "./validators";

// Map from Liquid variable names to context field names or special-cased values
function buildLiquidVarMap(
  ctx: FilenameTemplateContext,
  aliases: Record<string, string>
): Record<string, string> {
  return {
    title: ctx.title,
    id: ctx.id,
    ext: ctx.ext,
    uploader: ctx.uploader,
    channel: ctx.channel,
    upload_date: ctx.uploadDate,
    upload_yyyy_mm_dd: ctx.uploadDate
      ? `${ctx.uploadYear}-${ctx.uploadMonth}-${ctx.uploadDay}`
      : "",
    upload_year: ctx.uploadYear,
    upload_month: ctx.uploadMonth,
    upload_day: ctx.uploadDay,
    duration_string: ctx.durationString,
    artist_name: ctx.artistName,
    source_custom_name: ctx.sourceCustomName,
    source_collection_name: ctx.sourceCollectionName,
    source_collection_id: ctx.sourceCollectionId,
    source_collection_type: ctx.sourceCollectionType,
    media_playlist_index:
      ctx.mediaPlaylistIndex !== undefined
        ? String(ctx.mediaPlaylistIndex).padStart(2, "0")
        : "00",
    ...aliases,
  };
}

// Map from yt-dlp variable names to liquid variable names
const YTDLP_TO_LIQUID: Record<string, string> = {
  title: "title",
  id: "id",
  channel: "channel",
  uploader: "uploader",
  upload_date: "upload_date",
  ext: "ext",
};

function formatDuration(
  seconds: number | undefined,
  fmt: string
): string {
  if (!seconds || seconds <= 0) return "00-00-00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return fmt
    .replace("%H", String(h).padStart(2, "0"))
    .replace("%M", String(m).padStart(2, "0"))
    .replace("%S", String(s).padStart(2, "0"));
}

function formatDate(yyyymmdd: string, fmt: string): string {
  if (yyyymmdd.length < 8) return yyyymmdd;
  return fmt
    .replace("%Y", yyyymmdd.slice(0, 4))
    .replace("%m", yyyymmdd.slice(4, 6))
    .replace("%d", yyyymmdd.slice(6, 8));
}

function resolveNestedPath(
  rawInfo: Record<string, unknown> | undefined,
  dotPath: string
): string {
  if (!rawInfo) return UNKNOWN_FALLBACK;
  const parts = dotPath.split(".");
  let current: unknown = rawInfo;
  for (const part of parts) {
    if (current === null || current === undefined) return UNKNOWN_FALLBACK;
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      if (isNaN(idx)) return UNKNOWN_FALLBACK;
      current = current[idx < 0 ? current.length + idx : idx];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return UNKNOWN_FALLBACK;
    }
  }
  return current !== undefined && current !== null ? String(current) : UNKNOWN_FALLBACK;
}

const UNKNOWN_FALLBACK = "Unknown";

/**
 * Replaces all Liquid-style {{ var }} placeholders.
 * Alias values can contain "/" (they represent path segments) and are left intact
 * here — segment splitting happens after all substitutions.
 */
function replaceLiquidVars(
  template: string,
  varMap: Record<string, string>
): { result: string; warnings: TemplateWarning[] } {
  const warnings: TemplateWarning[] = [];
  const result = template.replace(
    /\{\{[ \t]*([a-zA-Z0-9_]+)[ \t]*\}\}/g,
    (match, varName) => {
      if (varName in varMap) {
        const val = varMap[varName];
        // Alias vars (containing /) are allowed to pass through as-is
        if (varName.startsWith("season_") || varName.startsWith("static_")) {
          return val;
        }
        return replaceSegmentSeparators(val || UNKNOWN_FALLBACK);
      }
      warnings.push({
        code: "unknown_variable",
        message: `Unknown template variable: {{ ${varName} }}`,
      });
      return UNKNOWN_FALLBACK;
    }
  );
  return { result, warnings };
}

/**
 * Replaces all yt-dlp-style %(<expr>)<conv> placeholders.
 */
function replaceYtDlpVars(
  template: string,
  ctx: FilenameTemplateContext,
  liquidVarMap: Record<string, string>
): { result: string; warnings: TemplateWarning[] } {
  const warnings: TemplateWarning[] = [];
  const result = template.replace(
    /%\(([^)]+)\)([a-zA-Z])/g,
    (match, expr, conv) => {
      const gtIdx = expr.indexOf(">");
      const varPart = gtIdx >= 0 ? expr.slice(0, gtIdx) : expr;
      const fmtPart = gtIdx >= 0 ? expr.slice(gtIdx + 1) : undefined;

      // Nested dot-path lookup from rawInfo
      if (varPart.includes(".")) {
        const val = resolveNestedPath(ctx.rawInfo, varPart);
        return replaceSegmentSeparators(val);
      }

      // Duration with format string
      if (varPart === "duration" && fmtPart) {
        return formatDuration(ctx.durationSeconds, fmtPart);
      }

      // Date with format string
      if (varPart === "upload_date" && fmtPart) {
        return formatDate(ctx.uploadDate, fmtPart);
      }

      // Simple variable lookup
      const liquidName = YTDLP_TO_LIQUID[varPart];
      if (liquidName && liquidName in liquidVarMap) {
        return replaceSegmentSeparators(liquidVarMap[liquidName] || UNKNOWN_FALLBACK);
      }

      warnings.push({
        code: "unknown_variable",
        message: `Unknown yt-dlp placeholder: %(${expr})${conv}`,
      });
      return UNKNOWN_FALLBACK;
    }
  );
  return { result, warnings };
}

/**
 * Core render function.
 */
export function renderFilenameTemplate(
  input: RenderFilenameTemplateInput
): RenderedMediaPath {
  const { template, context, extension } = input;
  const warnings: TemplateWarning[] = [];

  // Inject ext into context for this render
  const ctx: FilenameTemplateContext = { ...context, ext: extension };

  // Step 1: Normalize template
  let normalized = template.trim().replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }

  // Step 2: Validate
  const validation = validateTemplate(normalized, ctx.sourceCollectionType);
  if (!validation.valid) {
    throw new Error(
      `Template validation failed: ${validation.errors.join("; ")}`
    );
  }
  warnings.push(...validation.warnings);

  // Step 3: Compute aliases
  const aliases = computeAliases(ctx);

  // Step 4: Build variable maps
  const liquidVarMap = buildLiquidVarMap(ctx, aliases);

  // Step 5: Replace Liquid variables (aliases may contain "/" segments)
  const liquidResult = replaceLiquidVars(normalized, liquidVarMap);
  warnings.push(...liquidResult.warnings);

  // Step 6: Replace yt-dlp variables
  const ytdlpResult = replaceYtDlpVars(liquidResult.result, ctx, liquidVarMap);
  warnings.push(...ytdlpResult.warnings);

  const rendered = ytdlpResult.result;

  // Step 7: Sanitize segments
  const sanitizeResult = sanitizeRelativePath(rendered);
  if (!sanitizeResult) {
    throw new Error(
      `Template rendered to an invalid path after sanitization: "${rendered}"`
    );
  }

  // Step 8: Enforce length limits
  const finalSegments = enforcePathLengthLimit(sanitizeResult.segments);
  const finalRelative = finalSegments.join("/");

  if (finalRelative !== sanitizeResult.sanitized) {
    warnings.push({
      code: "path_truncated",
      message: "Path was truncated to fit within the maximum length limit.",
    });
  }

  const basename = finalSegments[finalSegments.length - 1] || "";
  const dotIdx = basename.lastIndexOf(".");
  const basenameWithoutExt = dotIdx > 0 ? basename.slice(0, dotIdx) : basename;
  const actualExtension = dotIdx > 0 ? basename.slice(dotIdx + 1) : extension;
  const directory = finalSegments.slice(0, -1).join("/");

  return {
    relativePath: finalRelative,
    directory,
    basename,
    basenameWithoutExt,
    extension: actualExtension,
    warnings,
  };
}

/**
 * Plans the full output paths for a video, thumbnail, and subtitles.
 */
export function planVideoOutputPaths(input: {
  settings: {
    downloadFilenamePresetId?: string;
    downloadFilenameTemplate?: string;
  };
  context: FilenameTemplateContext;
  videoExtension: string;
  thumbnailExtension?: "jpg" | "png" | "webp";
  moveThumbnailsToVideoFolder: boolean;
  moveSubtitlesToVideoFolder: boolean;
  subtitleLanguages?: string[];
  existingReservedPaths?: Set<string>;
}): import("./types").PlannedMediaOutput {
  const {
    settings,
    context,
    videoExtension,
    thumbnailExtension = "jpg",
    moveThumbnailsToVideoFolder,
    moveSubtitlesToVideoFolder,
  } = input;

  const presetId = settings.downloadFilenamePresetId || "legacy";

  // Legacy preset bypasses the template renderer entirely so output is
  // byte-identical to formatVideoFilename(). The renderer's sanitizer keeps
  // commas/spaces/etc. that formatVideoFilename strips, so a Liquid template
  // would not produce the same name and the rename job would not detect that
  // existing legacy files are already at the target.
  let rendered: RenderedMediaPath;
  if (presetId === "legacy") {
    const stem = formatVideoFilename(
      context.title,
      context.uploader,
      context.uploadDate
    );
    const basename = `${stem}.${videoExtension}`;
    rendered = {
      relativePath: basename,
      directory: "",
      basename,
      basenameWithoutExt: stem,
      extension: videoExtension,
      warnings: [],
    };
  } else {
    let template: string;
    if (presetId === "custom") {
      template =
        settings.downloadFilenameTemplate ||
        `{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}`;
    } else {
      const preset = getPresetById(presetId);
      template = preset
        ? preset.template
        : `{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}`;
    }
    rendered = renderFilenameTemplate({
      template,
      context,
      mode: "video",
      extension: videoExtension,
    });
  }

  const videoRelativePath = rendered.relativePath;
  const videoAbsolutePath = resolveSafeChildPath(VIDEOS_DIR, videoRelativePath);
  const videoWebPath = `/videos/${videoRelativePath}`;

  // Thumbnail uses same stem + thumbnail extension
  const thumbnailFilename = `${rendered.basenameWithoutExt}.${thumbnailExtension}`;
  const thumbnailDirectory = rendered.directory;
  const thumbnailRelativePath = thumbnailDirectory
    ? `${thumbnailDirectory}/${thumbnailFilename}`
    : thumbnailFilename;

  let thumbnailAbsolutePath: string;
  let thumbnailWebPath: string;
  if (moveThumbnailsToVideoFolder) {
    thumbnailAbsolutePath = resolveSafeChildPath(VIDEOS_DIR, thumbnailRelativePath);
    thumbnailWebPath = `/videos/${thumbnailRelativePath}`;
  } else {
    thumbnailAbsolutePath = resolveSafeChildPath(IMAGES_DIR, thumbnailRelativePath);
    thumbnailWebPath = `/images/${thumbnailRelativePath}`;
  }

  // Subtitle base directory and stem
  const subtitleDirectory = thumbnailDirectory;
  let subtitleAbsoluteDirectory: string;
  let subtitleWebDirectory: string;
  if (moveSubtitlesToVideoFolder) {
    subtitleAbsoluteDirectory = subtitleDirectory
      ? resolveSafeChildPath(VIDEOS_DIR, subtitleDirectory)
      : VIDEOS_DIR;
    subtitleWebDirectory = subtitleDirectory
      ? `/videos/${subtitleDirectory}`
      : "/videos";
  } else {
    subtitleAbsoluteDirectory = subtitleDirectory
      ? resolveSafeChildPath(SUBTITLES_DIR, subtitleDirectory)
      : SUBTITLES_DIR;
    subtitleWebDirectory = subtitleDirectory
      ? `/subtitles/${subtitleDirectory}`
      : "/subtitles";
  }

  return {
    video: {
      relativePath: videoRelativePath,
      absolutePath: videoAbsolutePath,
      webPath: videoWebPath,
      filename: rendered.basename,
      basenameWithoutExt: rendered.basenameWithoutExt,
    },
    thumbnail: {
      relativePath: thumbnailRelativePath,
      absolutePath: thumbnailAbsolutePath,
      webPath: thumbnailWebPath,
      filename: thumbnailFilename,
    },
    subtitle: {
      relativeDirectory: subtitleDirectory,
      absoluteDirectory: subtitleAbsoluteDirectory,
      webDirectory: subtitleWebDirectory,
      baseNameWithoutLanguageOrExt: rendered.basenameWithoutExt,
    },
    warnings: rendered.warnings,
  };
}

/**
 * Resolves absolute directory for a mode + relative directory path.
 */
export function resolveAbsoluteDir(
  relativeDir: string,
  mode: "video" | "thumbnail" | "subtitle",
  moveThumbnailsToVideoFolder: boolean,
  moveSubtitlesToVideoFolder: boolean
): string {
  if (mode === "video") {
    return relativeDir
      ? path.join(VIDEOS_DIR, relativeDir)
      : VIDEOS_DIR;
  }
  if (mode === "thumbnail") {
    const base = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;
    return relativeDir ? path.join(base, relativeDir) : base;
  }
  const base = moveSubtitlesToVideoFolder ? VIDEOS_DIR : SUBTITLES_DIR;
  return relativeDir ? path.join(base, relativeDir) : base;
}
