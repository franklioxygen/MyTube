import fs from "fs";
import path from "path";
import { logger } from "../../logger";
import { YT_DLP_PUBLISH_LOCK_STALE_MS } from "../constants";
import { ensureDirSafeSync } from "../../security";
import {
  createInstanceId,
  createLeaseFilename,
  createLeaseId,
  isValidLeaseFilename,
  isValidLeaseId,
  isValidReleaseId,
} from "./ids";
import {
  assertNotSymlink,
  chmodQuiet,
  getGcMarkerPath,
  getLeaseDir,
  getManagedStoreLayout,
  getReleaseDir,
  listSafeDirNames,
  mkdirExclusive,
  pathExistsInRoot,
  readTextFile,
  statMtimeMs,
  unlinkInRoot,
  writeJsonInPlace,
} from "./paths";
import type { LeaseRecord } from "./types";

const MARKER_OWNER_FILENAME = "owner.json";

const instanceId = createInstanceId();

export function getInstanceId(): string {
  return instanceId;
}

export function acquireLease(
  releaseId: string,
  operationId: string
): { releaseId: string; leaseFilename: string } {
  if (!isValidReleaseId(releaseId)) {
    throw new Error(`Invalid release id: ${releaseId}`);
  }
  const layout = getManagedStoreLayout();
  const leaseDir = getLeaseDir(layout, releaseId);
  // Created on demand per release, so it needs its own check: following a
  // symlink here would write the lease outside the managed store.
  assertNotSymlink(leaseDir, layout.root);
  ensureDirSafeSync(leaseDir, layout.root);
  const leaseFilename = createLeaseFilename(instanceId, createLeaseId());
  const leasePath = path.join(leaseDir, leaseFilename);
  const record: LeaseRecord = {
    schemaVersion: 1,
    releaseId,
    instanceId,
    pid: process.pid,
    operationId,
    createdAt: new Date().toISOString(),
  };
  writeJsonInPlace(leasePath, record);
  chmodQuiet(leasePath, 0o600);

  // Two-phase marker protocol: the lease exists before these checks, so a
  // collector that claims the marker afterwards still sees the lease and skips
  // the release. A marker already present means this reader lost the race and
  // must retry acquisition without using this release.
  //
  // Every exit from here has to take the lease with it. These checks can throw
  // as well as fail - a malformed store makes the symlink guard throw - and a
  // lease left behind would pin the release permanently.
  try {
    if (hasLiveGcMarker(releaseId)) {
      throw new Error("Release is being deleted");
    }
    if (!pathExistsInRoot(getReleaseDir(layout, releaseId), layout.root)) {
      throw new Error("Release directory is missing");
    }
  } catch (error: unknown) {
    unlinkInRoot(leasePath, layout.root);
    throw error;
  }
  return { releaseId, leaseFilename };
}

export function releaseLease(
  releaseId: string,
  leaseFilename: string
): void {
  if (!isValidReleaseId(releaseId) || !isValidLeaseFilename(leaseFilename)) {
    return;
  }
  const layout = getManagedStoreLayout();
  const leasePath = path.join(getLeaseDir(layout, releaseId), leaseFilename);
  if (pathExistsInRoot(leasePath, layout.root)) {
    unlinkInRoot(leasePath, layout.root);
  }
}

export function listLeaseFilenames(releaseId: string): string[] {
  const layout = getManagedStoreLayout();
  const leaseDir = getLeaseDir(layout, releaseId);
  if (!pathExistsInRoot(leaseDir, layout.root)) {
    return [];
  }
  return listSafeDirNames(leaseDir, layout.root).filter(isValidLeaseFilename);
}

export function hasLeases(releaseId: string): boolean {
  return listLeaseFilenames(releaseId).length > 0;
}

/**
 * Read the lease records pinning a release. Used for reporting only: a lease is
 * never removed on the strength of what it says about its owner.
 */
