import crypto from "crypto";
import { sqlite } from "../../db";
import { logger } from "../../utils/logger";
import type { FederationVideoSummary } from "./libraryExport";
import { peerJsonRequest, PeerError, type PeerConnection } from "./peerClient";
import {
  connectionFor,
  getDatabaseEpoch,
  handshake,
  HandshakeError,
  readPeerRow,
  SERVABLE_PEER_STATUSES,
  type PeerRow,
  type PeerStatus,
} from "./peerService";
import {
  parseLibraryRevision,
  parseSnapshotDescriptor,
  parseSnapshotPage,
  ProtocolError,
} from "./protocolSchema";

/**
 * One synchronization of one peer (design §6.1).
 *
 * Nothing is written until a whole snapshot has been read and validated and
 * the peer confirms its revisions did not move. The commit is one local
 * transaction that also checks the binding is still enabled and of the same
 * generation, and that the database file was not replaced since the sync
 * began, so a disable, credential change, import or restore discards it. Only a validated, complete snapshot may tombstone items: a
 * timeout, refusal, bad payload or partial read keeps the last good state.
 */

export const MAX_REMOTE_ITEMS = 100_000;

export interface SyncResult {
  peerId: string;
  status: PeerStatus;
  /** False when the peer's revisions were unchanged and nothing was read. */
  changed: boolean;
  upserted?: number;
  tombstoned?: number;
  error?: string;
}

class SyncAbort extends Error {
  constructor(
    public readonly status: PeerStatus,
    message: string
  ) {
    super(message);
    this.name = "SyncAbort";
  }
}

const inFlight = new Map<string, Promise<SyncResult>>();

const recordAttempt = (
  row: PeerRow,
  epoch: number,
  status: PeerStatus,
  error: string | null,
  now: number
): void => {
  // Health is recorded only for the generation, and the database file, that
  // ran; a newer one owns it.
  if (getDatabaseEpoch() !== epoch) return;
  // A non-servable outcome also drops the validated revision, so the cache
  // stays hidden until a sync commits again (see SERVABLE_PEER_STATUSES).
  const keepsCache = SERVABLE_PEER_STATUSES.includes(status);
  sqlite
    .prepare(
      `UPDATE federation_peers
         SET status = ?, last_error = ?, last_attempt_at = ?, updated_at = ?,
             library_revision = CASE WHEN ? THEN library_revision ELSE NULL END
       WHERE id = ? AND generation = ?`
    )
    .run(status, error, now, now, keepsCache ? 1 : 0, row.id, row.generation);
};

const REPLACED = "The database was replaced during the sync.";
const OVERTAKEN = "The peer binding changed during the sync.";

/**
 * A sync something else overtook (a disable, credential change, quarantine
 * or database replacement) committed nothing, so it reports a failure even
 * when the peer was healthy. Its status is not recorded: the newer state owns
 * the binding.
 */
const overtaken = (message: string): SyncAbort => new SyncAbort("error", message);

const statusFor = (error: unknown): PeerStatus => {
  if (error instanceof SyncAbort) return error.status;
  if (error instanceof HandshakeError) return error.status;
  if (error instanceof PeerError) {
    if (error.kind === "credential_rejected") return "credential_rejected";
    if (error.kind === "self_connection") return "identity_mismatch";
  }
  // Unreachable, busy, stale, malformed: transient; keep the last good data.
  return "error";
};

/** The peer must answer for the audience this binding asked for. */
const assertAudience = (answered: "public" | "owner", row: PeerRow): void => {
  if (answered !== row.audience) {
    throw new ProtocolError(`The peer answered for the ${answered} audience, not ${row.audience}.`);
  }
};

