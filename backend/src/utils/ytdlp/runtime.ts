import { spawn } from "child_process";
import {
  YT_DLP_HELP_PROBE_TIMEOUT_MS,
  YT_DLP_JS_RUNTIME_ENV,
  YouTubeJsRuntimeFlag,
} from "./constants";
import { getYtDlpSpawnEnv } from "./spawnEnv";
import { resolveYtDlpPath } from "./pathResolver";
import { isYouTubeUrl } from "../helpers";

let denoAvailablePromise: Promise<boolean> | null = null;
let jsRuntimeFlagPromise: Promise<YouTubeJsRuntimeFlag | null> | null = null;
let remoteComponentsSupportPromise: Promise<boolean> | null = null;
let impersonateSupportPromise: Promise<boolean> | null = null;
const runtimeWarningCache = new Set<string>();

async function isDenoAvailable(): Promise<boolean> {
  if (denoAvailablePromise) {
    return denoAvailablePromise;
  }

  denoAvailablePromise = new Promise<boolean>((resolve) => {
    const proc = spawn("deno", ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
    });

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });

  return denoAvailablePromise;
}

/**
 * Whether the resolved yt-dlp binary can impersonate a Chrome browser via
 * curl_cffi. Probes `--list-impersonate-targets`: when curl_cffi is missing,
 * yt-dlp still lists targets but tags every one "(unavailable)", and passing
 * `--impersonate` would then hard-fail the download. Callers use this to gate
 * the flag and degrade gracefully instead of erroring. Cached per process.
 */
export async function isYtDlpImpersonateAvailable(): Promise<boolean> {
  if (impersonateSupportPromise) {
    return impersonateSupportPromise;
  }

  impersonateSupportPromise = (async () => {
    try {
      const ytDlpPath = await resolveYtDlpPath();
      return await new Promise<boolean>((resolve) => {
        let output = "";
        let settled = false;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          // A usable target row names a client and ends with the curl_cffi
          // source without the "(unavailable)" marker.
          const available = output
            .split("\n")
            .some(
              (line) =>
                /chrome/i.test(line) &&
                /curl_cffi/.test(line) &&
                !/unavailable/i.test(line),
            );
          if (!available) {
            impersonateSupportPromise = null;
          }
          resolve(available && value);
        };
        const timeout = setTimeout(() => {
          proc.kill("SIGTERM");
          finish(true);
        }, YT_DLP_HELP_PROBE_TIMEOUT_MS);
        timeout.unref?.();

        // ytDlpPath is either explicitly configured by the operator or selected
        // from enumerated PATH entries and fixed executable names above.
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
        const proc = spawn(ytDlpPath, ["--list-impersonate-targets"], {
          env: getYtDlpSpawnEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        proc.stdout?.on("data", (data: Buffer) => {
          output += data.toString();
        });
        proc.on("close", () => finish(true));
        proc.on("error", () => {
          impersonateSupportPromise = null;
          finish(false);
        });
      });
    } catch {
      impersonateSupportPromise = null;
      return false;
    }
  })();

  return impersonateSupportPromise;
}

function warnRuntimeOnce(key: string, message: string): void {
  if (runtimeWarningCache.has(key)) {
    return;
  }
  runtimeWarningCache.add(key);
  console.warn(message);
}

export async function getYouTubeJsRuntimeFlag(): Promise<YouTubeJsRuntimeFlag | null> {
  if (jsRuntimeFlagPromise) {
    return jsRuntimeFlagPromise;
  }

  jsRuntimeFlagPromise = (async () => {
    let helpText = "";
    const resolveFromHelp = (): YouTubeJsRuntimeFlag | null => {
      if (helpText.includes("--js-runtimes")) {
        return "--js-runtimes";
      }

      if (helpText.includes("--js-runtime")) {
        return "--js-runtime";
      }

      warnRuntimeOnce(
        "js-runtime-flag-unsupported",
        "[yt-dlp] Current yt-dlp binary does not support --js-runtimes. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
      );
      return null;
    };

    try {
      const ytDlpPath = await resolveYtDlpPath();
      const resolvedFlag = await new Promise<YouTubeJsRuntimeFlag | null>((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          proc.kill("SIGTERM");
          settled = true;
          resolve(resolveFromHelp());
        }, YT_DLP_HELP_PROBE_TIMEOUT_MS);
        timeout.unref?.();
        const settle = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(resolveFromHelp());
        };

        // ytDlpPath is either explicitly configured by the operator or selected
        // from enumerated PATH entries and fixed executable names above.
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
        const proc = spawn(ytDlpPath, ["--help"], {
          env: getYtDlpSpawnEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });

        proc.stdout?.on("data", (data: Buffer) => {
          helpText += data.toString();
        });

        proc.stderr?.on("data", (data: Buffer) => {
          helpText += data.toString();
        });

        proc.on("close", () => {
          settle();
        });

        proc.on("error", () => {
          settle();
        });
      });
      if (!resolvedFlag) {
        jsRuntimeFlagPromise = null;
      }
      return resolvedFlag;
    } catch {
      jsRuntimeFlagPromise = null;
      warnRuntimeOnce(
        "js-runtime-flag-unsupported",
        "[yt-dlp] Current yt-dlp binary does not support --js-runtimes. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
      );
      return null;
    }
  })();

  return jsRuntimeFlagPromise;
}

