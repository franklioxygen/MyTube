import fs from "fs";
import path from "path";
import { removeSafe } from "../../security";
import { logger } from "../../logger";
import {
  YT_DLP_GC_KEEP_PREVIOUS_COUNT,
  YT_DLP_GC_MIN_INTERVAL_MS,
  YT_DLP_RELEASE_MIN_RETENTION_MS,
  YT_DLP_STAGING_MAX_AGE_MS,
  YT_DLP_STALE_LEASE_WARN_MS,
} from "../constants";
import { isValidOperationId, isValidReleaseId } from "./ids";
import {
  abortGcMarker,
  beginGcMarker,
  getInstanceId,
  hasGcMarkerToken,
  hasLeases,
  readLeaseRecords,
} from "./leases";
import {
  readCurrentManifest,
  readPublishedManifest,
  readReleaseManifest,
} from "./manifests";
import {
  getManagedStoreLayout,
  getReleaseDir,
  getTrashPath,
  listSafeDirNames,
  pathExistsInRoot,
  renameInRoot,
} from "./paths";
import type { CurrentManifest, ManagedStoreLayout } from "./types";

type FinalizedRelease = {
  releaseId: string;
  installedAt: number;
  /** Directory mtime: how long this release has actually existed on disk. */
  finalizedAt: number;
  /**
   * Publication generation, or null for a finalized candidate that was never
   * published (a conflict- or no-op-rejected install). Only published releases
   * form the rollback window.
   */
  generation: number | null;
};

/**
 * Conservative, lease-aware collection. It runs after a successful publication
 * or during maintenance, never before publication and never while the
 * publication lock is held. Every ambiguity favours retention.
 */
let lastCollectionAt = 0;
let deferredCollection: NodeJS.Timeout | null = null;

export function resetCollectionThrottleForTests(): void {
  lastCollectionAt = 0;
  if (deferredCollection) {
    clearTimeout(deferredCollection);
    deferredCollection = null;
  }
}

/**
 * Collection also has to happen outside the update path. A release pinned by a
 * long download is skipped while its lease exists, and nothing else would look
 * at it again until the next install - which may be months away. Releasing a
 * lease therefore offers a collection.
 *
 * A request that arrives inside the throttle window is deferred rather than
 * dropped: publication runs a collection of its own, so the follow-up that
 * matters (the one after the last lease goes away) would otherwise be the one
 * discarded.
 */
export function collectGarbageIfDue(): void {
  const waitMs = lastCollectionAt + YT_DLP_GC_MIN_INTERVAL_MS - Date.now();
  if (waitMs <= 0) {
    void collectGarbage().catch(() => undefined);
    return;
  }
  if (deferredCollection) {
    return;
  }
  deferredCollection = setTimeout(() => {
    deferredCollection = null;
    void collectGarbage().catch(() => undefined);
  }, waitMs);
  // Never hold the process open for maintenance.
  deferredCollection.unref?.();
}

export async function collectGarbage(): Promise<void> {
  lastCollectionAt = Date.now();
  const layout = getManagedStoreLayout();
  await collectStaleStaging(layout);
  await emptyTrash(layout);
  const current = readCurrentManifest(layout.root);
  const finalized = listFinalizedReleases(layout);
  const protectedIds = listProtectedReleaseIds(current, finalized);
  const now = Date.now();

  for (const release of finalized) {
    if (protectedIds.has(release.releaseId)) {
      continue;
    }
    // A finalized-but-unpublished release belongs to an installer that may
    // still be between finalize and publish. The directory's own age answers
    // that, whatever date the manifest carries.
    if (now - release.finalizedAt < YT_DLP_RELEASE_MIN_RETENTION_MS) {
      continue;
    }
    await collectReleaseIfUnused(layout, release.releaseId);
  }
}

function listFinalizedReleases(layout: ManagedStoreLayout): FinalizedRelease[] {
  const releases: FinalizedRelease[] = [];
  for (const name of listSafeDirNames(layout.releasesDir, layout.root)) {
    if (!isValidReleaseId(name)) {
      continue;
    }
    const manifest = readReleaseManifest(name, layout.root);
    if (!manifest) {
      // An unreadable manifest may be a half-written directory rather than a
      // collectable release, so leave it alone.
      continue;
    }
    let finalizedAt = Date.now();
    try {
      finalizedAt = fs.statSync(getReleaseDir(layout, name)).mtimeMs;
    } catch {
      // Unstattable: treat it as brand new and keep it.
    }
    releases.push({
      releaseId: name,
      installedAt: Date.parse(manifest.installedAt) || 0,
      finalizedAt,
      generation: readPublishedManifest(name, layout.root)?.generation ?? null,
    });
  }
  return releases.sort((a, b) => b.installedAt - a.installedAt);
}

function listProtectedReleaseIds(
  current: CurrentManifest | null,
  finalized: FinalizedRelease[]
): Set<string> {
  const ids = new Set<string>();
  if (current) {
    ids.add(current.releaseId);
    if (current.previousReleaseId) {
      ids.add(current.previousReleaseId);
    }
  }
  // The rollback window is publication lineage, not install order. A candidate
  // that was finalized but rejected (an already-current update, or a loser in a
  // concurrent install) carries the newest install time yet was never current,
  // so counting it here would displace a real rollback target.
  const published = finalized
    .filter((release) => release.generation !== null)
    .sort((a, b) => (b.generation as number) - (a.generation as number));
  const window = published.length ? published : finalized;
  for (const release of window.slice(0, 1 + YT_DLP_GC_KEEP_PREVIOUS_COUNT)) {
    ids.add(release.releaseId);
  }
  return ids;
}

