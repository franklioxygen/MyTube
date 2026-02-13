import * as storageService from "../../../services/storageService";
import { isTwitterUrl, isYouTubeUrl } from "../../../utils/helpers";
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

type UserYtDlpConfig = Record<string, any>;
interface DownloadFlagContext {
  flags: YtDlpFlags;
  config: UserYtDlpConfig;
  isYouTube: boolean;
  isTwitter: boolean;
  formatSortValue?: string;
  youtubeFormat: string;
  mergeOutputFormat: string;
}

const DEFAULT_FORMAT =
  "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best";
const DEFAULT_YOUTUBE_FORMAT =
  "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4][vcodec^=h264]+bestaudio[ext=m4a]/best[ext=mp4]/best";
const TWITTER_SAFARI_FORMAT =
  "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
const YOUTUBE_HIGH_RES_FORMAT =
  "bestvideo[vcodec^=vp9][ext=webm]+bestaudio/bestvideo[ext=webm]+bestaudio/bestvideo+bestaudio/best";

interface CodecConfig {
  formatSortValue: string;
  vcodecFilter: string;
  videoExt: string;
  audioExt: string;
  mergeOutputFormat: string;
}

const CODEC_CONFIGS: Record<string, CodecConfig> = {
  h264: {
    formatSortValue: "vcodec:h264",
    vcodecFilter: "avc1",
    videoExt: "mp4",
    audioExt: "m4a",
    mergeOutputFormat: "mp4",
  },
  h265: {
    formatSortValue: "vcodec:h265",
    vcodecFilter: "hevc",
    videoExt: "mp4",
    audioExt: "m4a",
    mergeOutputFormat: "mp4",
  },
  av1: {
    formatSortValue: "vcodec:av01",
    vcodecFilter: "av01",
    videoExt: "mp4",
    audioExt: "m4a",
    mergeOutputFormat: "mp4",
  },
  vp9: {
    formatSortValue: "vcodec:vp9",
    vcodecFilter: "vp9",
    videoExt: "webm",
    audioExt: "webm",
    mergeOutputFormat: "webm",
  },
};

function getCodecConfigFromSettings(): CodecConfig | null {
  const appSettings = storageService.getSettings();
  const codec = appSettings?.defaultVideoCodec;
  if (!codec || typeof codec !== "string" || codec.trim() === "") {
    return null;
  }
  return CODEC_CONFIGS[codec.trim().toLowerCase()] || null;
}

function hasUserSpecifiedFormat(config: UserYtDlpConfig): boolean {
  return Boolean(config.f || config.format);
}

function hasUserSpecifiedFormatSort(config: UserYtDlpConfig): boolean {
  return Boolean(config.S || config.formatSort);
}

function hasUserFormatControl(config: UserYtDlpConfig): boolean {
  return hasUserSpecifiedFormat(config) || hasUserSpecifiedFormatSort(config);
}

function resolveDownloadFormats(config: UserYtDlpConfig): {
  defaultFormat: string;
  youtubeFormat: string;
} {
  if (!hasUserSpecifiedFormat(config)) {
    return {
      defaultFormat: DEFAULT_FORMAT,
      youtubeFormat: DEFAULT_YOUTUBE_FORMAT,
    };
  }

  const userFormat = config.f || config.format;
  logger.info("Using user-specified format:", userFormat);
  return {
    defaultFormat: userFormat,
    youtubeFormat: userFormat,
  };
}

