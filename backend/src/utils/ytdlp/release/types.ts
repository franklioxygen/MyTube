import type { YouTubeJsRuntimeFlag } from "../constants";

export const RELEASE_JSON_FILENAME = "release.json";
export const PUBLISHED_JSON_FILENAME = "published.json";
export const CURRENT_JSON_FILENAME = "current.json";
export const SITE_PACKAGES_DIRNAME = "site-packages";
export const STAGING_DIRNAME = "staging";
export const RELEASES_DIRNAME = "releases";
export const LEASES_DIRNAME = "leases";
export const GC_MARKERS_DIRNAME = "gc-markers";
export const GENERATIONS_DIRNAME = "generations";
export const TRASH_DIRNAME = "trash";
export const PUBLISH_LOCK_DIRNAME = "publish.lock";
export const PUBLISH_LOCK_OWNER_FILENAME = "owner.json";

export type ReleaseKind = "managed" | "external";

export type YtDlpCapabilities = {
  jsRuntimeFlag: YouTubeJsRuntimeFlag | null;
  supportsRemoteComponents: boolean;
  impersonateAvailable: boolean;
};

export type ReleaseManifest = {
  schemaVersion: 1;
  releaseId: string;
  version: string;
  installedAt: string;
  pythonExecutable: string;
  pythonPrefixArgs: string[];
  sitePackages: typeof SITE_PACKAGES_DIRNAME;
};

export type PublishedManifest = {
  schemaVersion: 1;
  releaseId: string;
  generation: number;
  previousReleaseId: string | null;
  publishedAt: string;
};

export type CurrentManifest = {
  schemaVersion: 1;
  generation: number;
  releaseId: string;
  previousReleaseId: string | null;
  publishedAt: string;
};

export type PublishLockOwner = {
  operationId: string;
  nonce: string;
  pid: number;
  /**
   * Identifies the writing process instance. A PID alone is not an identity: a
   * restarted container routinely reassigns the same number, which would make
   * a dead owner's lock look permanently live. Optional so a lock written by
   * an older build still parses.
   */
  instanceId?: string;
  createdAt: string;
};

export type LeaseRecord = {
  schemaVersion: 1;
  releaseId: string;
  instanceId: string;
  pid: number;
  operationId: string;
  createdAt: string;
};

export type YtDlpRelease = {
  readonly kind: ReleaseKind;
  readonly releaseId: string;
  readonly version: string | null;
  readonly command: string;
  readonly prefixArgs: readonly string[];
  readonly spawnEnv: NodeJS.ProcessEnv;
  readonly pythonExecutable?: string;
  readonly sitePackagesPath?: string;
  readonly generation?: number;
  readonly capabilities: Promise<YtDlpCapabilities>;
};

export type ManagedStoreLayout = {
  root: string;
  generationsDir: string;
  trashDir: string;
  currentPath: string;
  releasesDir: string;
  stagingDir: string;
  leasesDir: string;
  gcMarkersDir: string;
  publishLockDir: string;
};

export type LoadedManagedRelease = {
  current: CurrentManifest | null;
  release: ReleaseManifest;
  releaseDir: string;
  sitePackagesPath: string;
};

export type PublishDecision =
  | {
      action: "publish";
      generation: number;
      previousReleaseId: string | null;
    }
  /**
   * `kind` separates a benign no-op ("this release is already current") from a
   * genuine conflict ("a newer release won the race"). Only the latter is an
   * error for the operator: re-running an update that is already up to date
   * must report no change, not a failure.
   */
  | { action: "reject"; kind: "already-current" | "conflict"; reason: string };

export type PublishOutcome = {
  current: CurrentManifest | null;
  published: boolean;
  reason?: string;
};
