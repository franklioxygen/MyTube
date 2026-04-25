import { spawn } from "child_process";
import { isYouTubeUrl } from "../helpers";

export const YT_DLP_PATH = process.env.YT_DLP_PATH || "yt-dlp";
const YT_DLP_JS_RUNTIME_ENV = "YT_DLP_JS_RUNTIME";
// Cached promise so we only check/install once per process
let ytDlpAvailablePromise: Promise<void> | null = null;
let denoAvailablePromise: Promise<boolean> | null = null;
type YouTubeJsRuntimeFlag = "--js-runtime" | "--js-runtimes";
type ProcessExecutionError = Error & {
  code?: string | number;
  exitCode?: number | null;
  kind?: "close" | "spawn";
  stderr?: string;
};

let jsRuntimeFlagPromise: Promise<YouTubeJsRuntimeFlag | null> | null = null;
const runtimeWarningCache = new Set<string>();

/**
 * @internal Test helper to reset internal availability cache between test cases.
 */
export function resetYtDlpAvailabilityCacheForTests(): void {
  ytDlpAvailablePromise = null;
  denoAvailablePromise = null;
  jsRuntimeFlagPromise = null;
  runtimeWarningCache.clear();
}

/**
 * Try to install yt-dlp via pip, trying multiple pip variants.
 */
async function installYtDlp(): Promise<void> {
  // pip candidates to try in order
  const candidates =
    process.platform === "win32"
      ? [
          ["py", "-m", "pip", "install", "yt-dlp"],
          ["python", "-m", "pip", "install", "yt-dlp"],
          ["python3", "-m", "pip", "install", "yt-dlp"],
          ["pip", "install", "yt-dlp"],
          ["pip3", "install", "yt-dlp"],
        ]
      : [
          ["pip3", "install", "yt-dlp"],
          ["pip3", "install", "--break-system-packages", "yt-dlp"],
          ["pip", "install", "yt-dlp"],
          ["pip", "install", "--break-system-packages", "yt-dlp"],
          ["python3", "-m", "pip", "install", "yt-dlp"],
        ];

  for (const [cmd, ...args] of candidates) {
    try {
      console.log(`[yt-dlp] Attempting: ${cmd} ${args.join(" ")}`);
      await new Promise<void>((resolve, reject) => {
        let stderr = "";
        const proc = spawn(cmd, args, {
          stdio: ["ignore", "ignore", "pipe"],
        });
        proc.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(
            Object.assign(new Error(`${cmd} exited with code ${code}`), {
              code,
              stderr,
            })
          );
        });
        proc.on("error", reject);
      });
      console.log("[yt-dlp] Successfully installed yt-dlp.");
      return;
    } catch (error: unknown) {
      const executionError = error as ProcessExecutionError;
      const stderr = String(executionError.stderr || "").trim();
      if (stderr) {
        console.warn(`[yt-dlp] ${cmd} failed: ${stderr.split("\n").pop()}`);
      }
      // Try next candidate
    }
  }

  // eslint-disable-next-line security-node/detect-unhandled-async-errors
  throw new Error(
    "yt-dlp is not installed and could not be automatically installed. " +
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
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(YT_DLP_PATH, ["--version"], {
          stdio: ["ignore", "ignore", "ignore"],
        });
        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(
            Object.assign(new Error(`yt-dlp --version exited with code ${code}`), {
              kind: "close",
              exitCode: code,
            })
          );
        });
        proc.on("error", (error: NodeJS.ErrnoException) => {
          reject(Object.assign(error, { kind: "spawn" }));
        });
      });
    } catch (err: unknown) {
      const executionError = err as ProcessExecutionError;
      // Non-zero exit from --version means binary executed; continue.
      if (executionError.kind === "close") {
        return;
      }

      if (executionError.code === "EACCES" || executionError.code === "EPERM") {
        throw new Error(
          `yt-dlp exists but is not executable at: ${YT_DLP_PATH}. ` +
            "Please fix file permissions or install yt-dlp manually."
        );
      }

      if (executionError.code === "ENOENT") {
        // Only auto-install when using the default path (not a user-configured path).
        if (process.env.YT_DLP_PATH) {
          throw new Error(
            `yt-dlp not found at configured path: ${YT_DLP_PATH}. ` +
              "Please check your YT_DLP_PATH environment variable."
          );
        }

        console.warn(
          "[yt-dlp] yt-dlp not found in PATH. Attempting automatic installation..."
        );
        await installYtDlp();
        return;
      }

      if (process.env.YT_DLP_PATH) {
        throw new Error(
          `Failed to execute configured yt-dlp at ${YT_DLP_PATH} ` +
            `(${executionError.code || "unknown"}): ${executionError.message}`
        );
      }
      throw new Error(
        `Failed to execute yt-dlp (${executionError.code || "unknown"}): ${executionError.message}`
      );
    }
  })().catch((err) => {
    // Reset cache so the next call retries instead of getting the same error.
    ytDlpAvailablePromise = null;
    throw err;
  });

  return ytDlpAvailablePromise;
}

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

function warnRuntimeOnce(key: string, message: string): void {
  if (runtimeWarningCache.has(key)) {
    return;
  }
  runtimeWarningCache.add(key);
  console.warn(message);
}

async function getYouTubeJsRuntimeFlag(): Promise<YouTubeJsRuntimeFlag | null> {
  if (jsRuntimeFlagPromise) {
    return jsRuntimeFlagPromise;
  }

  jsRuntimeFlagPromise = new Promise<YouTubeJsRuntimeFlag | null>((resolve) => {
    let helpText = "";
    const proc = spawn(YT_DLP_PATH, ["--help"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data: Buffer) => {
      helpText += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      helpText += data.toString();
    });

    const resolveFromHelp = () => {
      if (helpText.includes("--js-runtimes")) {
        resolve("--js-runtimes");
        return;
      }

      if (helpText.includes("--js-runtime")) {
        resolve("--js-runtime");
        return;
      }

      warnRuntimeOnce(
        "js-runtime-flag-unsupported",
        "[yt-dlp] Current yt-dlp binary does not support --js-runtimes. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
      );
      resolve(null);
    };

    proc.on("close", () => {
      resolveFromHelp();
    });

    proc.on("error", () => {
      resolveFromHelp();
    });
  });

  return jsRuntimeFlagPromise;
}

async function getYouTubeJsRuntime(): Promise<"node" | "deno"> {
  const rawRuntime = process.env.YT_DLP_JS_RUNTIME?.trim();
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
