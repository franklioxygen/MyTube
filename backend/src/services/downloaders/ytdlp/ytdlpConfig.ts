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
  // Explicitly preserve network-related options like proxy
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
    proxy: _proxy, // Proxy is handled separately in networkOptions to ensure it's preserved
    ...safeUserConfig
  } = config;

  // Explicitly preserve proxy and other network options to ensure they're not lost
  // This is critical for download operations that need proxy settings
  const networkOptions: Record<string, any> = {};
  if (config.proxy) {
    networkOptions.proxy = config.proxy;
    logger.debug("Preserving proxy in networkOptions:", config.proxy);
  }

  // Get format sort option if user specified it
  const formatSortValue = userFormatSort || userFormatSort2;

  // Check if this is a Twitter/X URL - always use mp4 for Safari compatibility
  const isTwitterUrl =
    videoUrl.includes("x.com") || videoUrl.includes("twitter.com");

  // Determine merge output format: use user's choice or default to mp4
  // However, if user is sorting by resolution (likely demanding 4K/VP9), default to WebM
  // because VP9/AV1 in MP4 (mp4v2) is often problematic for Safari/QuickTime.
  // Exception: Twitter/X always uses mp4 for Safari compatibility
  let defaultMergeFormat = "mp4";
  if (!isTwitterUrl && formatSortValue && formatSortValue.includes("res")) {
    // Use WebM for high-res (likely VP9/AV1) as it's supported by Safari 14+ and Chrome
    // But skip this for Twitter/X to ensure Safari compatibility
    defaultMergeFormat = "webm";
  }
  const mergeOutputFormat = userMergeOutputFormat || defaultMergeFormat;

  // Prepare flags - defaults first, then user config to allow overrides
  // Network options (like proxy) are applied last to ensure they're not overridden
  const flags: YtDlpFlags = {
    ...safeUserConfig, // Apply user config
    ...networkOptions, // Explicitly apply network options (proxy, etc.) to ensure they're preserved
    output: outputPath, // Always use our output path with correct extension
    format: defaultFormat,
    // Use user preferences if provided, otherwise use defaults
    mergeOutputFormat: mergeOutputFormat,
    writeSubs: userWriteSubs !== undefined ? userWriteSubs : true,
    writeAutoSubs: userWriteAutoSubs !== undefined ? userWriteAutoSubs : true,
    convertSubs: userConvertSubs !== undefined ? userConvertSubs : "vtt",
  };

  // Apply format sort if user specified it (e.g., -S res:480)
  if (formatSortValue) {
    flags.formatSort = formatSortValue;
    logger.info("Using user-specified format sort:", formatSortValue);
  }

  // Add Twitter/X specific flags - always use MP4 with H.264 for Safari compatibility
  if (isTwitterUrl) {
    // Force MP4 format with H.264 codec for Safari compatibility
    // Twitter/X videos should use MP4 container regardless of resolution
    if (!config.f && !config.format) {
      flags.format =
        "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
    }
    // Ensure merge output format is mp4 (already handled above, but log it)
    logger.info(
      "Twitter/X URL detected - using MP4 format for Safari compatibility"
    );
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
    if (config.extractorArgs && config.extractorArgs.includes("youtube:")) {
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
  }

  // Add provider script if configured
  // Merge with user's extractorArgs if both exist (using semicolon separator)
  const PROVIDER_SCRIPT = getProviderScript();
  if (PROVIDER_SCRIPT) {
    const providerArg = `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`;
    if (flags.extractorArgs) {
      // Merge user extractorArgs with provider script using semicolon separator
      // yt-dlp supports multiple --extractor-args flags or semicolon-separated values
      flags.extractorArgs = `${flags.extractorArgs};${providerArg}`;
    } else {
      flags.extractorArgs = providerArg;
    }
  }

  // Remove the extractorArgs if not needed - let yt-dlp handle it
  if (!flags.extractorArgs) {
    delete flags.extractorArgs;
  }

  // Log proxy in final flags for debugging
  if (flags.proxy) {
    logger.debug("Proxy in final flags:", flags.proxy);
  } else if (config.proxy) {
    logger.warn(
      "Proxy was in config but not in final flags. Config proxy:",
      config.proxy
    );
  }

  logger.debug("Final yt-dlp flags:", flags);

  return {
    flags,
    mergeOutputFormat,
  };
}
