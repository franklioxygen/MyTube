import * as storageService from "../../../services/storageService";
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

  // Codec filter mapping for format string and formatSort
  const codecFilterMap: Record<string, { vcodecFilter: string; formatSort: string }> = {
    h264: { vcodecFilter: "avc", formatSort: "vcodec:h264" },
    h265: { vcodecFilter: "hevc", formatSort: "vcodec:h265" },
    av1: { vcodecFilter: "av01", formatSort: "vcodec:av01" },
    vp9: { vcodecFilter: "vp9", formatSort: "vcodec:vp9" },
  };

  // Determine which codec to use: user config > app setting > default (h264)
  let codecFilter = "avc";
  let codecFormatSort = "vcodec:h264";
  let downloadFormat: string;

  const hasUserFormat = Boolean(userConfig.f || userConfig.format);
  const hasUserFormatSort = Boolean(userConfig.S || userConfig.formatSort);
  const hasUserFormatControl = hasUserFormat || hasUserFormatSort;

  if (hasUserFormat) {
    // User specified a format, use it directly
    downloadFormat = userConfig.f || userConfig.format;
    logger.info("Using user-specified format for Bilibili:", downloadFormat);
  } else if (!hasUserFormatControl) {
    // No user format control at all — apply app-level codec preference
    const appSettings = storageService.getSettings();
    const codecSetting = appSettings?.defaultVideoCodec;
    if (codecSetting && typeof codecSetting === "string" && codecSetting.trim() !== "") {
      const mapped = codecFilterMap[codecSetting.trim().toLowerCase()];
      if (mapped) {
        codecFilter = mapped.vcodecFilter;
        codecFormatSort = mapped.formatSort;
        logger.info("Using codec preference for Bilibili:", codecFilter);
      }
    }
    // Build codec-aware format string with fallbacks
    downloadFormat =
      `bestvideo[ext=mp4][vcodec^=${codecFilter}]+bestaudio[ext=m4a]/` +
      `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
  } else {
    // User has formatSort only — use default format string, let their sort control codec
    downloadFormat =
      "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
  }

  // Get format sort option if user specified it
  let formatSortValue = userConfig.S || userConfig.formatSort;
  if (!formatSortValue && !hasUserFormatControl) {
    formatSortValue = codecFormatSort;
    logger.info(
      "Using format sort for Bilibili codec preference:",
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
