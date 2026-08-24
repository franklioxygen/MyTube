import { DEFAULT_YT_DLP_PATH, YT_DLP_STALE_AFTER_DAYS } from "../constants";
import { hasCustomConfiguredYtDlpPath, resolveYtDlpPath } from "../pathResolver";
import { parseYtDlpReleaseTimestamp } from "../versionStamp";
import {
  getCachedYtDlpVersionInfo,
  type YtDlpVersionInfo,
} from "../versionProbe";
import { attachCapabilities } from "./capabilities";
import {
  captureProcessEnv,
  buildExternalSpawnEnv,
  buildManagedSpawnEnv,
} from "./env";
import {
  managedReleaseRunsCached,
  recoverUsableManagedRelease,
} from "./recover";
import { logger } from "../../logger";
import type { LoadedManagedRelease, YtDlpRelease } from "./types";

/**
 * Select the release this operation will run against.
 *
 * `ensureAvailable` delegates to `ensureYtDlpAvailable()` — the one place that
 * owns auto-install of a missing binary and the stale auto-upgrade — so those
 * behaviours stay on the execution path instead of being reimplemented here.
 * It is imported lazily because `install.ts` reaches back into this module for
 * the staleness helper.
 */
/** Bounded so a pathological store cannot spin; recovery narrows each pass. */
const MANAGED_SELECTION_ATTEMPTS = 4;

export async function acquireYtDlpRelease(
  options: { ensureAvailable?: boolean } = {}
): Promise<YtDlpRelease> {
  if (options.ensureAvailable) {
    const { ensureYtDlpAvailable } = await import("../install");
    await ensureYtDlpAvailable();
  }

  if (hasCustomConfiguredYtDlpPath()) {
    return createExternalRelease(await resolveYtDlpPath());
  }

  // Re-read current.json on every acquisition: a second backend process may
  // have published a release this process has never observed. Availability was
  // resolved once for this process, so a release that appeared afterwards has
  // never been validated here - and a publisher running a different image or
  // Python ABI can leave one that is structurally valid but cannot run.
  // managedReleaseRunsCached probes once per release id and records a failure,
  // so the next pass through recovery skips it.
  for (let attempt = 0; attempt < MANAGED_SELECTION_ATTEMPTS; attempt += 1) {
    const managed = recoverUsableManagedRelease();
    if (!managed) {
      break;
    }
    if (await managedReleaseRunsCached(managed)) {
      return createManagedRelease(managed);
    }
    logger.warn(
      `[yt-dlp] Managed release ${managed.release.releaseId} cannot run; trying the next candidate.`
    );
  }

  const resolvedPath = await resolveYtDlpPath();
  return createExternalRelease(resolvedPath || DEFAULT_YT_DLP_PATH);
}

export function createManagedRelease(
  loaded: LoadedManagedRelease
): YtDlpRelease {
  const env = captureProcessEnv();
  return attachCapabilities({
    kind: "managed",
    releaseId: loaded.release.releaseId,
    version: loaded.release.version,
    command: loaded.release.pythonExecutable,
    prefixArgs: ["-m", "yt_dlp", ...loaded.release.pythonPrefixArgs],
    spawnEnv: buildManagedSpawnEnv(loaded.sitePackagesPath, env),
    pythonExecutable: loaded.release.pythonExecutable,
    sitePackagesPath: loaded.sitePackagesPath,
    generation: loaded.current?.generation,
  });
}

export async function createExternalRelease(
  resolvedPath: string,
  versionInfo?: YtDlpVersionInfo
): Promise<YtDlpRelease> {
  const resolvedVersionInfo =
    versionInfo ?? (await getCachedYtDlpVersionInfo(resolvedPath));
  const version = resolvedVersionInfo.version;
  const env = captureProcessEnv();
  return attachCapabilities({
    kind: "external",
    // MyTube does not own an external binary, so the fingerprint is the most
    // it can offer: a different path or version means a different release.
    releaseId: `external:${resolvedPath}:${version ?? "unknown"}`,
    version,
    command: resolvedPath,
    prefixArgs: [],
    spawnEnv: buildExternalSpawnEnv(env),
  });
}

export function isReleaseStale(version: string | null): boolean {
  const timestamp = parseYtDlpReleaseTimestamp(version);
  if (timestamp === null) {
    return false;
  }
  const staleAfterMs = YT_DLP_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - timestamp > staleAfterMs;
}
