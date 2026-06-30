import { spawn } from "child_process";
import { getErrorMessage } from "../errors";
import { YT_DLP_STALE_AFTER_DAYS } from "./constants";
import {
  hasCustomConfiguredYtDlpPath,
  resetResolvedYtDlpPath,
  resolveYtDlpPath,
  updatePathAfterAutoInstall,
} from "./pathResolver";
import { getYtDlpVersionInfo } from "./versionProbe";
import {
  resetJsRuntimeFlag,
  resetRemoteComponentsSupport,
} from "./runtime";

// Cached promise so we only check/install once per process
let ytDlpAvailablePromise: Promise<void> | null = null;

/**
 * Try to install yt-dlp via pip, trying multiple pip variants.
 */
async function installYtDlp(options: { upgrade?: boolean } = {}): Promise<void> {
  const { upgrade = false } = options;
  // curl-cffi powers yt-dlp's browser impersonation (--impersonate), which the
  // MissAV downloader needs to get past Cloudflare on the m3u8 CDN. The Docker
  // image installs it explicitly; install it here too so non-Docker setups
  // gain the capability instead of hard-failing on --impersonate.
  const packages = ["yt-dlp", "bgutil-ytdlp-pot-provider", "curl-cffi"];
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
      console.log(`[yt-dlp] Attempting: ${cmd} ${args.join(" ")}`);
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
      console.log(
        upgrade
          ? "[yt-dlp] Successfully updated yt-dlp and bgutil provider."
          : "[yt-dlp] Successfully installed yt-dlp and bgutil provider."
      );
      updatePathAfterAutoInstall();
      return;
    } catch (error: unknown) {
      const stderr = String(
        (error as { stderr?: unknown })?.stderr || ""
      ).trim();
      if (stderr) {
        console.warn(`[yt-dlp] ${cmd} failed: ${stderr.split("\n").pop()}`);
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
          console.warn(
            `[yt-dlp] ${versionInfo.version || ytDlpPath} is older than ${YT_DLP_STALE_AFTER_DAYS} days. Updating yt-dlp and the bgutil provider to avoid known YouTube 360p regressions.`
          );
          try {
            await installYtDlp({ upgrade: true });
            resetResolvedYtDlpPath();
            resetJsRuntimeFlag();
            resetRemoteComponentsSupport();
            continue;
          } catch (upgradeError: unknown) {
            console.warn(
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

          console.warn(
            "[yt-dlp] yt-dlp not found in PATH. Attempting automatic installation..."
          );
          attemptedAutoInstall = true;
          await installYtDlp();
          resetResolvedYtDlpPath();
          resetJsRuntimeFlag();
          resetRemoteComponentsSupport();
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
