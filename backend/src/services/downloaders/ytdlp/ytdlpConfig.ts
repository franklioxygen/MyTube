import * as storageService from "../../../services/storageService";
import {
  normalizeAudioFormat,
  resolveExplicitPreferredVideoContainer,
  type AudioFormat,
} from "../../../types/settings";
import { isTwitchUrl, isTwitterUrl, isYouTubeUrl } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import { getUserYtDlpConfig } from "../../../utils/ytDlpUtils";
import { getProviderScript } from "./ytdlpHelpers";

export interface YtDlpFlags {
  [key: string]: any;
}

export interface PreparedFlags {
  flags: YtDlpFlags;
  mergeOutputFormat: string;
  videoExtension: string;
}

export interface PreparedAudioFlags {
  flags: YtDlpFlags;
  audioExtension: AudioFormat;
}

type UserYtDlpConfig = Record<string, any>;
interface DownloadFlagContext {
  flags: YtDlpFlags;
  config: UserYtDlpConfig;
  isYouTube: boolean;
  isTwitter: boolean;
  isKnownHls: boolean;
  formatSortValue?: string;
  youtubeFormat: string;
  mergeOutputFormat: string;
  hasUserMergeOutputFormat: boolean;
}

const DEFAULT_FORMAT =
  "bestvideo[vcodec!*=av01]+bestaudio/best[vcodec!*=av01]/best";
const DEFAULT_YOUTUBE_FORMAT =
  "bestvideo[vcodec^=vp9][ext=webm]+bestaudio[ext=webm]/bestvideo[vcodec^=vp9]+bestaudio/bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best";
const TWITTER_SAFARI_FORMAT =
  "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
const YOUTUBE_HIGH_RES_FORMAT = DEFAULT_YOUTUBE_FORMAT;

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

// yt-dlp --format-sort field names that let a user's sort already control the
// codec or container. When the user's sort uses one of these, applying the app
// codec preset would clobber their explicit choice, so we leave it untouched.
const CODEC_OR_CONTAINER_SORT_KEYS = new Set([
  "codec",
  "vcodec",
  "acodec",
  "ext",
  "vext",
  "aext",
]);

function userFormatSortControlsCodecOrContainer(
  config: UserYtDlpConfig,
): boolean {
  const sort = config.S || config.formatSort;
  if (typeof sort !== "string") {
    return false;
  }
  return sort.split(",").some((field) => {
    const key = field
      .trim()
      .replace(/^[+-]/, "")
      .split(":")[0]
      ?.trim()
      .toLowerCase();
    return key !== undefined && CODEC_OR_CONTAINER_SORT_KEYS.has(key);
  });
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
  userWriteSubs: unknown;
  userWriteAutoSubs: unknown;
  userSubLangs: unknown;
  userConvertSubs: unknown;
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
  isYouTube: boolean;
  isTwitter: boolean;
  userMergeOutputFormat?: string;
}): string {
  const { isYouTube, isTwitter, userMergeOutputFormat } = args;
  if (userMergeOutputFormat) {
    return userMergeOutputFormat;
  }
  if (isTwitter) {
    return "mp4";
  }
  return isYouTube ? "webm/mp4" : "mp4";
}

function resolvePreferredVideoExtension(mergeOutputFormat: string): string {
  const preferredExtension = mergeOutputFormat
    .split("/")
    .map((value) => value.trim())
    .find(Boolean);
  return preferredExtension || "mp4";
}

