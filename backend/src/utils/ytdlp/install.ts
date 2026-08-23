import { spawn } from "child_process";
import { getProviderPluginPath } from "../../services/downloaders/ytdlp/ytdlpHelpers";
import {
  awaitYtDlpUpdateWindow,
  withYtDlpExecutionsSuspended,
} from "./executionGate";
import { getErrorMessage } from "../errors";
import { YT_DLP_STALE_AFTER_DAYS } from "./constants";
import {
  hasCustomConfiguredYtDlpPath,
  resetResolvedYtDlpPath,
  resolveYtDlpPath,
  updatePathAfterAutoInstall,
} from "./pathResolver";
import { getYtDlpVersionInfo } from "./versionProbe";
import { resetRuntimeCaches } from "./runtime";
import { logger } from "../logger";

// Cached promise so we only check/install once per process
let ytDlpAvailablePromise: Promise<void> | null = null;

// Request yt-dlp through its extras rather than naming its companions here.
// A yt-dlp release pins the dependencies that are coupled to it — "default"
// carries the yt-dlp-ejs pin for the YouTube JS challenge solver, "curl-cffi"
// the browser-impersonation range that --impersonate (and with it the MissAV
// downloader) depends on. Letting pip read those pins off the release being
// installed keeps them in lockstep automatically; a hand-written list here
// would silently keep an old solver next to a freshly upgraded yt-dlp.
const YT_DLP_PIP_PACKAGE = "yt-dlp[default,curl-cffi]";

/**
 * Decide which packages pip should install.
 *
 * The bgutil POT provider is only added when no bundled copy is present.
 * getYtDlpSpawnEnv() puts the bundled plugin at the front of PYTHONPATH, ahead
 * of site-packages, and its Node counterpart (generate_once.js) ships with the
 * image and is not on PyPI at all — so where a bundle exists, a pip copy of the
 * plugin is loaded by nothing and "upgrading" it would report progress that
 * never reaches the yt-dlp process. Bumping the bundled provider is a rebuild,
 * not a runtime install.
 */
function getPipPackages(): string[] {
  if (getProviderPluginPath()) {
    return [YT_DLP_PIP_PACKAGE];
  }

  return [YT_DLP_PIP_PACKAGE, "bgutil-ytdlp-pot-provider"];
}

// Every pip run in this process queues here. Two callers reach this module
// under independent locks — ensureYtDlpAvailable() through its cached
// availability promise, updateYtDlp() through its own in-flight promise — so
// an operator pressing "Update yt-dlp" while the first download of the process
// triggers the missing-binary or stale-version install would otherwise put two
// pip processes on the same user-site directory at once. pip is not safe to run
// concurrently against one environment: the two runs rewrite the same package
// files and either can fail or leave the install half-written. Serializing here
// rather than in the callers keeps future call sites covered by default.
let pipQueue: Promise<unknown> = Promise.resolve();

function withPipLock<T>(task: () => Promise<T>): Promise<T> {
  // Run the task whether or not the previous one settled cleanly, and keep a
  // swallowed copy as the tail so one failure cannot poison the queue.
  const run = pipQueue.then(task, task);
  pipQueue = run.catch(() => undefined);
  return run;
}

/**
 * Try to install yt-dlp via pip, trying multiple pip variants.
 *
 * Serialized process-wide: concurrent callers queue instead of overlapping.
 */
export async function installYtDlp(
  options: { upgrade?: boolean } = {}
): Promise<void> {
  return withPipLock(() => runPipInstall(options));
}

