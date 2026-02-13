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

// Codec filter mapping for format string and formatSort
const BILIBILI_CODEC_MAP: Record<string, { vcodecFilter: string; formatSort: string }> = {
  h264: { vcodecFilter: "avc", formatSort: "vcodec:h264" },
  h265: { vcodecFilter: "hevc", formatSort: "vcodec:h265" },
  av1: { vcodecFilter: "av01", formatSort: "vcodec:av01" },
  vp9: { vcodecFilter: "vp9", formatSort: "vcodec:vp9" },
};

function resolveCodecPreference(): { codecFilter: string; codecFormatSort: string } {
  const appSettings = storageService.getSettings();
  const codecSetting = appSettings?.defaultVideoCodec;
  if (codecSetting && typeof codecSetting === "string" && codecSetting.trim() !== "") {
    const mapped = BILIBILI_CODEC_MAP[codecSetting.trim().toLowerCase()];
    if (mapped) {
      logger.info("Using codec preference for Bilibili:", mapped.vcodecFilter);
      return { codecFilter: mapped.vcodecFilter, codecFormatSort: mapped.formatSort };
    }
  }
  return { codecFilter: "avc", codecFormatSort: "vcodec:h264" };
}

function resolveSubtitleDefaults(userConfig: BilibiliDownloadFlags): {
  writeSubs: any;
  writeAutoSubs: any;
  convertSubs: any;
} {
  return {
    writeSubs: userConfig.writeSubs !== undefined ? userConfig.writeSubs : true,
    writeAutoSubs: userConfig.writeAutoSubs !== undefined ? userConfig.writeAutoSubs : true,
    convertSubs: userConfig.convertSubs !== undefined ? userConfig.convertSubs : "vtt",
  };
}

function resolveBilibiliFormatSort(
  userConfig: BilibiliDownloadFlags,
  codecFormatSort: string,
): string | undefined {
  const userSort = userConfig.S || userConfig.formatSort;
  if (userSort) {
    return userSort;
  }
  // userSort is falsy here, so only f/format would indicate user format control
  if (!userConfig.f && !userConfig.format && codecFormatSort) {
    logger.info("Using format sort for Bilibili codec preference:", codecFormatSort);
    return codecFormatSort;
  }
  return undefined;
}

function resolveBilibiliFormat(userConfig: BilibiliDownloadFlags): {
  downloadFormat: string;
  codecFormatSort: string;
} {
  const hasUserFormat = Boolean(userConfig.f || userConfig.format);
  const hasUserFormatSort = Boolean(userConfig.S || userConfig.formatSort);

  if (hasUserFormat) {
    const downloadFormat = userConfig.f || userConfig.format;
    logger.info("Using user-specified format for Bilibili:", downloadFormat);
    return { downloadFormat, codecFormatSort: "" };
  }

  if (!hasUserFormat && !hasUserFormatSort) {
    const { codecFilter, codecFormatSort } = resolveCodecPreference();
    const downloadFormat =
      `bestvideo[ext=mp4][vcodec^=${codecFilter}]+bestaudio[ext=m4a]/` +
      `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
    return { downloadFormat, codecFormatSort };
  }

  // User has formatSort only — use default format string, let their sort control codec
  return {
    downloadFormat: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    codecFormatSort: "",
  };
}

/**
 * Prepare yt-dlp flags for Bilibili video download
 */
export function prepareBilibiliDownloadFlags(
  url: string,
  outputTemplate: string
): PreparedBilibiliFlags {
  const userConfig = getUserYtDlpConfig(url);
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);

  const { downloadFormat, codecFormatSort } = resolveBilibiliFormat(userConfig);
  const formatSortValue = resolveBilibiliFormatSort(userConfig, codecFormatSort);
  const subtitleDefaults = resolveSubtitleDefaults(userConfig);

  // Prepare base flags from user config (excluding output options we manage)
  const {
    output: _output,
    o: _o,
    f: _f,
    format: _format,
    S: _S,
    formatSort: _formatSort,
    writeSubs: _writeSubs,
    writeAutoSubs: _writeAutoSubs,
    convertSubs: _convertSubs,
    mergeOutputFormat: userMergeOutputFormat,
    ...safeUserConfig
  } = userConfig;

  const mergeOutputFormat = userMergeOutputFormat || "mp4";
  logger.info(`Using merge output format: ${mergeOutputFormat}`);

  const flags: BilibiliDownloadFlags = {
    ...networkConfig,
    ...safeUserConfig,
    output: outputTemplate,
    format: downloadFormat,
    mergeOutputFormat: mergeOutputFormat,
    ...subtitleDefaults,
    ignoreErrors: true,
    noWarnings: false,
  };

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
