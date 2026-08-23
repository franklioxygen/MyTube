import axios from "axios";
import { YT_DLP_STALE_AFTER_DAYS } from "./constants";
import { withYtDlpExecutionsSuspended } from "./executionGate";
import { installYtDlp } from "./install";
import {
  hasCustomConfiguredYtDlpPath,
  resetResolvedYtDlpPath,
  resolveYtDlpPath,
} from "./pathResolver";
import {
  resetJsRuntimeFlag,
  resetRemoteComponentsSupport,
} from "./runtime";
import { getYtDlpVersionInfo } from "./versionProbe";
import { getErrorMessage } from "../errors";
import { logger } from "../logger";

const PYPI_YT_DLP_URL = "https://pypi.org/pypi/yt-dlp/json";
const PYPI_TIMEOUT_MS = 5000;

export type YtDlpStatus = {
  /** Version string reported by `yt-dlp --version`, or null when it cannot run. */
  version: string | null;
  /** Resolved binary the backend actually spawns. */
  path: string;
  available: boolean;
  isStale: boolean;
  staleAfterDays: number;
  /** Latest release on PyPI, or null when the lookup failed/was skipped. */
  latestVersion: string | null;
  /** True only when both versions are known and PyPI is newer. */
  updateAvailable: boolean;
  /**
   * False when YT_DLP_PATH pins a specific binary: a pip upgrade would install
   * somewhere else and leave the pinned binary untouched.
   */
  updateSupported: boolean;
  customPathConfigured: boolean;
  errorMessage?: string;
};

export type YtDlpUpdateResult = {
  previousVersion: string | null;
  status: YtDlpStatus;
  /** True when the reported version actually changed. */
  changed: boolean;
};

/**
 * Parse a yt-dlp release date out of a version string. Accepts both the
 * zero-padded form the binary prints ("2026.08.19") and the PyPI form
 * ("2026.8.19"). Returns null for nightly/unknown formats.
 */
export function parseYtDlpReleaseTimestamp(
  version: string | null | undefined
): number | null {
  if (!version) {
    return null;
  }

  const match = version.trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!match) {
    return null;
  }

  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Compare an installed version against the latest published one. Unknown or
 * unparsable versions never claim an update is available, so the UI stays quiet
 * instead of nagging about a version it cannot reason about.
 */
export function isYtDlpUpdateAvailable(
  installedVersion: string | null,
  latestVersion: string | null
): boolean {
  const installed = parseYtDlpReleaseTimestamp(installedVersion);
  const latest = parseYtDlpReleaseTimestamp(latestVersion);
  if (installed === null || latest === null) {
    return false;
  }
  return latest > installed;
}

/**
 * Look up the newest yt-dlp release on PyPI. Network failures are not fatal:
 * the caller still gets the locally installed version, just without a
 * comparison target.
 */
export async function getLatestYtDlpVersion(): Promise<string | null> {
  try {
    const response = await axios.get<{ info?: { version?: unknown } }>(
      PYPI_YT_DLP_URL,
      {
        headers: { Accept: "application/json", "User-Agent": "MyTube-App" },
        timeout: PYPI_TIMEOUT_MS,
      }
    );
    const version = response.data?.info?.version;
    return typeof version === "string" && version.trim() ? version.trim() : null;
  } catch (error: unknown) {
    logger.debug(
      `[yt-dlp] Could not fetch the latest version from PyPI: ${getErrorMessage(error, "unknown error")}`
    );
    return null;
  }
}

/**
 * Probe the yt-dlp the backend would actually run and, unless skipped, compare
 * it against the latest PyPI release.
 */
export async function getYtDlpStatus(
  options: { checkLatest?: boolean } = {}
): Promise<YtDlpStatus> {
  const { checkLatest = false } = options;
  const ytDlpPath = await resolveYtDlpPath();
  const [versionInfo, latestVersion] = await Promise.all([
    getYtDlpVersionInfo(ytDlpPath),
    checkLatest ? getLatestYtDlpVersion() : Promise.resolve(null),
  ]);

  const customPathConfigured = hasCustomConfiguredYtDlpPath();

  return {
    version: versionInfo.version,
    path: ytDlpPath,
    available: versionInfo.canRun,
    isStale: versionInfo.isStale,
    staleAfterDays: YT_DLP_STALE_AFTER_DAYS,
    latestVersion,
    updateAvailable: isYtDlpUpdateAvailable(versionInfo.version, latestVersion),
    updateSupported: !customPathConfigured,
    customPathConfigured,
    ...(versionInfo.canRun ? {} : { errorMessage: versionInfo.errorMessage }),
  };
}

// Shared across concurrent callers so a double-click cannot start two pip runs.
let inFlightUpdate: Promise<YtDlpUpdateResult> | null = null;

export function isYtDlpUpdateInProgress(): boolean {
  return inFlightUpdate !== null;
}

async function runYtDlpUpdate(): Promise<YtDlpUpdateResult> {
  const previousStatus = await getYtDlpStatus({ checkLatest: false });
  const previousVersion = previousStatus.version;

  logger.info(
    `[yt-dlp] Updating yt-dlp (currently ${previousVersion || "unknown"}) on operator request.`
  );

  // pip replaces the files of the installation downloads are launched from, so
  // hold off new yt-dlp processes until the swap and the cache resets are done.
  await withYtDlpExecutionsSuspended(async () => {
    await installYtDlp({ upgrade: true });

    // The upgrade may have landed a different binary on PATH, so drop every
    // cached capability probe before re-reading the version.
    resetResolvedYtDlpPath();
    resetJsRuntimeFlag();
    resetRemoteComponentsSupport();
  });

  // pip has already performed the requested network operation. Re-probe only
  // the installed binary here; the UI can explicitly check PyPI afterward.
  const status = await getYtDlpStatus({ checkLatest: false });
  logger.info(
    `[yt-dlp] Update finished: ${previousVersion || "unknown"} -> ${status.version || "unknown"}.`
  );

  return {
    previousVersion,
    status,
    changed: Boolean(status.version) && status.version !== previousVersion,
  };
}

/**
 * Upgrade yt-dlp in place via pip so operators do not have to rebuild the
 * image to pick up an extractor fix.
 */
export async function updateYtDlp(): Promise<YtDlpUpdateResult> {
  if (inFlightUpdate) {
    return inFlightUpdate;
  }

  inFlightUpdate = runYtDlpUpdate().finally(() => {
    inFlightUpdate = null;
  });

  return inFlightUpdate;
}