async function collectReleaseIfUnused(
  layout: ManagedStoreLayout,
  releaseId: string
): Promise<void> {
  if (hasLeases(releaseId)) {
    reportStaleLeases(releaseId);
    return;
  }
  // Claim the deleting marker exclusively first, then re-check leases: a reader
  // that arrives after the marker exists abandons this release and retries.
  const token = beginGcMarker(releaseId);
  if (!token) {
    return;
  }
  if (hasLeases(releaseId)) {
    abortGcMarker(releaseId, token);
    return;
  }
  // Move the release out of reach before deleting it. The rename is atomic and
  // takes microseconds, so the marker only has to stay visible across it rather
  // than across the whole deletion - which means a slow or suspended delete can
  // no longer outlive the marker and let a reader lease a half-removed release.
  // Once renamed, nothing can resolve it: recovery simply picks another.
  const releaseDir = getReleaseDir(layout, releaseId);
  const trashPath = getTrashPath(layout, releaseId, token);
  try {
    renameInRoot(releaseDir, trashPath, layout.root);
  } catch (error: unknown) {
    abortGcMarker(releaseId, token);
    logger.warn(
      `[yt-dlp] Failed to retire release ${releaseId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return;
  }

  // Re-check after the rename, not just before it. A reader writes its lease
  // before it validates the release directory, so a lease that appeared while
  // we were renaming is visible now - and putting the release back is what lets
  // that reader's own directory check succeed. This is what makes the protocol
  // safe without relying on how long the marker stays live.
  if (hasLeases(releaseId)) {
    try {
      renameInRoot(trashPath, releaseDir, layout.root);
      logger.info(
        `[yt-dlp] Restored release ${releaseId}: a reader leased it mid-retirement`
      );
    } catch (error: unknown) {
      logger.warn(
        `[yt-dlp] Could not restore release ${releaseId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    abortGcMarker(releaseId, token);
    return;
  }
  abortGcMarker(releaseId, token);

  try {
    await removeSafe(trashPath, layout.root);
    logger.info(`[yt-dlp] Garbage-collected unused release ${releaseId}`);
  } catch (error: unknown) {
    // Harmless: the release is already unreachable, and the next collection
    // sweeps whatever is left behind.
    logger.warn(
      `[yt-dlp] Retired release ${releaseId} but could not delete it yet: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Report, never reclaim. A lease whose owner looks dead may still have an
 * orphaned yt-dlp child reading from the release, and PIDs are reused across
 * container restarts, so removing one is an explicit operator decision.
 */
function reportStaleLeases(releaseId: string): void {
  const now = Date.now();
  for (const lease of readLeaseRecords(releaseId)) {
    const createdAt = Date.parse(lease.createdAt);
    if (!Number.isFinite(createdAt)) {
      continue;
    }
    const ageMs = now - createdAt;
    if (
      ageMs < YT_DLP_STALE_LEASE_WARN_MS ||
      lease.instanceId === getInstanceId()
    ) {
      continue;
    }
    logger.warn(
      `[yt-dlp] Release ${releaseId} is still pinned by a lease from instance ` +
        `${lease.instanceId} (pid ${lease.pid}, operation ${lease.operationId}) created ` +
        `${lease.createdAt}, ${Math.round(ageMs / 3_600_000)}h ago. If that backend is gone, ` +
        "delete the lease file to let this release be reclaimed."
    );
  }
}

/** Trash entries are named `<releaseId>.<collector token>`. */
function isRetirementInFlight(trashEntryName: string): boolean {
  const separator = trashEntryName.lastIndexOf(".");
  if (separator <= 0) {
    return false;
  }
  const releaseId = trashEntryName.slice(0, separator);
  const token = trashEntryName.slice(separator + 1);
  if (!isValidReleaseId(releaseId)) {
    return false;
  }
  return hasGcMarkerToken(releaseId, token);
}

/**
 * Delete anything left in the trash. Entries here are unreachable by
 * construction - they were renamed out of releases/ - so a collector that died
 * mid-deletion leaves nothing that needs to be reasoned about.
 */
async function emptyTrash(layout: ManagedStoreLayout): Promise<void> {
  if (!pathExistsInRoot(layout.trashDir, layout.root)) {
    return;
  }
  for (const name of listSafeDirNames(layout.trashDir, layout.root)) {
    // A retirement in flight has its release sitting here between the rename
    // and the lease re-check that may put it back. Deleting it then would make
    // that restoration impossible and leave a reader that legitimately leased
    // the release running against removed modules. The owning collector still
    // holds its marker until the retirement is settled, so that is the signal.
    if (isRetirementInFlight(name)) {
      continue;
    }
    try {
      await removeSafe(path.join(layout.trashDir, name), layout.root);
    } catch {
      // Retried by the next collection.
    }
  }
}

async function collectStaleStaging(layout: ManagedStoreLayout): Promise<void> {
  if (!pathExistsInRoot(layout.stagingDir, layout.root)) {
    return;
  }
  const now = Date.now();
  for (const name of listSafeDirNames(layout.stagingDir, layout.root)) {
    if (!isValidOperationId(name)) {
      continue;
    }
    const dir = path.join(layout.stagingDir, name);
    try {
      // The age threshold is what protects a second backend process that is
      // legitimately mid-install in a shared data directory.
      if (now - fs.statSync(dir).mtimeMs < YT_DLP_STAGING_MAX_AGE_MS) {
        continue;
      }
      await removeSafe(dir, layout.root);
    } catch {
      // Leave staging dirs we cannot stat or delete.
    }
  }
}