async function readSnapshot(
  connection: PeerConnection,
  row: PeerRow
): Promise<{ items: FederationVideoSummary[]; libraryRevision: string; policyRevision: string }> {
  const snapshot = parseSnapshotDescriptor(
    await peerJsonRequest(connection, "post", "/snapshots", { audience: row.audience })
  );
  try {
    if (snapshot.instanceId !== row.peer_instance_id) {
      throw new SyncAbort("identity_mismatch", "The peer answered with a different instance id.");
    }
    // A narrower snapshot would make every item outside it look deleted.
    assertAudience(snapshot.audience, row);
    if (snapshot.totalCount > MAX_REMOTE_ITEMS) {
      throw new SyncAbort("error", `The peer library exceeds ${MAX_REMOTE_ITEMS} items.`);
    }

    const items: FederationVideoSummary[] = [];
    const seen = new Set<string>();
    // Pages hold at most pageSize items, but a peer may cut them short by
    // size; every unfinished page must carry an item, which bounds the loop.
    const maxPages = snapshot.totalCount + 1;
    let cursor: string | null = null;
    for (let pageNumber = 0; ; pageNumber += 1) {
      if (pageNumber >= maxPages) throw new ProtocolError("The snapshot did not end where its count says.");
      const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const page = parseSnapshotPage(
        await peerJsonRequest(
          connection,
          "get",
          `/snapshots/${encodeURIComponent(snapshot.snapshotId)}/videos${query}`
        ),
        snapshot.pageSize
      );
      if (page.snapshotId !== snapshot.snapshotId || page.totalCount !== snapshot.totalCount) {
        throw new ProtocolError("A page does not belong to the snapshot.");
      }
      if (!page.complete && page.items.length === 0) {
        throw new ProtocolError("An unfinished snapshot page was empty.");
      }
      if (page.nextCursor !== null && page.nextCursor === cursor) {
        throw new ProtocolError("The snapshot cursor did not advance.");
      }
      for (const item of page.items) {
        if (seen.has(item.id)) throw new ProtocolError(`The snapshot repeats item ${item.id}.`);
        if (row.audience === "public" && item.visibility !== 1) {
          throw new ProtocolError("A public snapshot contained a hidden item.");
        }
        seen.add(item.id);
        items.push(item);
      }
      if (page.complete) break;
      cursor = page.nextCursor;
    }
    if (items.length !== snapshot.totalCount) {
      throw new ProtocolError("The snapshot item count does not match its total.");
    }
    return { items, libraryRevision: snapshot.libraryRevision, policyRevision: snapshot.policyRevision };
  } finally {
    // Best effort: an unreleased snapshot simply expires on the peer.
    void peerJsonRequest(connection, "delete", `/snapshots/${encodeURIComponent(snapshot.snapshotId)}`).catch(
      () => undefined
    );
  }
}

const newRemoteId = (): string => {
  for (;;) {
    const id = `fed_${crypto.randomUUID()}`;
    // Remote ids must never alias a native video (design §3.1).
    const taken =
      sqlite.prepare("SELECT 1 FROM videos WHERE id = ?").get(id) ??
      sqlite.prepare("SELECT 1 FROM federation_remote_videos WHERE id = ?").get(id);
    if (!taken) return id;
  }
};

