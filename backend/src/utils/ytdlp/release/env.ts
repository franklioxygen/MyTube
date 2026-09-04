import path from "path";
import { getProviderPluginPath } from "../../../services/downloaders/ytdlp/ytdlpHelpers";
import { getProxyBypassHosts } from "../config";
import { logger } from "../../logger";

/**
 * Fold the configured proxy-bypass hosts into the snapshot's NO_PROXY.
 *
 * Both spellings are written because the two readers disagree on precedence:
 * CPython's getproxies_environment() walks os.environ and lets whichever of
 * `no_proxy`/`NO_PROXY` it sees last win. Leaving a stale pair behind would
 * apply the list only some of the time.
 */
function applyProxyBypassHosts(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let bypassHosts: string[];
  try {
    bypassHosts = getProxyBypassHosts();
  } catch (error: unknown) {
    // Settings are unreadable. A spawn environment is not the place to fail an
    // operation: fall back to the inherited proxy configuration.
    logger.warn(
      `[yt-dlp] Could not read the proxy bypass hosts; using the inherited NO_PROXY: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return env;
  }

  if (bypassHosts.length === 0) {
    return env;
  }

  const entries: string[] = [];
  for (const source of [env.NO_PROXY, env.no_proxy, bypassHosts.join(",")]) {
    for (const entry of (source ?? "").split(",")) {
      const trimmed = entry.trim();
      if (trimmed && !entries.includes(trimmed)) {
        entries.push(trimmed);
      }
    }
  }

  const merged = entries.join(",");
  return { ...env, NO_PROXY: merged, no_proxy: merged };
}

/**
 * Snapshot the environment every yt-dlp child of an operation runs with.
 */
export function captureProcessEnv(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return applyProxyBypassHosts({ ...source });
}

export function buildManagedSpawnEnv(
  sitePackagesPath: string,
  capturedEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const bundled = getProviderPluginPath();
  const pythonPath = [bundled, sitePackagesPath].filter(Boolean).join(path.delimiter);
  return {
    ...capturedEnv,
    PYTHONPATH: pythonPath,
    PYTHONNOUSERSITE: "1",
  };
}

export function buildExternalSpawnEnv(
  capturedEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const bundled = getProviderPluginPath();
  if (!bundled) {
    return { ...capturedEnv };
  }
  const entries = (capturedEnv.PYTHONPATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  if (!entries.includes(bundled)) {
    entries.unshift(bundled);
  }
  return {
    ...capturedEnv,
    PYTHONPATH: entries.join(path.delimiter),
  };
}
