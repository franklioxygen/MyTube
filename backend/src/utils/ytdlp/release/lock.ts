import fs from "fs";
import { getErrorMessage } from "../../errors";
import { logger } from "../../logger";
import {
  YT_DLP_PUBLISH_LOCK_STALE_MS,
  YT_DLP_PUBLISH_LOCK_WAIT_MS,
} from "../constants";
import {
  createNonce,
  createOperationId,
  isValidHexNonce,
  isValidInstanceId,
  isValidOperationId,
} from "./ids";
import { getInstanceId } from "./leases";
import {
  assertNotSymlink,
  chmodQuiet,
  fsyncDirectory,
  getManagedStoreLayout,
  getPublishLockOwnerPath,
  mkdirExclusive,
  pathExistsInRoot,
  readTextFile,
  statMtimeMs,
  unlinkInRoot,
  writeJsonExclusive,
} from "./paths";
import type { ManagedStoreLayout, PublishLockOwner } from "./types";

const LOCK_RETRY_MS = 50;

export type PublishLock = {
  layout: ManagedStoreLayout;
  owner: PublishLockOwner;
};

export async function withPublishLock<T>(
  task: (lock: PublishLock) => Promise<T>,
  layout: ManagedStoreLayout = getManagedStoreLayout()
): Promise<T> {
  const lock = await acquirePublishLock(layout);
  try {
    return await task(lock);
  } finally {
    releasePublishLock(lock);
  }
}

export async function acquirePublishLock(
  layout: ManagedStoreLayout = getManagedStoreLayout(),
  waitMs: number = YT_DLP_PUBLISH_LOCK_WAIT_MS
): Promise<PublishLock> {
  // Created on demand rather than by ensureManagedStoreLayout, so it needs its
  // own check: owner reads and stale-lock recovery would otherwise follow a
  // symlink and could unlink a file outside the managed store.
  assertNotSymlink(layout.publishLockDir, layout.root);

  const deadline = Date.now() + waitMs;
  const owner: PublishLockOwner = {
    operationId: createOperationId(),
    nonce: createNonce(),
    pid: process.pid,
    instanceId: getInstanceId(),
    createdAt: new Date().toISOString(),
  };

  while (true) {
    if (tryClaimLock(layout, owner)) {
      return { layout, owner };
    }
    maybeRecoverStaleLock(layout);
    if (Date.now() >= deadline) {
      throw new Error(
        "Timed out waiting for yt-dlp publish lock: another publisher holds it"
      );
    }
    await delay(LOCK_RETRY_MS);
  }
}

/**
 * Claim the lock, or report that somebody else holds it.
 *
 * The directory creation is the exclusive claim, but it is not the whole claim:
 * there is a window between it and the owner write in which a contender could
 * have reclaimed and recreated the directory. Writing the owner file
 * exclusively closes that window - a late writer fails instead of overwriting
 * the owner file the contender just wrote, which would otherwise let both
 * processes pass their ownership checks.
 */
function tryClaimLock(
  layout: ManagedStoreLayout,
  owner: PublishLockOwner
): boolean {
  try {
    mkdirExclusive(layout.publishLockDir);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }

  try {
    writeJsonExclusive(getPublishLockOwnerPath(layout), owner);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    // Our own directory is unusable. Drop it rather than leave a lock nobody
    // can own and everybody waits on.
    try {
      fs.rmdirSync(layout.publishLockDir);
    } catch {
      // Best effort; stale-lock recovery reclaims it by age.
    }
    throw error;
  }

  chmodQuiet(layout.publishLockDir, 0o700);
  fsyncDirectory(layout.publishLockDir);
  return true;
}

export function assertLockOwnership(lock: PublishLock): void {
  const ownerPath = getPublishLockOwnerPath(lock.layout);
  if (!pathExistsInRoot(ownerPath, lock.layout.root)) {
    throw new Error("Publish lock owner file is missing; aborting publication");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readTextFile(ownerPath, lock.layout.root));
  } catch {
    throw new Error(
      "Publish lock owner file is unreadable; aborting publication"
    );
  }
  const owner = parseLockOwner(parsed);
  if (!owner || owner.nonce !== lock.owner.nonce) {
    throw new Error("Publish lock was stolen; aborting publication");
  }
}

export function releasePublishLock(lock: PublishLock): void {
  try {
    const ownerPath = getPublishLockOwnerPath(lock.layout);
    if (pathExistsInRoot(ownerPath, lock.layout.root)) {
      try {
        const owner = parseLockOwner(
          JSON.parse(readTextFile(ownerPath, lock.layout.root))
        );
        if (owner && owner.nonce !== lock.owner.nonce) {
          return;
        }
      } catch {
        return;
      }
      unlinkInRoot(ownerPath, lock.layout.root);
    }
    fs.rmdirSync(lock.layout.publishLockDir);
  } catch (error: unknown) {
    logger.warn(
      `[yt-dlp] Failed to release publish lock: ${getErrorMessage(error, "unknown error")}`
    );
  }
}

