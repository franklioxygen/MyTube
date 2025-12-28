import { logger } from "../../../utils/logger";
import {
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../../utils/ytDlpUtils";

export interface BilibiliDownloadFlags {
  [key: string]: any;
}

export interface PreparedBilibiliFlags {
  flags: BilibiliDownloadFlags;
  mergeOutputFormat: string;
  formatSort?: string;
}

/**
 * Prepare yt-dlp flags for Bilibili video download
 */
export function prepareBilibiliDownloadFlags(
  url: string,
  outputTemplate: string
): PreparedBilibiliFlags {
  // Get user's yt-dlp configuration for network settings
  const userConfig = getUserYtDlpConfig(url);
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);

  // Default format - explicitly require H.264 (avc1) codec for Safari compatibility
  // Safari doesn't support HEVC/H.265 or other codecs that Bilibili might serve
  let downloadFormat =
    "bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";

  // If user specified a format, use it
  if (userConfig.f || userConfig.format) {
    downloadFormat = userConfig.f || userConfig.format;
    logger.info("Using user-specified format for Bilibili:", downloadFormat);
  }

  // Get format sort option if user specified it
  // Default to preferring H.264 codec for Safari compatibility
  let formatSortValue = userConfig.S || userConfig.formatSort;
  if (!formatSortValue && !(userConfig.f || userConfig.format)) {
    // If user hasn't specified format or format sort, prefer H.264 for compatibility
    formatSortValue = "vcodec:h264";
    logger.info(
      "Using default format sort for Safari compatibility:",
      formatSortValue
    );
  }

  // Prepare base flags from user config (excluding output options we manage)
  const {
    output: _output,
    o: _o,
    f: _f,
    format: _format,
    S: _S,
    formatSort: _formatSort,
    // Extract user subtitle preferences (use them if provided)
    writeSubs: userWriteSubs,
    writeAutoSubs: userWriteAutoSubs,
    convertSubs: userConvertSubs,
    // Extract user merge output format (use it if provided)
    mergeOutputFormat: userMergeOutputFormat,
    ...safeUserConfig
  } = userConfig;

  // Determine merge output format: use user's choice or default to mp4
  const mergeOutputFormat = userMergeOutputFormat || "mp4";
  logger.info(`Using merge output format: ${mergeOutputFormat}`);

  // Prepare flags for yt-dlp - merge user config with required settings
  const flags: BilibiliDownloadFlags = {
    ...networkConfig, // Apply network settings
    ...safeUserConfig, // Apply other user config
    output: outputTemplate,
    format: downloadFormat,
    // Use user preferences if provided, otherwise use defaults
    mergeOutputFormat: mergeOutputFormat,
    writeSubs: userWriteSubs !== undefined ? userWriteSubs : true,
    writeAutoSubs: userWriteAutoSubs !== undefined ? userWriteAutoSubs : true,
    convertSubs: userConvertSubs !== undefined ? userConvertSubs : "vtt",
    ignoreErrors: true, // Continue even if subtitle download fails
    noWarnings: false, // Show warnings for debugging
  };

  // Apply format sort (either user-specified or default H.264 preference)
  if (formatSortValue) {
    flags.formatSort = formatSortValue;
    logger.info("Using format sort for Bilibili:", formatSortValue);
  }

  logger.info("Final Bilibili yt-dlp flags:", flags);

  return {
    flags,
    mergeOutputFormat,
    formatSort: formatSortValue,
  };
}