function commit(
  row: PeerRow,
  epoch: number,
  items: FederationVideoSummary[],
  libraryRevision: string,
  policyRevision: string,
  now: number
): { upserted: number; tombstoned: number } {
  return sqlite.transaction(() => {
    if (getDatabaseEpoch() !== epoch) throw overtaken(REPLACED);
    const current = readPeerRow(row.id);
    if (!current || current.enabled !== 1 || current.generation !== row.generation) {
      throw overtaken(OVERTAKEN);
    }

    // A per-commit stamp that only moves forward, so "seen in this snapshot"
    // stays exact even if the wall clock steps back between syncs.
    const previous = (
      sqlite
        .prepare("SELECT MAX(last_seen_at) AS stamp FROM federation_remote_videos WHERE peer_id = ?")
        .get(row.id) as { stamp: number | null }
    ).stamp;
    const stamp = Math.max(now, (previous ?? 0) + 1);

    const find = sqlite.prepare(
      "SELECT id FROM federation_remote_videos WHERE peer_id = ? AND remote_video_id = ?"
    );
    const update = sqlite.prepare(
      `UPDATE federation_remote_videos
         SET title = ?, created_at = ?, summary = ?, asset_revision = ?,
             last_seen_at = ?, deleted_at = NULL, updated_at = ?
       WHERE id = ?`
    );
    const insert = sqlite.prepare(
      `INSERT INTO federation_remote_videos
        (id, peer_id, remote_video_id, title, created_at, summary, asset_revision, last_seen_at, deleted_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    );
    for (const item of items) {
      const summary = JSON.stringify(item);
      const existing = find.get(row.id, item.id) as { id: string } | undefined;
      if (existing) {
        update.run(item.title, item.createdAt, summary, item.assetRevision, stamp, now, existing.id);
      } else {
        // A reappearing native id reuses its retained mapping above.
        insert.run(newRemoteId(), row.id, item.id, item.title, item.createdAt, summary, item.assetRevision, stamp, now);
      }
    }

    // Only this validated, complete snapshot authorizes absence-based removal.
    const tombstoned = sqlite
      .prepare(
        `UPDATE federation_remote_videos SET deleted_at = ?, updated_at = ?
         WHERE peer_id = ? AND deleted_at IS NULL AND last_seen_at < ?`
      )
      .run(now, now, row.id, stamp).changes;

    sqlite
      .prepare(
        `UPDATE federation_peers
           SET status = 'ok', last_error = NULL, library_revision = ?, policy_revision = ?,
               last_attempt_at = ?, last_success_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(libraryRevision, policyRevision, now, now, now, row.id);
    return { upserted: items.length, tombstoned };
  })();
}

async function runSync(peerId: string): Promise<SyncResult> {
  const epoch = getDatabaseEpoch();
  const row = readPeerRow(peerId);
  if (!row) return { peerId, status: "error", changed: false, error: "Unknown peer." };
  if (row.enabled !== 1) return { peerId, status: row.status, changed: false, error: "The peer is disabled." };

  const connection = connectionFor(row);
  if (!connection) {
    const message = "The credential cannot be decrypted; the federation key is missing or changed.";
    recordAttempt(row, epoch, "credential_missing", message, Date.now());
    return { peerId, status: "credential_missing", changed: false, error: message };
  }

  try {
    const capabilities = await handshake(connection);
    if (capabilities.instanceId !== row.peer_instance_id) {
      throw new SyncAbort("identity_mismatch", "A different instance now answers at this address.");
    }
    if (capabilities.credential.visibilityCeiling !== row.audience) {
      // The peer changed what this credential may see; the cached view was
      // authorized under other terms (design §6.2). Requires re-registration
      // of the credential to adopt the new audience deliberately.
      throw new SyncAbort("credential_rejected", "The credential's visibility changed on the peer; replace it to continue.");
    }

    const revision = parseLibraryRevision(
      await peerJsonRequest(connection, "get", `/library/revision?audience=${row.audience}`)
    );
    assertAudience(revision.audience, row);
    // Matching revisions prove the committed items are what the peer would
    // export now (the policy revision is random, so it cannot match by luck).
    if (
      row.library_revision !== null &&
      revision.libraryRevision === row.library_revision &&
      revision.policyRevision === row.policy_revision
    ) {
      if (getDatabaseEpoch() !== epoch) throw overtaken(REPLACED);
      const now = Date.now();
      const { changes } = sqlite
        .prepare(
          `UPDATE federation_peers
             SET status = 'ok', last_error = NULL, last_attempt_at = ?, last_success_at = ?, updated_at = ?
           WHERE id = ? AND generation = ? AND enabled = 1`
        )
        .run(now, now, now, row.id, row.generation);
      // Disabled, re-credentialed, quarantined or removed meanwhile.
      if (changes === 0) throw overtaken(OVERTAKEN);
      return { peerId, status: "ok", changed: false };
    }

    const snapshot = await readSnapshot(connection, row);
    const after = parseLibraryRevision(
      await peerJsonRequest(connection, "get", `/library/revision?audience=${row.audience}`)
    );
    assertAudience(after.audience, row);
    if (after.libraryRevision !== snapshot.libraryRevision || after.policyRevision !== snapshot.policyRevision) {
      throw new PeerError("stale", "The peer library changed while it was being read.");
    }

    const counts = commit(row, epoch, snapshot.items, snapshot.libraryRevision, snapshot.policyRevision, Date.now());
    return { peerId, status: "ok", changed: true, ...counts };
  } catch (error) {
    const status = statusFor(error);
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("[Federation] Peer sync failed", { peerId, status, error: message });
    recordAttempt(row, epoch, status, message, Date.now());
    return { peerId, status, changed: false, error: message };
  }
}

/** At most one sync per peer; concurrent callers share the one in flight. */
export function syncPeer(peerId: string): Promise<SyncResult> {
  const running = inFlight.get(peerId);
  if (running) return running;
  const started = runSync(peerId).finally(() => inFlight.delete(peerId));
  inFlight.set(peerId, started);
  return started;
}
