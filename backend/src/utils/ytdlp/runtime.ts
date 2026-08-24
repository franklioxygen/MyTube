import { spawn } from "child_process";
import {
  YT_DLP_JS_RUNTIME_ENV,
  type YouTubeJsRuntimeFlag,
} from "./constants";
import { isYouTubeUrl } from "../helpers";
import { logger } from "../logger";
import { resetCapabilityCacheForTests } from "./release/capabilities";
import type { YtDlpRelease } from "./release/types";

let denoAvailablePromise: Promise<boolean> | null = null;
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
 * Whether this release can impersonate Chrome via curl_cffi. Callers use this
 * to gate `--impersonate` and degrade gracefully instead of erroring.
 */
export async function isYtDlpImpersonateAvailable(
  release: YtDlpRelease
): Promise<boolean> {
  try {
    const capabilities = await release.capabilities;
    return capabilities.impersonateAvailable;
  } catch {
    return false;
  }
}

function warnRuntimeOnce(key: string, message: string): void {
  if (runtimeWarningCache.has(key)) {
    return;
  }
  runtimeWarningCache.add(key);
  logger.warn(message);
}

export async function getYouTubeJsRuntimeFlag(
  release: YtDlpRelease
): Promise<YouTubeJsRuntimeFlag | null> {
  try {
    const capabilities = await release.capabilities;
    if (!capabilities.jsRuntimeFlag) {
      warnRuntimeOnce(
        "js-runtime-flag-unsupported",
        "[yt-dlp] Current yt-dlp binary does not support --js-runtimes. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
      );
    }
    return capabilities.jsRuntimeFlag;
  } catch {
    warnRuntimeOnce(
      "js-runtime-flag-unsupported",
      "[yt-dlp] Current yt-dlp binary does not support --js-runtimes. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
    );
    return null;
  }
}

export async function ytDlpSupportsRemoteComponents(
  release: YtDlpRelease
): Promise<boolean> {
  try {
    const capabilities = await release.capabilities;
    if (!capabilities.supportsRemoteComponents) {
      warnRuntimeOnce(
        "remote-components-unsupported",
        "[yt-dlp] Current yt-dlp binary does not support --remote-components. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
      );
    }
    return capabilities.supportsRemoteComponents;
  } catch {
    warnRuntimeOnce(
      "remote-components-unsupported",
      "[yt-dlp] Current yt-dlp binary does not support --remote-components. Continuing without it. Upgrade yt-dlp or set YT_DLP_PATH to a newer binary if YouTube extraction becomes unreliable."
    );
    return false;
  }
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
  url: string,
  release: YtDlpRelease
): Promise<void> {
  if (!isYouTubeUrl(url)) {
    return;
  }
  const runtimeFlag = await getYouTubeJsRuntimeFlag(release);
  if (!runtimeFlag) {
    return;
  }
  args.push(runtimeFlag, await getYouTubeJsRuntime());
}

export function resetJsRuntimeFlag(): void {
  resetCapabilityCacheForTests();
}

export function resetRemoteComponentsSupport(): void {
  resetCapabilityCacheForTests();
}

export function resetRuntimeCaches(): void {
  denoAvailablePromise = null;
  runtimeWarningCache.clear();
  resetCapabilityCacheForTests();
}