export function readLeaseRecords(releaseId: string): LeaseRecord[] {
  const layout = getManagedStoreLayout();
  const leaseDir = getLeaseDir(layout, releaseId);
  const records: LeaseRecord[] = [];
  for (const filename of listLeaseFilenames(releaseId)) {
    try {
      const parsed: unknown = JSON.parse(
        readTextFile(path.join(leaseDir, filename), layout.root)
      );
      if (isLeaseRecord(parsed)) {
        records.push(parsed);
      }
    } catch {
      // An unreadable lease still counts as a lease; it just cannot be named.
    }
  }
  return records;
}

function isLeaseRecord(value: unknown): value is LeaseRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    typeof record.releaseId === "string" &&
    typeof record.instanceId === "string" &&
    typeof record.pid === "number" &&
    typeof record.operationId === "string" &&
    typeof record.createdAt === "string"
  );
}

/**
 * Claim the deleting marker for a release. Exclusive directory creation is the
 * claim: a marker that already exists belongs to another collector, so this
 * caller reports failure rather than deleting a release it does not own — and,
 * critically, never removes the other collector's marker on the way out.
 */
/**
 * Claim the deletion marker for a release, returning an ownership token.
 *
 * Each collector writes its own uniquely named marker file rather than
 * competing for one shared path. That removes the reclamation race entirely:
 * there is never a moment where one collector removes something another
 * created, because a collector only ever deletes the file it wrote. Presence of
 * *any* live marker is what blocks a reader, exactly as before.
 *
 * Markers left by a killed collector are ignored once older than the stale
 * window - a collection never legitimately runs that long - so they can neither
 * block a release forever nor be stolen from a collector still using them.
 */
export function beginGcMarker(releaseId: string): string | null {
  const layout = getManagedStoreLayout();
  const markerDir = getGcMarkerPath(layout, releaseId);
  // Same reasoning as the lease directory above.
  try {
    assertNotSymlink(markerDir, layout.root);
  } catch {
    return null;
  }
  ensureDirSafeSync(markerDir, layout.root);
  const token = createLeaseId();
  const markerPath = path.join(markerDir, `${token}.json`);

  try {
    writeJsonInPlace(markerPath, {
      releaseId,
      instanceId,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    });
  } catch {
    return null;
  }

  // Two-phase, like leases: our marker exists before we look, so a collector
  // arriving later cannot miss it.
  if (liveMarkerTokens(layout, releaseId, token).length > 0) {
    removeMarkerFile(layout, markerPath);
    return null;
  }
  return token;
}

/** Release a marker. Only ever removes the file this collector wrote. */
export function abortGcMarker(releaseId: string, token: string): void {
  const layout = getManagedStoreLayout();
  if (!isValidLeaseId(token)) {
    return;
  }
  removeMarkerFile(
    layout,
    path.join(getGcMarkerPath(layout, releaseId), `${token}.json`)
  );
}

/** True while any collector is actively deleting this release. */
export function hasLiveGcMarker(releaseId: string): boolean {
  const layout = getManagedStoreLayout();
  return liveMarkerTokens(layout, releaseId).length > 0;
}

function liveMarkerTokens(
  layout: ReturnType<typeof getManagedStoreLayout>,
  releaseId: string,
  excludeToken?: string
): string[] {
  const markerDir = getGcMarkerPath(layout, releaseId);
  if (!pathExistsInRoot(markerDir, layout.root)) {
    return [];
  }
  const now = Date.now();
  const live: string[] = [];
  for (const name of listSafeDirNames(markerDir, layout.root)) {
    const token = name.endsWith(".json") ? name.slice(0, -5) : null;
    if (!token || !isValidLeaseId(token) || token === excludeToken) {
      continue;
    }
    const markedAt = statMtimeMs(path.join(markerDir, name));
    if (markedAt === null) {
      continue;
    }
    if (now - markedAt >= YT_DLP_PUBLISH_LOCK_STALE_MS) {
      // Abandoned by a killed collector: ignore it rather than reclaim it, so
      // nothing ever deletes a marker it does not own.
      continue;
    }
    live.push(token);
  }
  return live;
}

function removeMarkerFile(
  layout: ReturnType<typeof getManagedStoreLayout>,
  markerPath: string
): void {
  try {
    if (pathExistsInRoot(markerPath, layout.root)) {
      unlinkInRoot(markerPath, layout.root);
    }
  } catch {
    // A leftover marker expires on its own; readers retry meanwhile.
  }
}
