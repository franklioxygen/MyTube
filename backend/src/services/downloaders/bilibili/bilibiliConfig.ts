import * as storageService from "../../../services/storageService";
import { resolveExplicitPreferredVideoContainer } from "../../../types/settings";
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

export function resolveBilibiliMergeOutputFormat(
  userConfig: BilibiliDownloadFlags
): string {
  const userMergeOutputFormat =
    typeof userConfig.mergeOutputFormat === "string" &&
    userConfig.mergeOutputFormat
      ? userConfig.mergeOutputFormat
      : undefined;
  if (userMergeOutputFormat) {
    return userMergeOutputFormat;
  }

  const preferredContainer = resolveExplicitPreferredVideoContainer(
    storageService.getSettings()
  );

  // Bilibili's default selectors download MP4 video with M4A audio. Applying a
  // global WebM container would force an incompatible remux; keep MP4 unless the
  // user explicitly overrides Bilibili mergeOutputFormat.
  if (preferredContainer === "webm") {
    return "mp4";
  }

  return preferredContainer || "mp4";
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
export function resolveResolutionPreference(): BilibiliResolutionPreference {
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
 * Decide whether an already-downloaded file should be re-fetched at a higher
 * resolution, and at what floor (issue #295 2-1). Pure so it can be unit tested.
 *
 * Returns the height to pin as a `>=` floor on retry, or null when no retry is
 * warranted: when there is no resolution preference, the actual height is
 * unknown, or the file already matches the best resolution the source can offer
 * (capped at the preference in strict mode).
 */
export function resolveResolutionRetryTarget(
  preference: BilibiliResolutionPreference,
  actualHeight: number | null,
  availableHeights: number[],
): number | null {
  if (preference.height == null || actualHeight == null) {
    return null;
  }

  const candidates = availableHeights.filter(
    (h) => Number.isFinite(h) && h > 0,
  );
  const cappedCandidates = preference.strict
    ? candidates.filter((h) => h <= preference.height!)
    : candidates;
  if (cappedCandidates.length === 0) {
    return null;
  }

  const bestAvailable = Math.max(...cappedCandidates);
  // The best we can realistically achieve: the target, or the source ceiling.
  const desired = Math.min(preference.height, bestAvailable);

  // Already at (or above) the achievable resolution — nothing to gain.
  if (actualHeight >= desired) {
    return null;
  }

  return desired;
}

/**
 * Build a Bilibili mp4-first format string, optionally constrained by a codec
 * filter and/or a height filter. When a strict ceiling is present, the final
 * fallback is also constrained so the cap is never silently exceeded. When a
 * retry floor is present, `floorFallback` can append a final best selector so
 * the retry still produces a file if the floor cannot be met.
 */
function buildBilibiliFormatString(
  codecFilter: string | null,
  heightFilter: string,
  floorFallback?: string,
): string {
  const vcodec = codecFilter ? `[vcodec^=${codecFilter}]` : "";
  const parts = [
    `bestvideo[ext=mp4]${vcodec}${heightFilter}+bestaudio[ext=m4a]`,
    `bestvideo[ext=mp4]${heightFilter}+bestaudio[ext=m4a]`,
    `best[ext=mp4]${heightFilter}`,
    heightFilter ? `best${heightFilter}` : "best",
  ];
  if (floorFallback) {
    // Guarantee a downloadable file even when nothing meets the floor. In strict
    // mode this fallback still carries the height cap so a retry never exceeds it.
    parts.push(floorFallback);
  }
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
  retryFloorHeight?: number,
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
  // every episode still downloads something. On an under-resolution retry a
  // `>=` floor is added to force a higher stream (issue #295 2-1).
  const hasFloor = retryFloorHeight != null && retryFloorHeight > 0;
  const floorFilter = hasFloor ? `[height>=${retryFloorHeight}]` : "";
  const capFilter =
    resolutionPreference.strict && resolutionPreference.height != null
      ? `[height<=${resolutionPreference.height}]`
      : "";
  const heightFilter = `${floorFilter}${capFilter}`;
  // On a retry, guarantee a file even if nothing meets the floor — but in strict
  // mode keep the cap so the fallback can never exceed it (issue #295 2-1).
  const floorFallback = hasFloor
    ? capFilter
      ? `best${capFilter}`
      : "best"
    : undefined;

  if (!hasUserFormatSort) {
    const codecPreference = resolveCodecPreference();
    if (codecPreference) {
      return {
        downloadFormat: buildBilibiliFormatString(
          codecPreference.codecFilter,
          heightFilter,
          floorFallback,
        ),
        codecFormatSort: codecPreference.codecFormatSort,
      };
    }

    return {
      downloadFormat: buildBilibiliFormatString(null, heightFilter, floorFallback),
      codecFormatSort: "",
    };
  }

  // User has formatSort only — use default format string, let their sort control codec
  return {
    downloadFormat: buildBilibiliFormatString(null, heightFilter, floorFallback),
    codecFormatSort: "",
  };
}

/**
 * Prepare yt-dlp flags for Bilibili video download. `retryFloorHeight` is set
 * only by the under-resolution retry path to pin a minimum height.
 */
export function prepareBilibiliDownloadFlags(
  url: string,
  outputTemplate: string,
  options?: { retryFloorHeight?: number }
): PreparedBilibiliFlags {
  const userConfig = getUserYtDlpConfig(url);
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);

  const resolutionPreference = resolveResolutionPreference();
  const { downloadFormat, codecFormatSort } = resolveBilibiliFormat(
    userConfig,
    resolutionPreference,
    options?.retryFloorHeight,
  );
  const formatSortValue = resolveBilibiliFormatSort(
    userConfig,
    codecFormatSort,
    resolutionPreference,
  );
  const subtitleDefaults = resolveSubtitleDefaults(userConfig);
  const mergeOutputFormat = resolveBilibiliMergeOutputFormat(userConfig);

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
    mergeOutputFormat: _mergeOutputFormat,
    ...safeUserConfig
  } = userConfig;

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

/**
 * Hint surfaced to the user when a Bilibili download fails in a way that looks
 * like an auth / risk-control (风控) rejection rather than a generic error.
 */
export const BILIBILI_COOKIE_REFRESH_HINT =
  "Bilibili rejected the request (possible risk control / expired cookie). " +
  "Try refreshing your Bilibili cookie in Settings, then download again.";

// High-signal substrings that indicate Bilibili refused the request for auth /
// risk-control reasons (HTTP 412 + API code -352 are the classic risk-control
// pair; -101 is "not logged in"). Kept conservative so a generic network or
// format error does not trigger a needless backoff retry (issue #295).
const BILIBILI_AUTH_FAILURE_SIGNATURES = [
  "-352",
  "-101",
  // Keep "412" in HTTP-status context so a bare 3-digit number elsewhere in the
  // error (a byte count, an id) does not trigger a needless backoff retry.
  "error 412",
  "precondition failed",
  "风控",
  "risk control",
  "请先登录",
  "需要登录",
  "account_freeze",
  "not logged in",
  "please log in",
];

/**
 * Whether an error/stderr string looks like a Bilibili auth or risk-control
 * rejection (as opposed to a generic download failure). Used to drive a single
 * backoff retry and to surface the cookie-refresh hint (issue #295).
 */
export function isLikelyBilibiliAuthFailure(text?: string | null): boolean {
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  return BILIBILI_AUTH_FAILURE_SIGNATURES.some((signature) =>
    lower.includes(signature)
  );
}