function maybeRecoverStaleLock(layout: ManagedStoreLayout): void {
  const ownerPath = getPublishLockOwnerPath(layout);

  if (!pathExistsInRoot(ownerPath, layout.root)) {
    // A lock directory with no owner file is either a backend that died between
    // the mkdir and the owner write, or a live acquisition microseconds away
    // from writing one. Only age separates them, so never delete a directory
    // that is still young - doing so destroys a lock that is about to be valid.
    reclaimExpiredLockDir(layout, "no owner file");
    return;
  }

  let owner: PublishLockOwner | null = null;
  try {
    owner = parseLockOwner(JSON.parse(readTextFile(ownerPath, layout.root)));
  } catch {
    owner = null;
  }
  if (!owner) {
    // A crash partway through the owner write leaves malformed JSON. Giving up
    // here would wedge the publish lock permanently and fail every future
    // update, so fall back to the same age-based reclamation.
    reclaimExpiredLockDir(layout, "unreadable owner file");
    return;
  }

  const createdAt = Date.parse(owner.createdAt);
  if (!Number.isFinite(createdAt)) {
    reclaimExpiredLockDir(layout, "invalid owner timestamp");
    return;
  }
  // Expiry is the signal, not PID liveness. The critical section contains no
  // network or pip work and completes in well under a second, so a lock this
  // old is broken by construction - while a restarted container often reuses
  // the crashed backend's PID, which would keep a dead owner looking alive and
  // wedge every future update. Stealing an expired lock is safe because a
  // suspended publisher rechecks its nonce (assertLockOwnership) immediately
  // before replacing current.json and aborts if it lost ownership.
  if (Date.now() - createdAt < YT_DLP_PUBLISH_LOCK_STALE_MS) {
    return;
  }
  if (isOwnedByThisInstance(owner)) {
    // Our own process is wedged. Another thread of control here cannot make
    // that safer, and the owner would abort at its nonce check anyway.
    return;
  }

  logger.warn(
    `[yt-dlp] Recovering publish lock held since ${owner.createdAt} by pid ${owner.pid}` +
      `${owner.instanceId ? ` instance ${owner.instanceId}` : ""} operation ${owner.operationId}`
  );
  removeLock(layout, () => ownerNonceMatches(layout, owner.nonce));
}

/**
 * Remove a lock directory that has been unusable for longer than the stale
 * window. Age is measured on the directory itself, which is what a crashed or
 * partial acquisition leaves behind.
 */
function reclaimExpiredLockDir(
  layout: ManagedStoreLayout,
  reason: string
): void {
  const mtimeMs = statMtimeMs(layout.publishLockDir);
  if (mtimeMs === null) {
    return;
  }
  const ageMs = Date.now() - mtimeMs;
  if (ageMs < YT_DLP_PUBLISH_LOCK_STALE_MS) {
    return;
  }
  logger.warn(
    `[yt-dlp] Reclaiming publish lock with ${reason} after ${Math.round(ageMs / 1000)}s`
  );
  // There is no owner identity to match on here, so use the directory itself
  // plus the absence of a usable owner: if another process already reclaimed
  // and re-took the lock, either its mtime moved or it now has a real owner.
  removeLock(
    layout,
    () =>
      statMtimeMs(layout.publishLockDir) === mtimeMs && ownerStillUnusable(layout)
  );
}

/**
 * Remove the lock that was actually observed.
 *
 * Two processes can decide the same lock is stale at once. Deleting whichever
 * owner happens to occupy the path at removal time would let the second one
 * destroy a fresh lock the first had already replaced it with, and the new
 * publisher would then fail its own ownership assertion. So the caller supplies
 * a check of the identity it observed, evaluated immediately before removal.
 */
function removeLock(layout: ManagedStoreLayout, stillTheSame: () => boolean): void {
  try {
    if (!stillTheSame()) {
      return;
    }
    const ownerPath = getPublishLockOwnerPath(layout);
    if (pathExistsInRoot(ownerPath, layout.root)) {
      unlinkInRoot(ownerPath, layout.root);
    }
    fs.rmdirSync(layout.publishLockDir);
  } catch {
    // Conservative: leave the lock if cleanup races another process.
  }
}

/** True while the owner file still names the owner we decided was stale. */
function ownerNonceMatches(
  layout: ManagedStoreLayout,
  nonce: string
): boolean {
  const ownerPath = getPublishLockOwnerPath(layout);
  if (!pathExistsInRoot(ownerPath, layout.root)) {
    return false;
  }
  try {
    const owner = parseLockOwner(
      JSON.parse(readTextFile(ownerPath, layout.root))
    );
    return owner?.nonce === nonce;
  } catch {
    return false;
  }
}

/**
 * True while the lock still has no usable owner. A replacement publisher writes
 * a valid owner file, so a lock that now parses belongs to somebody and must be
 * left alone.
 */
function ownerStillUnusable(layout: ManagedStoreLayout): boolean {
  const ownerPath = getPublishLockOwnerPath(layout);
  if (!pathExistsInRoot(ownerPath, layout.root)) {
    return true;
  }
  try {
    return (
      parseLockOwner(JSON.parse(readTextFile(ownerPath, layout.root))) === null
    );
  } catch {
    return true;
  }
}

function parseLockOwner(value: unknown): PublishLockOwner | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.operationId !== "string" ||
    !isValidOperationId(record.operationId)
  ) {
    return null;
  }
  if (typeof record.nonce !== "string" || !isValidHexNonce(record.nonce)) {
    return null;
  }
  if (typeof record.pid !== "number" || !Number.isInteger(record.pid)) {
    return null;
  }
  if (typeof record.createdAt !== "string") {
    return null;
  }
  if (
    record.instanceId !== undefined &&
    (typeof record.instanceId !== "string" ||
      !isValidInstanceId(record.instanceId))
  ) {
    return null;
  }
  return {
    operationId: record.operationId,
    nonce: record.nonce,
    pid: record.pid,
    ...(record.instanceId ? { instanceId: record.instanceId } : {}),
    createdAt: record.createdAt,
  };
}

/**
 * True only when this exact process wrote the lock. A lock without an
 * instanceId came from an older build and cannot be attributed to anyone, so
 * it is treated as another instance's and becomes recoverable once expired.
 */
function isOwnedByThisInstance(owner: PublishLockOwner): boolean {
  return owner.instanceId !== undefined && owner.instanceId === getInstanceId();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
