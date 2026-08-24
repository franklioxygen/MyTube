import { getErrorMessage } from "../errors";
import { logger } from "../logger";
import { YT_DLP_STALE_AFTER_DAYS } from "./constants";
import {
  hasCustomConfiguredYtDlpPath,
  resetResolvedYtDlpPath,
  resolveYtDlpPath,
} from "./pathResolver";
import { resetPipQueue } from "./pipLock";
import { collectGarbage, installManagedRelease } from "./release";
import { isReleaseStale } from "./release/acquire";
import {
  managedReleaseRunsCached,
  recoverUsableManagedRelease,
} from "./release/recover";
import {
  resetJsRuntimeFlag,
  resetRemoteComponentsSupport,
} from "./runtime";
import {
  getYtDlpVersionInfo,
  resetYtDlpVersionInfoCache,
} from "./versionProbe";

let ytDlpAvailablePromise: Promise<void> | null = null;

/**
 * Install a new managed release and, when it beats the current one, publish it.
 * A candidate that turns out to match what is already current is not an error:
 * the operator asked for the newest yt-dlp and that is what they have.
 */
export async function installYtDlp(
  options: { upgrade?: boolean; currentIsUsable?: boolean } = {}
): Promise<{ published: boolean }> {
  const outcome = await installManagedRelease({
    currentIsUsable: options.currentIsUsable,
  });
  resetResolvedYtDlpPath();
  resetYtDlpVersionInfoCache();
  resetJsRuntimeFlag();
  resetRemoteComponentsSupport();
  // Collection never blocks the update path; a failure to collect is logged
  // and retried by the next maintenance run.
  void collectGarbage().catch(() => undefined);
  return { published: outcome.published };
}

export async function ensureYtDlpAvailable(): Promise<void> {
  if (ytDlpAvailablePromise) return ytDlpAvailablePromise;

  ytDlpAvailablePromise = (async () => {
    let attemptedAutoUpgrade = false;
    let attemptedAutoInstall = false;

    while (true) {
      if (hasCustomConfiguredYtDlpPath()) {
        await ensureCustomPathAvailable();
        return;
      }

      const managed = recoverUsableManagedRelease();
      if (managed && !(await managedReleaseRunsCached(managed))) {
        logger.warn(
          `[yt-dlp] Managed release ${managed.release.releaseId} no longer runs ` +
            "(the interpreter or its dependencies may have changed). Installing a new managed release."
        );
        if (!attemptedAutoInstall) {
          attemptedAutoInstall = true;
          try {
            // pip usually produces the same latest version, so the repair has
            // to be allowed to replace a same-version current release.
            await installYtDlp({ upgrade: true, currentIsUsable: false });
          } catch (installError: unknown) {
            logger.warn(
              `[yt-dlp] Reinstall failed (${getErrorMessage(installError, "unknown error")}). Trying the next release.`
            );
          }
        }
        // Re-evaluate. The probe marked this release unusable, so the next
        // candidate - the rollback release, or another finalized one - is
        // picked up and validated in turn rather than trusted structurally.
        // The marked set only grows, so this terminates at external discovery.
        continue;
      }
      if (managed) {
        if (
          !attemptedAutoUpgrade &&
          isReleaseStale(managed.release.version)
        ) {
          attemptedAutoUpgrade = true;
          logger.warn(
            `[yt-dlp] Managed release ${managed.release.version} is older than ${YT_DLP_STALE_AFTER_DAYS} days. Installing a new managed release.`
          );
          try {
            await installYtDlp({ upgrade: true });
            continue;
          } catch (upgradeError: unknown) {
            logger.warn(
              `[yt-dlp] Automatic update failed (${getErrorMessage(upgradeError, "unknown error")}). Continuing with the existing managed release.`
            );
            return;
          }
        }
        return;
      }

      const ytDlpPath = await resolveYtDlpPath();
      try {
        const versionInfo = await getYtDlpVersionInfo(ytDlpPath);
        if (!versionInfo.canRun) {
          throw Object.assign(
            new Error(versionInfo.errorMessage || "yt-dlp failed version probe"),
            {
              kind: versionInfo.errorKind || "close",
              code: versionInfo.errorCode,
            }
          );
        }

        if (!attemptedAutoUpgrade && versionInfo.isStale) {
          attemptedAutoUpgrade = true;
          logger.warn(
            `[yt-dlp] ${versionInfo.version || ytDlpPath} is older than ${YT_DLP_STALE_AFTER_DAYS} days. Installing a managed yt-dlp release.`
          );
          try {
            await installYtDlp({ upgrade: true });
            continue;
          } catch (upgradeError: unknown) {
            logger.warn(
              `[yt-dlp] Automatic update failed (${getErrorMessage(upgradeError, "unknown error")}). Continuing with the existing yt-dlp binary.`
            );
            return;
          }
        }

        return;
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException & { kind?: string };
        if (e.kind === "close") {
          return;
        }

        if (e.code === "EACCES" || e.code === "EPERM") {
          throw new Error(
            `yt-dlp exists but is not executable at: ${ytDlpPath}. ` +
              "Please fix file permissions or install yt-dlp manually."
          );
        }

        if (e.code === "ENOENT") {
          if (attemptedAutoInstall) {
            throw new Error(
              "yt-dlp was installed automatically but is still not usable. " +
                "Please install Python 3 and pip, or set YT_DLP_PATH to a working binary."
            );
          }

          logger.warn(
            "[yt-dlp] yt-dlp not found in PATH. Attempting managed installation..."
          );
          attemptedAutoInstall = true;
          await installYtDlp();
          continue;
        }

        throw new Error(
          `Failed to execute yt-dlp (${e.code || "unknown"}): ${e.message}`
        );
      }
    }
  })().catch((err) => {
    ytDlpAvailablePromise = null;
    throw err;
  });

  return ytDlpAvailablePromise;
}

async function ensureCustomPathAvailable(): Promise<void> {
  const ytDlpPath = await resolveYtDlpPath();
  const versionInfo = await getYtDlpVersionInfo(ytDlpPath);
  if (versionInfo.canRun || versionInfo.errorKind === "close") {
    return;
  }
  if (versionInfo.errorCode === "EACCES" || versionInfo.errorCode === "EPERM") {
    throw new Error(
      `yt-dlp exists but is not executable at: ${ytDlpPath}. ` +
        "Please fix file permissions or install yt-dlp manually."
    );
  }
  if (versionInfo.errorCode === "ENOENT") {
    throw new Error(
      `yt-dlp not found at configured path: ${ytDlpPath}. ` +
        "Please check your YT_DLP_PATH environment variable."
    );
  }
  throw new Error(
    `Failed to execute configured yt-dlp at ${ytDlpPath} ` +
      `(${versionInfo.errorCode || "unknown"}): ${versionInfo.errorMessage || "unknown error"}`
  );
}

export function resetYtDlpAvailablePromise(): void {
  ytDlpAvailablePromise = null;
}

export { resetPipQueue };
