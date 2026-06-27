// Barrel for the yt-dlp utilities, split into focused modules under ./ytdlp.
// Re-exports the public surface so existing `../utils/ytDlpUtils` imports keep working.

import { resetYtDlpAvailablePromise } from "./ytdlp/install";
import { resetProviderPluginCache } from "./ytdlp/spawnEnv";
import { resetResolvedYtDlpPath } from "./ytdlp/pathResolver";
import { resetRuntimeCaches } from "./ytdlp/runtime";
import { resetCookiesFileCache } from "./ytdlp/cookies";

export { ensureYtDlpAvailable } from "./ytdlp/install";
export { isYtDlpImpersonateAvailable } from "./ytdlp/runtime";
export { convertFlagToArg, flagsToArgs } from "./ytdlp/flags";
export {
  executeYtDlpJson,
  getChannelUrlFromVideo,
  downloadChannelAvatar,
  executeYtDlpSpawn,
} from "./ytdlp/execute";
export {
  parseYtDlpConfig,
  getUserYtDlpConfig,
  getNetworkConfigFromUserConfig,
} from "./ytdlp/config";
export { InvalidProxyError, getAxiosProxyConfig } from "./ytdlp/proxy";

/**
 * @internal Test helper to reset internal caches between test cases.
 */
export function resetYtDlpAvailabilityCacheForTests(): void {
  resetYtDlpAvailablePromise();
  resetProviderPluginCache();
  resetResolvedYtDlpPath();
  resetRuntimeCaches();
  resetCookiesFileCache();
}
