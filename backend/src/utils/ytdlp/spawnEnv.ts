import path from "path";
import { getProviderPluginPath } from "../../services/downloaders/ytdlp/ytdlpHelpers";

let providerPluginPathCache: string | null | undefined = undefined;

function getCachedProviderPluginPath(): string {
  if (providerPluginPathCache === undefined) {
    providerPluginPathCache = getProviderPluginPath() || null;
  }

  return providerPluginPathCache || "";
}

/**
 * Build the environment used to spawn yt-dlp, injecting the bgutil provider
 * plugin onto PYTHONPATH when one is configured.
 */
export function getYtDlpSpawnEnv(): NodeJS.ProcessEnv {
  const providerPluginPath = getCachedProviderPluginPath();
  if (!providerPluginPath) {
    return process.env;
  }

  const pythonPathEntries = (process.env.PYTHONPATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);

  if (!pythonPathEntries.includes(providerPluginPath)) {
    pythonPathEntries.unshift(providerPluginPath);
  }

  return {
    ...process.env,
    PYTHONPATH: pythonPathEntries.join(path.delimiter),
  };
}

export function resetProviderPluginCache(): void {
  providerPluginPathCache = undefined;
}
