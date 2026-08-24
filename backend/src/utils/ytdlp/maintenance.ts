import axios from "axios";
import { YT_DLP_STALE_AFTER_DAYS } from "./constants";
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
import {
  parseYtDlpReleaseTimestamp,
  isYtDlpUpdateAvailable,
} from "./versionStamp";
import { recoverUsableManagedRelease } from "./release";
import {
  isManagedReleaseUnusable,
  managedReleaseRunsCached,
} from "./release/recover";
import {
  loadManagedRelease,
  readCurrentManifest,
} from "./release/manifests";
import { isReleaseStale } from "./release/acquire";
import { getYtDlpVersionInfo } from "./versionProbe";
import { getErrorMessage } from "../errors";
import { logger } from "../logger";

const PYPI_YT_DLP_URL = "https://pypi.org/pypi/yt-dlp/json";
const PYPI_TIMEOUT_MS = 5000;

export { parseYtDlpReleaseTimestamp, isYtDlpUpdateAvailable };

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
  const customPathConfigured = hasCustomConfiguredYtDlpPath();
  const latestVersion = checkLatest
    ? await getLatestYtDlpVersion()
    : null;

  if (!customPathConfigured) {
    const managed = recoverUsableManagedRelease();
    // Existence is not usability. Without this the endpoint would report a
    // release that cannot run as available, and an operator update would then
    // treat a same-version repair as a redundant no-op.
    if (managed && (await managedReleaseRunsCached(managed))) {
      const version = managed.release.version;
      return {
        version,
        path: managed.release.pythonExecutable,
        available: true,
        isStale: isReleaseStale(version),
        staleAfterDays: YT_DLP_STALE_AFTER_DAYS,
        latestVersion,
        updateAvailable: isYtDlpUpdateAvailable(version, latestVersion),
        updateSupported: true,
        customPathConfigured,
      };
    }
  }

  const ytDlpPath = await resolveYtDlpPath();
  const versionInfo = await getYtDlpVersionInfo(ytDlpPath);

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

/**
 * Whether the release current.json names cannot run.
 *
 * Deliberately reads the pointer rather than going through
 * recoverUsableManagedRelease: that helper hides releases already known to be
 * unusable, which is exactly the case this needs to detect.
 */
async function currentManagedReleaseIsBroken(): Promise<boolean> {
  if (hasCustomConfiguredYtDlpPath()) {
    return false;
  }
  const current = readCurrentManifest();
  if (!current) {
    return false;
  }
  if (isManagedReleaseUnusable(current.releaseId)) {
    return true;
  }
  const loaded = loadManagedRelease(current.releaseId, current);
  if (!loaded) {
    // The pointer names a release whose directory or site-packages is gone.
    // That is as broken as one that fails to run, and a same-version repair
    // must be allowed to replace it.
    return true;
  }
  return !(await managedReleaseRunsCached(loaded));
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
  // A current release that failed validation must be replaceable even by the
  // same version, which is what pip usually produces.
  const brokenCurrent = await currentManagedReleaseIsBroken();
  const { published } = await installYtDlp({
    upgrade: true,
    currentIsUsable: !brokenCurrent,
  });
  if (!published) {
    logger.info("[yt-dlp] Already on the newest available release.");
  }

  // The upgrade may have landed a different binary on PATH, so drop every
  // cached capability probe before re-reading the version.
  resetResolvedYtDlpPath();
  resetJsRuntimeFlag();
  resetRemoteComponentsSupport();

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