function extractUserConfigOptions(
  config: UserYtDlpConfig,
): {
  safeUserConfig: UserYtDlpConfig;
  formatSortValue: string | undefined;
  userWriteSubs: any;
  userWriteAutoSubs: any;
  userSubLangs: any;
  userConvertSubs: any;
  userMergeOutputFormat: string | undefined;
  networkOptions: UserYtDlpConfig;
} {
  const {
    output: _output,
    o: _o,
    f: _f,
    format: _format,
    S: userFormatSort,
    formatSort: userFormatSort2,
    writeSubs: userWriteSubs,
    writeAutoSubs: userWriteAutoSubs,
    subLangs: userSubLangs,
    convertSubs: userConvertSubs,
    mergeOutputFormat: userMergeOutputFormat,
    proxy: _proxy,
    ...safeUserConfig
  } = config;

  const networkOptions: UserYtDlpConfig = {};
  if (config.proxy) {
    networkOptions.proxy = config.proxy;
    logger.debug("Preserving proxy in networkOptions:", config.proxy);
  }

  return {
    safeUserConfig,
    formatSortValue: userFormatSort || userFormatSort2,
    userWriteSubs,
    userWriteAutoSubs,
    userSubLangs,
    userConvertSubs,
    userMergeOutputFormat,
    networkOptions,
  };
}

function resolveMergeOutputFormat(args: {
  isTwitter: boolean;
  formatSortValue?: string;
  userMergeOutputFormat?: string;
}): string {
  const { isTwitter, formatSortValue, userMergeOutputFormat } = args;
  if (userMergeOutputFormat) {
    return userMergeOutputFormat;
  }
  if (!isTwitter && formatSortValue && formatSortValue.includes("res")) {
    return "webm";
  }
  return "mp4";
}

function buildBaseFlags(args: {
  safeUserConfig: UserYtDlpConfig;
  networkOptions: UserYtDlpConfig;
  outputPath: string;
  defaultFormat: string;
  mergeOutputFormat: string;
  userWriteSubs: any;
  userWriteAutoSubs: any;
  userSubLangs: any;
  userConvertSubs: any;
}): YtDlpFlags {
  const {
    safeUserConfig,
    networkOptions,
    outputPath,
    defaultFormat,
    mergeOutputFormat,
    userWriteSubs,
    userWriteAutoSubs,
    userSubLangs,
    userConvertSubs,
  } = args;

  return {
    ...safeUserConfig,
    ...networkOptions,
    output: outputPath,
    format: defaultFormat,
    mergeOutputFormat,
    writeSubs: userWriteSubs !== undefined ? userWriteSubs : true,
    writeAutoSubs: userWriteAutoSubs !== undefined ? userWriteAutoSubs : false,
    subLangs: userSubLangs !== undefined ? userSubLangs : "all",
    convertSubs: userConvertSubs !== undefined ? userConvertSubs : "vtt",
    ignoreErrors: true,
  };
}

function applyFormatSortIfProvided(
  flags: YtDlpFlags,
  formatSortValue?: string,
): void {
  if (!formatSortValue) {
    return;
  }
  flags.formatSort = formatSortValue;
  logger.info("Using user-specified format sort:", formatSortValue);
}

function applyTwitterFormatIfNeeded(args: {
  flags: YtDlpFlags;
  isTwitter: boolean;
  config: UserYtDlpConfig;
}): void {
  const { flags, isTwitter, config } = args;
  if (!isTwitter) {
    return;
  }
  if (!hasUserSpecifiedFormat(config)) {
    flags.format = TWITTER_SAFARI_FORMAT;
  }
  logger.info("Twitter/X URL detected - using MP4 format for Safari compatibility");
}

function applyYouTubeFormatIfNeeded(args: {
  flags: YtDlpFlags;
  isYouTube: boolean;
  config: UserYtDlpConfig;
  formatSortValue?: string;
  youtubeFormat: string;
}): void {
  const { flags, isYouTube, config, formatSortValue, youtubeFormat } = args;
  if (!isYouTube) {
    return;
  }
  if (!hasUserSpecifiedFormat(config) && formatSortValue) {
    flags.format = YOUTUBE_HIGH_RES_FORMAT;
    return;
  }
  flags.format = youtubeFormat;
}

