import crypto from "crypto";
import { asc, desc } from "drizzle-orm";
import { db } from "../../db";
import { videos } from "../../db/schema";
import {
  currentExportRevision,
  effectiveAudience,
  isCloudStorageAvailable,
  publicOnly,
  readExportRows,
  toSummary,
  type FederationAudience,
  type FederationVideoSummary,
} from "./libraryExport";
import type { FederationPrincipal } from "./tokenService";

/**
 * Native-library snapshots served to federation consumers (design §5.1).
 *
 * A snapshot pins the ordered ids of this instance's own `videos` rows that
 * the audience may see, together with the export revision at capture. Every
 * exported change moves that revision, so a page is served only while it is
 * unchanged: rows read later are then exactly the rows at capture, and the
 * consumer never pages through a moving OFFSET window. Any change, policy
 * change, or missing row answers "stale" and the consumer starts over.
 */

export const SNAPSHOT_PAGE_SIZE = 500;
export const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
export const MAX_SNAPSHOTS_PER_TOKEN = 2;
export const MAX_SNAPSHOTS = 8;

interface Snapshot {
  id: string;
  tokenId: string;
  policyRevision: string;
  audience: FederationAudience;
  libraryRevision: string;
  ids: string[];
  createdAt: number;
  expiresAt: number;
}

const snapshots = new Map<string, Snapshot>();

const pruneExpired = (now: number): void => {
  for (const [id, snapshot] of snapshots) {
    if (snapshot.expiresAt <= now) snapshots.delete(id);
  }
};

export interface SnapshotDescriptor {
  snapshotId: string;
  audience: FederationAudience;
  libraryRevision: string;
  policyRevision: string;
  totalCount: number;
  pageSize: number;
  expiresAt: number;
}

export type CreateSnapshotResult =
  | { ok: true; snapshot: SnapshotDescriptor }
  | { ok: false; reason: "capacity" };

export function createSnapshot(
  principal: FederationPrincipal,
  requested: FederationAudience,
  now = Date.now()
): CreateSnapshotResult {
  pruneExpired(now);

  // A consumer starting over has abandoned its older snapshots; let it
  // replace them rather than wait for expiry. Other consumers are protected
  // by the global bound.
  const own = [...snapshots.values()]
    .filter((snapshot) => snapshot.tokenId === principal.tokenId)
    .sort((a, b) => a.createdAt - b.createdAt);
  while (own.length >= MAX_SNAPSHOTS_PER_TOKEN) {
    snapshots.delete(own.shift()!.id);
  }
  if (snapshots.size >= MAX_SNAPSHOTS) {
    return { ok: false, reason: "capacity" };
  }

  const audience = effectiveAudience(requested, principal.visibilityCeiling);
  // Synchronous: no write can land between reading the revision and the ids.
  const libraryRevision = currentExportRevision();
  const ids = db
    .select({ id: videos.id })
    .from(videos)
    .where(audience === "public" ? publicOnly() : undefined)
    .orderBy(desc(videos.createdAt), asc(videos.id))
    .all()
    .map((row) => row.id);

  const snapshot: Snapshot = {
    id: crypto.randomBytes(16).toString("base64url"),
    tokenId: principal.tokenId,
    policyRevision: principal.policyRevision,
    audience,
    libraryRevision,
    ids,
    createdAt: now,
    expiresAt: now + SNAPSHOT_TTL_MS,
  };
  snapshots.set(snapshot.id, snapshot);

  return {
    ok: true,
    snapshot: {
      snapshotId: snapshot.id,
      audience,
      libraryRevision,
      policyRevision: snapshot.policyRevision,
      totalCount: ids.length,
      pageSize: SNAPSHOT_PAGE_SIZE,
      expiresAt: snapshot.expiresAt,
    },
  };
}

const encodeCursor = (snapshotId: string, offset: number): string =>
  Buffer.from(`${snapshotId}:${offset}`, "utf8").toString("base64url");

const decodeCursor = (cursor: string, snapshot: Snapshot): number | null => {
  const [snapshotId, offsetText] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
  const offset = Number(offsetText);
  return snapshotId === snapshot.id &&
    /^\d+$/.test(offsetText ?? "") &&
    offset < snapshot.ids.length
    ? offset
    : null;
};

export interface SnapshotPage {
  snapshotId: string;
  totalCount: number;
  items: FederationVideoSummary[];
  nextCursor: string | null;
  /** True only on the final page of a snapshot served without change. */
  complete: boolean;
}

export type ReadSnapshotPageResult =
  | { ok: true; page: SnapshotPage }
  | { ok: false; reason: "not_found" | "stale" | "invalid_cursor" };

const findSnapshot = (
  principal: FederationPrincipal,
  snapshotId: string,
  now: number
): Snapshot | null => {
  pruneExpired(now);
  const snapshot = snapshots.get(snapshotId);
  // Another credential's snapshot is indistinguishable from a missing one.
  return snapshot && snapshot.tokenId === principal.tokenId ? snapshot : null;
};

export function readSnapshotPage(
  principal: FederationPrincipal,
  snapshotId: string,
  cursor: string | undefined,
  now = Date.now()
): ReadSnapshotPageResult {
  const snapshot = findSnapshot(principal, snapshotId, now);
  if (!snapshot) return { ok: false, reason: "not_found" };

  if (
    snapshot.policyRevision !== principal.policyRevision ||
    snapshot.libraryRevision !== currentExportRevision()
  ) {
    snapshots.delete(snapshot.id);
    return { ok: false, reason: "stale" };
  }

  let offset = 0;
  if (cursor !== undefined) {
    const decoded = decodeCursor(cursor, snapshot);
    if (decoded === null) return { ok: false, reason: "invalid_cursor" };
    offset = decoded;
  }

  const pageIds = snapshot.ids.slice(offset, offset + SNAPSHOT_PAGE_SIZE);
  const byId = new Map(readExportRows(pageIds).map((row) => [row.id, row]));
  const cloudAvailable = isCloudStorageAvailable();

  const items: FederationVideoSummary[] = [];
  for (const id of pageIds) {
    const row = byId.get(id);
    // Unreachable while the revision is unchanged; fail closed regardless.
    if (!row || (snapshot.audience === "public" && row.visibility === 0)) {
      snapshots.delete(snapshot.id);
      return { ok: false, reason: "stale" };
    }
    items.push(toSummary(row, cloudAvailable));
  }

  const nextOffset = offset + pageIds.length;
  const complete = nextOffset >= snapshot.ids.length;
  return {
    ok: true,
    page: {
      snapshotId: snapshot.id,
      totalCount: snapshot.ids.length,
      items,
      nextCursor: complete ? null : encodeCursor(snapshot.id, nextOffset),
      complete,
    },
  };
}

/** Lets a consumer release a snapshot it has finished with. */
export function releaseSnapshot(
  principal: FederationPrincipal,
  snapshotId: string,
  now = Date.now()
): boolean {
  const snapshot = findSnapshot(principal, snapshotId, now);
  return snapshot ? snapshots.delete(snapshot.id) : false;
}

/** Test hook: snapshots are process memory. */
export function clearSnapshotsForTests(): void {
  snapshots.clear();
}