async function runPipInstall(options: { upgrade?: boolean } = {}): Promise<void> {
  const { upgrade = false } = options;
  const packages = getPipPackages();
  const installArgs = ["install"];
  if (upgrade) {
    installArgs.push("-U");
  }

  // pip candidates to try in order
  const candidates =
    process.platform === "win32"
      ? [
          ["py", "-m", "pip", ...installArgs, ...packages],
          ["python", "-m", "pip", ...installArgs, ...packages],
          ["python3", "-m", "pip", ...installArgs, ...packages],
          ["pip", ...installArgs, ...packages],
          ["pip3", ...installArgs, ...packages],
        ]
      : [
          ["pip3", ...installArgs, "--user", ...packages],
          ["pip3", ...installArgs, ...packages],
          ["pip3", ...installArgs, "--break-system-packages", ...packages],
          ["pip", ...installArgs, "--user", ...packages],
          ["pip", ...installArgs, ...packages],
          ["pip", ...installArgs, "--break-system-packages", ...packages],
          ["python3", "-m", "pip", ...installArgs, "--user", ...packages],
          ["python3", "-m", "pip", ...installArgs, ...packages],
        ];

  for (const [cmd, ...args] of candidates) {
    try {
      logger.info(`[yt-dlp] Attempting: ${cmd} ${args.join(" ")}`);
      await new Promise<void>((resolve, reject) => {
        let stderr = "";
        const proc = spawn(cmd, args, {
          stdio: ["ignore", "ignore", "pipe"],
        });
        proc.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        proc.on("close", (code) =>
          code === 0
            ? resolve()
            : reject(
                Object.assign(new Error(`${cmd} exited with code ${code}`), {
                  code,
                  stderr,
                })
              )
        );
        proc.on("error", reject);
      });
      logger.info(
        `[yt-dlp] Successfully ${upgrade ? "updated" : "installed"} ${packages.join(", ")}.`
      );
      updatePathAfterAutoInstall();
      return;
    } catch (error: unknown) {
      const stderr = String(
        (error as { stderr?: unknown })?.stderr || ""
      ).trim();
      if (stderr) {
        logger.warn(`[yt-dlp] ${cmd} failed: ${stderr.split("\n").pop()}`);
      }
      // Try next candidate
    }
  }

  throw new Error(
    `yt-dlp could not be automatically ${upgrade ? "updated" : "installed"}. ` +
      "Please install it manually: https://github.com/yt-dlp/yt-dlp#installation"
  );
}

/**
 * Ensure yt-dlp is available, auto-installing via pip if not found.
 * Result is cached so the check only runs once per process.
 */
export async function ensureYtDlpAvailable(): Promise<void> {
  if (ytDlpAvailablePromise) return ytDlpAvailablePromise;

  ytDlpAvailablePromise = (async () => {
    let attemptedAutoUpgrade = false;
    let attemptedAutoInstall = false;

    while (true) {
      // Let an in-progress update finish before probing. Mid-swap the console
      // script can be briefly absent, and a probe that reads that as ENOENT
      // would kick off a reinstall of a perfectly good binary. This waits
      // without reserving, since the branches below may claim the gate.
      await awaitYtDlpUpdateWindow();

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

        if (
          !hasCustomConfiguredYtDlpPath() &&
          !attemptedAutoUpgrade &&
          versionInfo.isStale
        ) {
          attemptedAutoUpgrade = true;
          logger.warn(
            `[yt-dlp] ${versionInfo.version || ytDlpPath} is older than ${YT_DLP_STALE_AFTER_DAYS} days. Updating yt-dlp to avoid known YouTube 360p regressions.`
          );
          try {
            // Same hazard as the operator-triggered update: pip rewrites the
            // installation other downloads are already running from.
            await withYtDlpExecutionsSuspended(async () => {
              await installYtDlp({ upgrade: true });
              resetResolvedYtDlpPath();
              resetRuntimeCaches();
            });
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
        // Non-zero exit from --version means binary executed; continue.
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
          // Only auto-install when using the default path (not a user-configured path).
          if (hasCustomConfiguredYtDlpPath()) {
            throw new Error(
              `yt-dlp not found at configured path: ${ytDlpPath}. ` +
                "Please check your YT_DLP_PATH environment variable."
            );
          }

          if (attemptedAutoInstall) {
            throw new Error(
              "yt-dlp was installed automatically but is still not available on PATH. " +
                "Please add it to PATH or set YT_DLP_PATH to the installed binary."
            );
          }

          logger.warn(
            "[yt-dlp] yt-dlp not found in PATH. Attempting automatic installation..."
          );
          attemptedAutoInstall = true;
          // Gated for the same reason as the upgrade branch above: this pip run
          // writes the installation other downloads launch from. Leaving it
          // ungated let a queued install start right after an operator update
          // released the gate, rewriting files under downloads that had just
          // been allowed to spawn.
          await withYtDlpExecutionsSuspended(async () => {
            await installYtDlp();
            resetResolvedYtDlpPath();
            resetRuntimeCaches();
          });
          continue;
        }

        if (hasCustomConfiguredYtDlpPath()) {
          throw new Error(
            `Failed to execute configured yt-dlp at ${ytDlpPath} ` +
              `(${e.code || "unknown"}): ${e.message}`
          );
        }
        throw new Error(
          `Failed to execute yt-dlp (${e.code || "unknown"}): ${e.message}`
        );
      }
    }
  })().catch((err) => {
    // Reset cache so the next call retries instead of getting the same error.
    ytDlpAvailablePromise = null;
    throw err;
  });

  return ytDlpAvailablePromise;
}

export function resetYtDlpAvailablePromise(): void {
  ytDlpAvailablePromise = null;
}

/**
 * @internal Test helper: drop a queue tail left pending by a mocked pip run.
 */
export function resetPipQueue(): void {
  pipQueue = Promise.resolve();
}
