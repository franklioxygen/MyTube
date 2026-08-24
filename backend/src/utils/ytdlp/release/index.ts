export { acquireYtDlpRelease } from "./acquire";
export { getReleaseCapabilities, resetCapabilityCacheForTests } from "./capabilities";
export { decidePublication } from "./manifests";
export { withYtDlpRelease, spawnYtDlp } from "./launcher";
export { installManagedRelease, setPipTimeoutMsForTests } from "./install";
export { collectGarbage, collectGarbageIfDue } from "./gc";
export {
  managedReleaseRuns,
  markManagedReleaseUnusable,
  recoverUsableManagedRelease,
} from "./recover";
export {
  setManagedStoreRootForTests,
  getManagedStoreRoot,
  getManagedStoreLayout,
  atomicReplaceFile,
} from "./paths";
export { resetObservedGenerationForTests } from "./manifests";
export { acquireLease, releaseLease, hasLeases } from "./leases";
export type { YtDlpRelease, YtDlpCapabilities, CurrentManifest, ReleaseManifest } from "./types";

import { resetObservedGenerationForTests } from "./manifests";
import { resetCapabilityCacheForTests } from "./capabilities";
import { setManagedStoreRootForTests } from "./paths";
import { setPipTimeoutMsForTests } from "./install";
import { resetCollectionThrottleForTests } from "./gc";
import { resetUnusableManagedReleasesForTests } from "./recover";

export function resetManagedReleaseStateForTests(): void {
  setManagedStoreRootForTests(null);
  resetObservedGenerationForTests();
  resetCapabilityCacheForTests();
  setPipTimeoutMsForTests(null);
  resetCollectionThrottleForTests();
  resetUnusableManagedReleasesForTests();
}
