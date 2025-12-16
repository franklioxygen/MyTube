import { logger } from "../../../utils/logger";
import { getUserYtDlpConfig } from "../../../utils/ytDlpUtils";
import { getProviderScript } from "./ytdlpHelpers";

export interface YtDlpFlags {
  [key: string]: any;
}

export interface PreparedFlags {
  flags: YtDlpFlags;
  mergeOutputFormat: string;
}

/**
 * Prepare yt-dlp flags for video download
 */
export function prepareDownloadFlags(
  videoUrl: string,
  outputPath: string,
  userConfig?: any
): PreparedFlags {
  // Get user's yt-dlp configuration if not provided
  const config = userConfig || getUserYtDlpConfig(videoUrl);

  // Default format based on user config or fallback
  let defaultFormat =
    "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best";
  let youtubeFormat =
    "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4][vcodec^=h264]+bestaudio[ext=m4a]/best[ext=mp4]/best";

  // If user specified a format, use it (but still apply MP4 container preference)
  if (config.f || config.format) {
    const userFormat = config.f || config.format;
    defaultFormat = userFormat;
    youtubeFormat = userFormat;
    logger.info("Using user-specified format:", userFormat);
  }

  // Prepare base flags from user config (excluding output options we manage)
  const {
    output: _output, // Ignore user output template (we manage this)
    o: _o,
    f: _f, // Format is handled specially above
    format: _format,
    S: userFormatSort, // Format sort is handled specially
    formatSort: userFormatSort2,
    // Extract user subtitle preferences (use them if provided)
    writeSubs: userWriteSubs,
    writeAutoSubs: userWriteAutoSubs,
    convertSubs: userConvertSubs,
    // Extract user merge output format (use it if provided)
    mergeOutputFormat: userMergeOutputFormat,
    ...safeUserConfig
  } = config;

  // Get format sort option if user specified it
  const formatSortValue = userFormatSort || userFormatSort2;

  // Determine merge output format: use user's choice or default to mp4
  // However, if user is sorting by resolution (likely demanding 4K/VP9), default to MKV
  // because VP9/AV1 in MP4 (mp4v2) is often problematic for Safari/QuickTime.
  let defaultMergeFormat = "mp4";
  if (formatSortValue && formatSortValue.includes("res")) {
    // Use WebM for high-res (likely VP9/AV1) as it's supported by Safari 14+ and Chrome
    defaultMergeFormat = "webm";
  }
  const mergeOutputFormat = userMergeOutputFormat || defaultMergeFormat;

  // Prepare flags - defaults first, then user config to allow overrides
  const flags: YtDlpFlags = {
    ...safeUserConfig, // Apply user config
    output: outputPath, // Always use our output path with correct extension
    format: defaultFormat,
    // Use user preferences if provided, otherwise use defaults
    mergeOutputFormat: mergeOutputFormat,
    writeSubs: userWriteSubs !== undefined ? userWriteSubs : true,
    writeAutoSubs:
      userWriteAutoSubs !== undefined ? userWriteAutoSubs : true,
    convertSubs: userConvertSubs !== undefined ? userConvertSubs : "vtt",
  };

  // Apply format sort if user specified it (e.g., -S res:480)
  if (formatSortValue) {
    flags.formatSort = formatSortValue;
    logger.info("Using user-specified format sort:", formatSortValue);
  }

  // Add YouTube specific flags if it's a YouTube URL
  // Always apply preferred formats for YouTube to ensure codec compatibility (H.264/AAC for Safari)
  if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
    // If the user hasn't specified a format (-f), but HAS specified a sorting order (-S),
    // we should assume they want to prioritize their sort order (e.g. resolution) over
    // our default strictly-compatible codec constraints.
    // This fixes the issue where -S res:2160 fails because the default format restricts to H.264 (max 1080p).
    if (!config.f && !config.format && formatSortValue) {
      // Allow any video codec (including VP9/AV1 for 4K), but try to keep audio good
      // Prioritize VP9 in WebM for Safari 14+ compatibility (AV1 is less supported)
      flags.format =
        "bestvideo[vcodec^=vp9][ext=webm]+bestaudio/bestvideo[ext=webm]+bestaudio/bestvideo+bestaudio/best";
    } else {
      flags.format = youtubeFormat;
    }

    // Use user's extractor args if provided, otherwise let yt-dlp use its defaults
    // Modern yt-dlp (2025.11+) has built-in JS challenge solvers that work without PO tokens
    if (
      config.extractorArgs &&
      config.extractorArgs.includes("youtube:")
    ) {
      // User has YouTube-specific args, use them
      flags.extractorArgs = config.extractorArgs;

      // If user is using android client, add appropriate headers
      if (config.extractorArgs.includes("player_client=android")) {
        flags.addHeader = [
          "Referer:https://www.youtube.com/",
          "User-Agent:Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        ];
      }
    }
    // Remove the extractorArgs default if not needed - let yt-dlp handle it
    if (!flags.extractorArgs) {
      delete flags.extractorArgs;
    }
  }

  // Add provider script if configured
  const PROVIDER_SCRIPT = getProviderScript();
  if (PROVIDER_SCRIPT) {
    flags.extractorArgs = `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`;
  }

  logger.debug("Final yt-dlp flags:", flags);

  return {
    flags,
    mergeOutputFormat,
  };
}