export async function ytDlpSupportsRemoteComponents(): Promise<boolean> {
  if (remoteComponentsSupportPromise) {
    return remoteComponentsSupportPromise;
  }

  remoteComponentsSupportPromise = (async () => {
    let helpText = "";
    const resolveFromHelp = (): boolean => {
      if (helpText.includes("--remote-components")) {
        return true;
      }

      warnRuntimeOnce(
        "remote-components-unsupported",
        "[yt-dlp] Current yt-dlp binary does not support --remote-components. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
      );
      return false;
    };

    try {
      const ytDlpPath = await resolveYtDlpPath();
      const supported = await new Promise<boolean>((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          proc.kill("SIGTERM");
          settled = true;
          resolve(resolveFromHelp());
        }, YT_DLP_HELP_PROBE_TIMEOUT_MS);
        timeout.unref?.();
        const settle = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(resolveFromHelp());
        };

        // ytDlpPath is either explicitly configured by the operator or selected
        // from enumerated PATH entries and fixed executable names above.
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
        const proc = spawn(ytDlpPath, ["--help"], {
          env: getYtDlpSpawnEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });

        proc.stdout?.on("data", (data: Buffer) => {
          helpText += data.toString();
        });

        proc.stderr?.on("data", (data: Buffer) => {
          helpText += data.toString();
        });

        proc.on("close", () => {
          settle();
        });

        proc.on("error", () => {
          settle();
        });
      });
      if (!supported) {
        remoteComponentsSupportPromise = null;
      }
      return supported;
    } catch {
      remoteComponentsSupportPromise = null;
      warnRuntimeOnce(
        "remote-components-unsupported",
        "[yt-dlp] Current yt-dlp binary does not support --remote-components. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
      );
      return false;
    }
  })();

  return remoteComponentsSupportPromise;
}

async function getYouTubeJsRuntime(): Promise<"node" | "deno"> {
  const rawRuntime = process.env[YT_DLP_JS_RUNTIME_ENV]?.trim();
  const runtime = rawRuntime?.toLowerCase();
  const hasRuntimeOverride = Boolean(rawRuntime);

  if (runtime === "node") {
    return "node";
  }

  const runtimeIsInvalid = hasRuntimeOverride && runtime !== "deno";

  // Default to Deno because yt-dlp recommends it for JS challenge solving.
  // If your deployment runs on Alpine Linux (musl) and Deno is problematic,
  // set YT_DLP_JS_RUNTIME=node explicitly.
  if (runtimeIsInvalid) {
    warnRuntimeOnce(
      "invalid-runtime",
      `[yt-dlp] Unsupported ${YT_DLP_JS_RUNTIME_ENV}="${rawRuntime}". Falling back to "deno".`
    );
  }

  if (await isDenoAvailable()) {
    return "deno";
  }

  if (runtime === "deno") {
    warnRuntimeOnce(
      "explicit-deno-unavailable",
      '[yt-dlp] YT_DLP_JS_RUNTIME is set to "deno", but Deno runtime is unavailable. Falling back to "node". Install Deno or set YT_DLP_JS_RUNTIME=node.'
    );
    return "node";
  }

  if (runtimeIsInvalid) {
    warnRuntimeOnce(
      "invalid-runtime-deno-unavailable",
      `[yt-dlp] YT_DLP_JS_RUNTIME="${rawRuntime}" is unsupported and Deno runtime is unavailable. Falling back to "node". Install Deno or set YT_DLP_JS_RUNTIME=node.`
    );
    return "node";
  }

  warnRuntimeOnce(
    "default-deno-unavailable",
    '[yt-dlp] Deno runtime is unavailable. Falling back to "node". Set YT_DLP_JS_RUNTIME=node to skip Deno checks.'
  );
  return "node";
}

export async function appendYouTubeJsRuntimeArg(
  args: string[],
  url: string
): Promise<void> {
  if (!isYouTubeUrl(url)) {
    return;
  }
  const runtimeFlag = await getYouTubeJsRuntimeFlag();
  if (!runtimeFlag) {
    return;
  }
  args.push(runtimeFlag, await getYouTubeJsRuntime());
}

export function resetJsRuntimeFlag(): void {
  jsRuntimeFlagPromise = null;
}

export function resetRemoteComponentsSupport(): void {
  remoteComponentsSupportPromise = null;
}

export function resetRuntimeCaches(): void {
  denoAvailablePromise = null;
  jsRuntimeFlagPromise = null;
  remoteComponentsSupportPromise = null;
  impersonateSupportPromise = null;
  runtimeWarningCache.clear();
}
