/**
 * Holds the downloader's raw source metadata between a suppressed sync and the
 * deferred one that follows it.
 *
 * A playlist-origin download suppresses the immediate playlist_tv sync so the
 * video is not briefly classified as an unassigned Season 00 episode - episode
 * numbering is immutable, so that mistake would be permanent. The reconcile
 * instead happens on the collection-link hook, which has no access to the
 * download's `rawSourceInfo`. Without somewhere to park it, two things are lost:
 *
 * - the episode's source JSON falls back to a synthesized envelope, so the
 *   extractor-specific fields that adjacent exports keep are dropped; and
 * - show identity resolves from the weaker persisted URL or author name, even
 *   when the extractor supplied a durable channel id. Identity is allocated
 *   once, so two channels sharing an author label merge permanently.
 *
 * Entries are consumed by the next sync for that video and are intentionally
 * process-local: on restart the next full rebuild resolves everything from
 * persisted data, which is the same guarantee the rest of the mirror relies on.
 */

interface PendingEntry {
  rawSourceInfo: unknown;
  storedAt: number;
}

const pending = new Map<string, PendingEntry>();

/** Bounds the map if a link hook never arrives (cancelled or failed download). */
const MAX_AGE_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;

function evictExpired(now: number): void {
  for (const [videoId, entry] of pending) {
    if (now - entry.storedAt > MAX_AGE_MS) {
      pending.delete(videoId);
    }
  }
  while (pending.size > MAX_ENTRIES) {
    const oldest = pending.keys().next();
    if (oldest.done) break;
    pending.delete(oldest.value);
  }
}

export function storePendingSourceInfo(
  videoId: string,
  rawSourceInfo: unknown
): void {
  if (!videoId || rawSourceInfo === undefined || rawSourceInfo === null) {
    return;
  }
  const now = Date.now();
  pending.set(videoId, { rawSourceInfo, storedAt: now });
  evictExpired(now);
}

/** Reads without consuming, for callers that may not complete the sync. */
export function peekPendingSourceInfo(videoId: string): unknown {
  return pending.get(videoId)?.rawSourceInfo;
}

/** Reads and removes: the deferred sync is the one consumer. */
export function takePendingSourceInfo(videoId: string): unknown {
  const entry = pending.get(videoId);
  if (!entry) return undefined;
  pending.delete(videoId);
  return entry.rawSourceInfo;
}

export function clearPendingSourceInfo(): void {
  pending.clear();
}
