import crypto from "crypto";
import { sqlite } from "../../db";
import { logger } from "../../utils/logger";
import type { PeerStatus } from "./peerService";
import { syncPeer, type SyncResult } from "./peerSync";

/**
 * Background synchronization of enabled peers (design §6.1).
 *
 * Each peer is synced about once a minute while healthy. Failures back off
 * exponentially, with jitter, up to 15 minutes, so a dead peer costs little
 * and cannot starve the others; at most two syncs run at once. Peers that
 * need the owner (another identity, or a lost key) are left alone until the
 * owner acts, which resets them to `pending`.
 */

export const SYNC_INTERVAL_MS = 60_000;
export const MAX_BACKOFF_MS = 15 * 60_000;
export const MAX_CONCURRENT_SYNCS = 2;
const TICK_MS = 15_000;
const JITTER_MS = 5_000;

const NEEDS_OWNER: readonly PeerStatus[] = ["identity_mismatch", "credential_missing"];

const nextDue = new Map<string, number>();
const failures = new Map<string, number>();
const running = new Set<string>();
let timer: NodeJS.Timeout | null = null;

const jitter = (): number => crypto.randomInt(JITTER_MS);

export const backoffFor = (failureCount: number): number =>
  Math.min(SYNC_INTERVAL_MS * 2 ** failureCount, MAX_BACKOFF_MS);

function schedule(result: SyncResult, now: number): void {
  if (result.status === "ok") {
    failures.delete(result.peerId);
    nextDue.set(result.peerId, now + SYNC_INTERVAL_MS + jitter());
    return;
  }
  const count = (failures.get(result.peerId) ?? 0) + 1;
  failures.set(result.peerId, count);
  nextDue.set(result.peerId, now + backoffFor(count) + jitter());
}

/** One scheduling pass; exported so tests can drive it without timers. */
export async function runSyncSchedulerTick(now = Date.now()): Promise<void> {
  const peers = sqlite
    .prepare("SELECT id, status FROM federation_peers WHERE enabled = 1 ORDER BY id")
    .all() as Array<{ id: string; status: PeerStatus }>;
  const known = new Set(peers.map((peer) => peer.id));
  for (const id of [...nextDue.keys()]) {
    if (!known.has(id)) {
      nextDue.delete(id);
      failures.delete(id);
    }
  }

  const due = peers.filter(
    (peer) =>
      !NEEDS_OWNER.includes(peer.status) &&
      !running.has(peer.id) &&
      // A peer the owner just registered, re-enabled or re-credentialed is
      // pending: sync it now rather than after its old backoff.
      (peer.status === "pending" || (nextDue.get(peer.id) ?? 0) <= now)
  );

  const slots = Math.max(0, MAX_CONCURRENT_SYNCS - running.size);
  await Promise.all(
    due.slice(0, slots).map(async (peer) => {
      running.add(peer.id);
      try {
        // Timed from when this pass started the sync.
        schedule(await syncPeer(peer.id), now);
      } catch (error) {
        logger.warn("[Federation] Scheduled sync failed", {
          peerId: peer.id,
          error: error instanceof Error ? error.message : String(error),
        });
        schedule({ peerId: peer.id, status: "error", changed: false }, now);
      } finally {
        running.delete(peer.id);
      }
    })
  );
}

export function startFederationSyncScheduler(): void {
  if (timer) return;
  const tick = () => {
    void runSyncSchedulerTick().catch((error) =>
      logger.warn("[Federation] Sync scheduler tick failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    );
  };
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  setTimeout(tick, 5_000).unref?.();
}

/** Test hook. */
export function resetSyncSchedulerForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  nextDue.clear();
  failures.clear();
  running.clear();
}