function buildBaseFlags(args: {
  safeUserConfig: UserYtDlpConfig;
  networkOptions: UserYtDlpConfig;
  outputPath: string;
  defaultFormat: string;
  mergeOutputFormat: string;
  userWriteSubs: unknown;
  userWriteAutoSubs: unknown;
  userSubLangs: unknown;
  userConvertSubs: unknown;
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
    hasUserMergeOutputFormat: boolean;
  },
): boolean {
  const { flags, isYouTube, config, hasUserMergeOutputFormat } = args;
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
  if (!hasUserMergeOutputFormat) {
    flags.mergeOutputFormat = codecConfig ? codecConfig.mergeOutputFormat : "mp4";
  }

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
    hasUserMergeOutputFormat: boolean;
  },
): boolean {
  const { flags, config, isTwitter, hasUserMergeOutputFormat } = args;
  if (
    hasUserSpecifiedFormat(config) ||
    userFormatSortControlsCodecOrContainer(config) ||
    isTwitter
  ) {
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

  if (!hasUserMergeOutputFormat) {
    flags.mergeOutputFormat = codecConfig.mergeOutputFormat;
  }

  logger.info(`Applied default video codec preference: ${vf}`);
  return true;
}

function isMp4OnlyFormatSelection(format: unknown): boolean {
  if (typeof format !== "string") {
    return false;
  }

  const explicitExtensions = Array.from(
    format.matchAll(/\[ext=([^\]]+)\]/g),
    (match) => match[1]?.trim().toLowerCase(),
  ).filter(Boolean);

  return (
    explicitExtensions.length > 0 &&
    !explicitExtensions.includes("webm") &&
    explicitExtensions.every((ext) => ext === "mp4" || ext === "m4a")
  );
}

const MP4_PREFERRED_FORMAT =
  "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";

function extractAudioLanguageFilter(format: unknown): string | null {
  if (typeof format !== "string") {
    return null;
  }
  return format.match(/\[language=([^\]]+)\]/)?.[1] ?? null;
}

function buildMp4PreferredFormat(previousFormat: unknown): string {
  const lang = extractAudioLanguageFilter(previousFormat);
  if (!lang) {
    return MP4_PREFERRED_FORMAT;
  }

  // Mirror the audio-language selector but prefer MP4/M4A/AVC1, keeping the
  // language constraint on the leading branches and falling back to
  // language-agnostic MP4 so selection never fails when no such audio exists.
  return (
    `bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[language=${lang}][ext=m4a]/` +
    `bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/` +
    `bestvideo[ext=mp4]+bestaudio[language=${lang}]/` +
    `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`
  );
}

function isWebmFirstFormatSelection(format: unknown): boolean {
  if (typeof format !== "string") {
    return false;
  }

  const firstBranch = format
    .split("/")
    .map((value) => value.trim())
    .find(Boolean);
  if (!firstBranch) {
    return false;
  }

  const normalized = firstBranch.toLowerCase();
  return (
    normalized.includes("ext=webm") ||
    normalized.includes("vcodec^=vp9") ||
    normalized.includes("vcodec:vp9")
  );
}

function isDirectHlsManifestUrl(videoUrl: string): boolean {
  try {
    return new URL(videoUrl).pathname.toLowerCase().includes(".m3u8");
  } catch {
    return videoUrl.toLowerCase().includes(".m3u8");
  }
}

function isGenericHlsDefaultFormatSelection(
  format: unknown,
  isKnownHls: boolean,
): boolean {
  return isKnownHls && format === DEFAULT_FORMAT;
}

