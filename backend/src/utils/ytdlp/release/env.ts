import path from "path";
import { getProviderPluginPath } from "../../../services/downloaders/ytdlp/ytdlpHelpers";
import { getProxyBypassHosts } from "../config";
import { logger } from "../../logger";

/**
 * Fold the configured proxy-bypass hosts into the snapshot's NO_PROXY.
 *
 * The lowercase spelling wins whenever it is set at all. CPython's
 * getproxies_environment() reads the environment twice and the second pass
 * considers only the exactly-lowercase names, so a non-empty `no_proxy`
 * overrides `NO_PROXY` and an empty one *removes* the bypass list outright -
 * which is how a deployment clears a NO_PROXY it inherited from a base image.
 * Merging the union of the two would resurrect exactly those entries. libcurl
 * never sees the raw variables here (yt-dlp hands it whatever that function
 * returned), so this one rule covers both request backends.
 *
 * The result is written to both spellings so the child cannot read a stale one.
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

  // Present-but-empty is a decision, not an absence, so this tests for the key
  // rather than for a truthy value.
  const inherited =
    env.no_proxy !== undefined ? env.no_proxy : (env.NO_PROXY ?? "");

  const entries: string[] = [];
  for (const entry of [...inherited.split(","), ...bypassHosts]) {
    const trimmed = entry.trim();
    if (trimmed && !entries.includes(trimmed)) {
      entries.push(trimmed);
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
