// Barrel for the yt-dlp utilities, split into focused modules under ./ytdlp.
// Re-exports the public surface so existing `../utils/ytDlpUtils` imports keep working.

import { resetPipQueue, resetYtDlpAvailablePromise } from "./ytdlp/install";
import { resetYtDlpExecutionGate } from "./ytdlp/executionGate";
import { resetProviderPluginCache } from "./ytdlp/spawnEnv";
import { resetResolvedYtDlpPath } from "./ytdlp/pathResolver";
import { resetRuntimeCaches } from "./ytdlp/runtime";
import { resetCookiesFileCache } from "./ytdlp/cookies";

export { ensureYtDlpAvailable } from "./ytdlp/install";
export {
  awaitYtDlpExecutionSlot,
  registerYtDlpExecution,
  withYtDlpExecutionsSuspended,
} from "./ytdlp/executionGate";
export { getConfiguredYtDlpPath } from "./ytdlp/pathResolver";
export { getYtDlpSpawnEnv } from "./ytdlp/spawnEnv";
export { isYtDlpImpersonateAvailable } from "./ytdlp/runtime";
export { convertFlagToArg, flagsToArgs } from "./ytdlp/flags";
export {
  executeYtDlpJson,
  getChannelUrlFromVideo,
  downloadChannelAvatar,
  executeYtDlpSpawn,
} from "./ytdlp/execute";
export { isMembersOnlyError } from "./ytdlp/errorClassification";
export {
  getYtDlpStatus,
  isYtDlpUpdateInProgress,
  updateYtDlp,
} from "./ytdlp/maintenance";
export type { YtDlpStatus, YtDlpUpdateResult } from "./ytdlp/maintenance";
export {
  parseYtDlpConfig,
  getUserYtDlpConfig,
  getEffectiveUserYtDlpConfig,
  getNetworkConfigFromUserConfig,
} from "./ytdlp/config";
export { InvalidProxyError, getAxiosProxyConfig } from "./ytdlp/proxy";

/**
 * @internal Test helper to reset internal caches between test cases.
 */
export function resetYtDlpAvailabilityCacheForTests(): void {
  resetYtDlpAvailablePromise();
  resetPipQueue();
  resetYtDlpExecutionGate();
  resetProviderPluginCache();
  resetResolvedYtDlpPath();
  resetRuntimeCaches();
  resetCookiesFileCache();
}