function applyPreferredAudioLanguageIfNeeded(
  args: {
    flags: YtDlpFlags;
    isYouTube: boolean;
    config: UserYtDlpConfig;
  },
): boolean {
  const { flags, isYouTube, config } = args;
  if (!isYouTube || hasUserSpecifiedFormat(config)) {
    return false;
  }

  const appSettings = storageService.getSettings();
  const preferredAudioLanguage = appSettings?.preferredAudioLanguage;
  if (
    !preferredAudioLanguage ||
    typeof preferredAudioLanguage !== "string" ||
    preferredAudioLanguage.trim() === ""
  ) {
    return false;
  }

  const lang = preferredAudioLanguage.trim().replace(/["\\]/g, "");
  if (lang.length === 0) {
    return false;
  }

  // Integrate codec preference if set, but only when user hasn't specified formatSort
  const userHasFormatSort = hasUserSpecifiedFormatSort(config);
  const codecConfig = userHasFormatSort ? null : getCodecConfigFromSettings();
  const vf = codecConfig ? codecConfig.vcodecFilter : "avc1";
  const ve = codecConfig ? codecConfig.videoExt : "mp4";
  const ae = codecConfig ? codecConfig.audioExt : "m4a";

  flags.format =
    `bestvideo[ext=${ve}][vcodec^=${vf}]+bestaudio[language=${lang}][ext=${ae}]/` +
    `bestvideo[ext=${ve}][vcodec^=${vf}]+bestaudio[ext=${ae}]/` +
    `bestvideo[ext=${ve}]+bestaudio[language=${lang}]/` +
    `bestvideo[ext=${ve}]+bestaudio[ext=${ae}]/best[ext=${ve}]/best`;
  flags.mergeOutputFormat = codecConfig ? codecConfig.mergeOutputFormat : "mp4";

  if (codecConfig) {
    flags.formatSort = codecConfig.formatSortValue;
  }

  logger.info("Using preferred audio language (with codec preference):", lang, vf);
  return true;
}

function applyDefaultVideoCodecIfNeeded(
  args: {
    flags: YtDlpFlags;
    config: UserYtDlpConfig;
    isTwitter: boolean;
  },
): boolean {
  const { flags, config, isTwitter } = args;
  if (hasUserFormatControl(config) || isTwitter) {
    return false;
  }

  const codecConfig = getCodecConfigFromSettings();
  if (!codecConfig) {
    return false;
  }

  // Apply formatSort to prefer the codec (soft preference, won't fail)
  if (flags.formatSort) {
    flags.formatSort = `${codecConfig.formatSortValue},${flags.formatSort}`;
  } else {
    flags.formatSort = codecConfig.formatSortValue;
  }

  // Build a codec-aware format string with fallbacks
  const vf = codecConfig.vcodecFilter;
  const ve = codecConfig.videoExt;
  const ae = codecConfig.audioExt;
  flags.format =
    `bestvideo[ext=${ve}][vcodec^=${vf}]+bestaudio[ext=${ae}]/` +
    `bestvideo[vcodec^=${vf}]+bestaudio/` +
    `bestvideo[ext=${ve}]+bestaudio[ext=${ae}]/` +
    `bestvideo+bestaudio/best`;

  flags.mergeOutputFormat = codecConfig.mergeOutputFormat;

  logger.info(`Applied default video codec preference: ${vf}`);
  return true;
}

function applyYouTubeExtractorArgsIfNeeded(
  args: {
    flags: YtDlpFlags;
    isYouTube: boolean;
    config: UserYtDlpConfig;
  },
): void {
  const { flags, isYouTube, config } = args;
  if (!isYouTube || !config.extractorArgs || !config.extractorArgs.includes("youtube:")) {
    return;
  }

  flags.extractorArgs = config.extractorArgs;
  if (config.extractorArgs.includes("player_client=android")) {
    flags.addHeader = [
      "Referer:https://www.youtube.com/",
      "User-Agent:Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    ];
  }
}

function appendProviderExtractorArg(flags: YtDlpFlags): void {
  const providerScript = getProviderScript();
  if (!providerScript) {
    return;
  }

  const providerArg = `youtubepot-bgutilscript:script_path=${providerScript}`;
  if (flags.extractorArgs) {
    flags.extractorArgs = `${flags.extractorArgs};${providerArg}`;
    return;
  }
  flags.extractorArgs = providerArg;
}

function finalizeExtractorArgs(flags: YtDlpFlags): void {
  if (!flags.extractorArgs) {
    delete flags.extractorArgs;
  }
}

function logProxyPreservation(flags: YtDlpFlags, config: UserYtDlpConfig): void {
  if (flags.proxy) {
    logger.debug("Proxy in final flags:", flags.proxy);
    return;
  }
  if (config.proxy) {
    logger.warn("Proxy was in config but not in final flags. Config proxy:", config.proxy);
  }
}

function createDownloadFlagContext(
  videoUrl: string,
  outputPath: string,
  config: UserYtDlpConfig,
): DownloadFlagContext {
  const { defaultFormat, youtubeFormat } = resolveDownloadFormats(config);
  const {
    safeUserConfig,
    formatSortValue,
    userWriteSubs,
    userWriteAutoSubs,
    userSubLangs,
    userConvertSubs,
    userMergeOutputFormat,
    networkOptions,
  } = extractUserConfigOptions(config);

  const isTwitter = isTwitterUrl(videoUrl);
  const isYouTube = isYouTubeUrl(videoUrl);
  const mergeOutputFormat = resolveMergeOutputFormat({
    isTwitter,
    formatSortValue,
    userMergeOutputFormat,
  });
  const flags = buildBaseFlags({
    safeUserConfig,
    networkOptions,
    outputPath,
    defaultFormat,
    mergeOutputFormat,
    userWriteSubs,
    userWriteAutoSubs,
    userSubLangs,
    userConvertSubs,
  });

  applyFormatSortIfProvided(flags, formatSortValue);
  applyTwitterFormatIfNeeded({ flags, isTwitter, config });

  return {
    flags,
    config,
    isYouTube,
    isTwitter,
    formatSortValue,
    youtubeFormat,
    mergeOutputFormat,
  };
}

function applyPostBuildRules(context: DownloadFlagContext): string {
  const { flags, isYouTube, isTwitter, config, formatSortValue, youtubeFormat } = context;
  let mergeOutputFormat = context.mergeOutputFormat;

  applyYouTubeFormatIfNeeded({
    flags,
    isYouTube,
    config,
    formatSortValue,
    youtubeFormat,
  });

  // Audio language takes priority and already integrates codec preference internally
  if (applyPreferredAudioLanguageIfNeeded({ flags, isYouTube, config })) {
    mergeOutputFormat = flags.mergeOutputFormat || "mp4";
  } else if (applyDefaultVideoCodecIfNeeded({ flags, config, isTwitter })) {
    // Standalone codec only applies when audio language didn't already handle it
    mergeOutputFormat = flags.mergeOutputFormat || mergeOutputFormat;
  }

  applyYouTubeExtractorArgsIfNeeded({ flags, isYouTube, config });
  appendProviderExtractorArg(flags);
  finalizeExtractorArgs(flags);
  logProxyPreservation(flags, config);
  return mergeOutputFormat;
}

/**
 * Prepare yt-dlp flags for video download
 */
export function prepareDownloadFlags(
  videoUrl: string,
  outputPath: string,
  userConfig?: any,
): PreparedFlags {
  const config = (userConfig || getUserYtDlpConfig(videoUrl) || {}) as UserYtDlpConfig;
  const context = createDownloadFlagContext(videoUrl, outputPath, config);
  const mergeOutputFormat = applyPostBuildRules(context);
  const { flags } = context;

  logger.debug("Final yt-dlp flags:", flags);

  return {
    flags,
    mergeOutputFormat,
  };
}
