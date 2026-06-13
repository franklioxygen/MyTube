import * as storageService from "../../../services/storageService";
import { logger } from "../../../utils/logger";
import {
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../../utils/ytDlpUtils";

export interface BilibiliDownloadFlags {
  [key: string]: string | number | boolean | string[] | undefined | null;
}

export interface PreparedBilibiliFlags {
  flags: BilibiliDownloadFlags;
  mergeOutputFormat: string;
  formatSort?: string;
}

type SupportedStringFlagKey = "S" | "formatSort" | "f" | "format";

function getSupportedStringFlagValue(
  flags: BilibiliDownloadFlags,
  key: SupportedStringFlagKey
): string | number | boolean | string[] | undefined | null {
  switch (key) {
    case "S":
      return flags.S;
    case "formatSort":
      return flags.formatSort;
    case "f":
      return flags.f;
    case "format":
      return flags.format;
  }
}

function getStringFlag(
  flags: BilibiliDownloadFlags,
  ...keys: SupportedStringFlagKey[]
): string | undefined {
  for (const key of keys) {
    const value = getSupportedStringFlagValue(flags, key);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function getBilibiliCodecPreference(
  codec: string,
): { vcodecFilter: string; formatSort: string } | undefined {
  switch (codec) {
    case "h264":
      return { vcodecFilter: "avc", formatSort: "vcodec:h264" };
    case "h265":
      return { vcodecFilter: "hevc", formatSort: "vcodec:h265" };
    case "av1":
      return { vcodecFilter: "av01", formatSort: "vcodec:av01" };
    case "vp9":
      return { vcodecFilter: "vp9", formatSort: "vcodec:vp9" };
    default:
      return undefined;
  }
}

function resolveCodecPreference():
  | { codecFilter: string; codecFormatSort: string }
  | null {
  const appSettings = storageService.getSettings();
  const codecSetting = appSettings.defaultVideoCodec;

  if (typeof codecSetting === "string") {
    const normalizedCodec = codecSetting.trim().toLowerCase();
    if (normalizedCodec !== "") {
      const codecPreference = getBilibiliCodecPreference(normalizedCodec);
      if (codecPreference) {
        logger.info(
          "Using codec preference for Bilibili:",
          codecPreference.vcodecFilter
        );
        return {
          codecFilter: codecPreference.vcodecFilter,
          codecFormatSort: codecPreference.formatSort,
        };
      }
    }
  }
  return null;
}

function resolveSubtitleDefaults(userConfig: BilibiliDownloadFlags): {
  writeSubs: boolean;
  writeAutoSubs: boolean;
  convertSubs: string;
} {
  return {
    writeSubs:
      typeof userConfig.writeSubs === "boolean" ? userConfig.writeSubs : true,
    writeAutoSubs:
      typeof userConfig.writeAutoSubs === "boolean"
        ? userConfig.writeAutoSubs
        : true,
    convertSubs:
      typeof userConfig.convertSubs === "string"
        ? userConfig.convertSubs
        : "vtt",
  };
}

export interface BilibiliResolutionPreference {
  height: number | null;
  strict: boolean;
}

/**
 * Read the preferred video resolution from settings (issue #295).
 * "auto" / empty means no preference. A numeric height (e.g. 1080) is a soft
 * preference applied via -S res:H, or a hard cap (height<=H) when strict.
 */
function resolveResolutionPreference(): BilibiliResolutionPreference {
  const appSettings = storageService.getSettings();
  const strict = appSettings.preferredVideoResolutionStrict === true;
  const raw =
    typeof appSettings.preferredVideoResolution === "string"
      ? appSettings.preferredVideoResolution.trim().toLowerCase()
      : "";

  if (!raw || raw === "auto" || raw === "best") {
    return { height: null, strict };
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { height: null, strict };
  }

  return { height: parsed, strict };
}

/**
 * Build a Bilibili mp4-first format string, optionally constrained by a codec
 * filter and/or a strict height ceiling. When a height filter is present, the
 * final fallback is also constrained so a strict cap is never silently exceeded.
 */
function buildBilibiliFormatString(
  codecFilter: string | null,
  heightFilter: string,
): string {
  const vcodec = codecFilter ? `[vcodec^=${codecFilter}]` : "";
  const parts = [
    `bestvideo[ext=mp4]${vcodec}${heightFilter}+bestaudio[ext=m4a]`,
    `bestvideo[ext=mp4]${heightFilter}+bestaudio[ext=m4a]`,
    `best[ext=mp4]${heightFilter}`,
    heightFilter ? `best${heightFilter}` : "best",
  ];
  // De-duplicate (the first two parts collapse when there is no codec filter).
  return Array.from(new Set(parts)).join("/");
}

function resolveBilibiliFormatSort(
  userConfig: BilibiliDownloadFlags,
  codecFormatSort: string,
  resolutionPreference: BilibiliResolutionPreference,
): string | undefined {
  const userSort = getStringFlag(userConfig, "S", "formatSort");
  if (userSort) {
    return userSort;
  }
  // userSort is falsy here, so only f/format would indicate user format control
  if (userConfig.f || userConfig.format) {
    return undefined;
  }

  // Prefer the target resolution first, then any codec preference. yt-dlp
  // -S res:H prefers the format closest to H (at or below it) while still
  // selecting the best available, which fixes inconsistent per-episode picks.
  const sortFields: string[] = [];
  if (resolutionPreference.height != null) {
    sortFields.push(`res:${resolutionPreference.height}`);
  }
  if (codecFormatSort) {
    sortFields.push(codecFormatSort);
  }

  if (sortFields.length === 0) {
    return undefined;
  }

  const formatSort = sortFields.join(",");
  logger.info("Using format sort for Bilibili:", formatSort);
  return formatSort;
}

function resolveBilibiliFormat(
  userConfig: BilibiliDownloadFlags,
  resolutionPreference: BilibiliResolutionPreference,
): {
  downloadFormat: string;
  codecFormatSort: string;
} {
  const userFormat = getStringFlag(userConfig, "f", "format");
  const hasUserFormat = Boolean(userFormat);
  const hasUserFormatSort = Boolean(getStringFlag(userConfig, "S", "formatSort"));

  if (hasUserFormat) {
    logger.info("Using user-specified format for Bilibili:", userFormat);
    return { downloadFormat: userFormat ?? "best", codecFormatSort: "" };
  }

  // A strict resolution cap is enforced in the format selectors so the
  // downloader never silently exceeds the requested ceiling. A soft preference
  // is handled by formatSort (-S res:H) and leaves the selectors permissive so
  // every episode still downloads something.
  const heightFilter =
    resolutionPreference.strict && resolutionPreference.height != null
      ? `[height<=${resolutionPreference.height}]`
      : "";

  if (!hasUserFormatSort) {
    const codecPreference = resolveCodecPreference();
    if (codecPreference) {
      return {
        downloadFormat: buildBilibiliFormatString(
          codecPreference.codecFilter,
          heightFilter,
        ),
        codecFormatSort: codecPreference.codecFormatSort,
      };
    }

    return {
      downloadFormat: buildBilibiliFormatString(null, heightFilter),
      codecFormatSort: "",
    };
  }

  // User has formatSort only — use default format string, let their sort control codec
  return {
    downloadFormat: buildBilibiliFormatString(null, heightFilter),
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

  const resolutionPreference = resolveResolutionPreference();
  const { downloadFormat, codecFormatSort } = resolveBilibiliFormat(
    userConfig,
    resolutionPreference,
  );
  const formatSortValue = resolveBilibiliFormatSort(
    userConfig,
    codecFormatSort,
    resolutionPreference,
  );
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