function applyPreferredVideoContainerIfNeeded(
  flags: YtDlpFlags,
  hasUserMergeOutputFormat: boolean,
  isKnownHls: boolean,
  hasUserFormat: boolean,
): string | null {
  if (hasUserMergeOutputFormat) {
    return null;
  }

  const preferredContainer = resolveExplicitPreferredVideoContainer(
    storageService.getSettings()
  );
  if (!preferredContainer) {
    return null;
  }

  if (preferredContainer === "webm" && isMp4OnlyFormatSelection(flags.format)) {
    logger.info(
      "Skipping preferred WebM container because the selected format is MP4/M4A-only"
    );
    return null;
  }
  if (
    preferredContainer === "webm" &&
    isGenericHlsDefaultFormatSelection(flags.format, isKnownHls)
  ) {
    logger.info(
      "Skipping preferred WebM container because the generic HLS format does not constrain codecs"
    );
    return null;
  }

  // Forcing MP4 only constrains the merge container, not the format selector.
  // A WebM-first selector (default YouTube selector or a VP9 codec preference)
  // would still fetch VP9/WebM streams and remux into an MP4 that does not
  // actually satisfy the compatibility setting, so switch the selector to
  // MP4/M4A. We only rewrite our own default selectors, never a user's format.
  if (
    preferredContainer === "mp4" &&
    !hasUserFormat &&
    isWebmFirstFormatSelection(flags.format)
  ) {
    flags.format = buildMp4PreferredFormat(flags.format);
    logger.info(
      "Switched WebM-first selector to MP4/M4A to satisfy preferred MP4 container"
    );
  }

  flags.mergeOutputFormat = preferredContainer;
  logger.info(`Applied preferred final video container: ${preferredContainer}`);
  return preferredContainer;
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
  const isKnownHls = isTwitchUrl(videoUrl) || isDirectHlsManifestUrl(videoUrl);
  const mergeOutputFormat = resolveMergeOutputFormat({
    isYouTube,
    isTwitter,
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
    isKnownHls,
    formatSortValue,
    youtubeFormat,
    mergeOutputFormat,
    hasUserMergeOutputFormat: Boolean(userMergeOutputFormat),
  };
}

function applyPostBuildRules(context: DownloadFlagContext): string {
  const {
    flags,
    isYouTube,
    isTwitter,
    isKnownHls,
    config,
    formatSortValue,
    youtubeFormat,
    hasUserMergeOutputFormat,
  } = context;
  let mergeOutputFormat = context.mergeOutputFormat;

  applyYouTubeFormatIfNeeded({
    flags,
    isYouTube,
    config,
    formatSortValue,
    youtubeFormat,
  });

  // Audio language takes priority and already integrates codec preference internally
  if (
    applyPreferredAudioLanguageIfNeeded({
      flags,
      isYouTube,
      config,
      hasUserMergeOutputFormat,
    })
  ) {
    mergeOutputFormat = flags.mergeOutputFormat || "mp4";
  } else if (
    applyDefaultVideoCodecIfNeeded({
      flags,
      config,
      isTwitter,
      hasUserMergeOutputFormat,
    })
  ) {
    // Standalone codec only applies when audio language didn't already handle it
    mergeOutputFormat = flags.mergeOutputFormat || mergeOutputFormat;
  }

  const preferredContainer = applyPreferredVideoContainerIfNeeded(
    flags,
    hasUserMergeOutputFormat,
    isKnownHls,
    hasUserSpecifiedFormat(config),
  );
  if (preferredContainer) {
    mergeOutputFormat = preferredContainer;
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
  userConfig?: UserYtDlpConfig,
): PreparedFlags {
  const config = (userConfig || getUserYtDlpConfig(videoUrl) || {}) as UserYtDlpConfig;
  const context = createDownloadFlagContext(videoUrl, outputPath, config);
  const mergeOutputFormat = applyPostBuildRules(context);
  const { flags } = context;

  logger.debug("Final yt-dlp flags:", flags);

  return {
    flags,
    mergeOutputFormat,
    videoExtension: resolvePreferredVideoExtension(mergeOutputFormat),
  };
}

/**
 * Prepare the deliberately small yt-dlp flag set used for audio-only jobs.
 * Video selectors, mux settings, subtitle defaults, and resolution preferences
 * must not leak into this branch, but the remaining safe user config (cookies,
 * browser cookies, custom headers, extractor args, auth, etc.) is preserved so
 * private/age-gated/authenticated sources work the same as video downloads.
 * `extractUserConfigOptions` already strips output/format/subtitle/mux/proxy
 * keys from `safeUserConfig`, so spreading it here cannot reintroduce them.
 */
export function prepareAudioDownloadFlags(
  videoUrl: string,
  outputPath: string,
  audioFormat: AudioFormat,
  userConfig?: UserYtDlpConfig,
): PreparedAudioFlags {
  const config = (userConfig || getUserYtDlpConfig(videoUrl) || {}) as UserYtDlpConfig;
  const { safeUserConfig, networkOptions } = extractUserConfigOptions(config);
  const normalizedFormat = normalizeAudioFormat(audioFormat);
  const flags: YtDlpFlags = {
    ...safeUserConfig,
    ...networkOptions,
    output: outputPath,
    format: "bestaudio/best",
    extractAudio: true,
    audioFormat: normalizedFormat,
    audioQuality: 0,
    ignoreErrors: true,
    noPlaylist: true,
  };

  appendProviderExtractorArg(flags);
  finalizeExtractorArgs(flags);
  logProxyPreservation(flags, config);

  return { flags, audioExtension: normalizedFormat };
}
