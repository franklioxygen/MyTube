import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { subscriptions, subscriptionVideoRetries } from "../../db/schema";

/** Persist each failed URL independently; never rewind the feed cursor. */
export function queueVideoRetry(
  subscriptionId: string,
  videoUrl: string,
  mediaPlaylistIndex?: number
): void {
  db.transaction((tx) => {
    const subscription = tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .get();
    if (!subscription) return;

    tx.insert(subscriptionVideoRetries)
      .values({
        subscriptionId,
        videoUrl,
        createdAt: Date.now(),
        mediaPlaylistIndex: mediaPlaylistIndex ?? null,
      })
      // First queueing wins, so a row keeps the backfill position it was
      // created with rather than losing it to a later index-less retry.
      .onConflictDoNothing()
      .run();
  });
}

// Keep one subscription's backlog from occupying a check worker indefinitely.
export const VIDEO_RETRIES_PER_CHECK = 5;

/** Read a feed head's retry metadata even when it falls outside the batch. */
export function getVideoRetry(subscriptionId: string, videoUrl: string) {
  return db
    .select()
    .from(subscriptionVideoRetries)
    .where(
      and(
        eq(subscriptionVideoRetries.subscriptionId, subscriptionId),
        eq(subscriptionVideoRetries.videoUrl, videoUrl)
      )
    )
    .get();
}

/** Return the oldest attempts first, with a bounded amount of work per check. */
export function listVideoRetries(subscriptionId: string) {
  return db
    .select()
    .from(subscriptionVideoRetries)
    .where(eq(subscriptionVideoRetries.subscriptionId, subscriptionId))
    .orderBy(
      subscriptionVideoRetries.lastAttemptAt,
      subscriptionVideoRetries.createdAt,
      subscriptionVideoRetries.videoUrl
    )
    .limit(VIDEO_RETRIES_PER_CHECK)
    .all();
}

/** Remove only the target that has finished processing for this subscription. */
export function removeVideoRetry(subscriptionId: string, videoUrl: string): void {
  db.delete(subscriptionVideoRetries)
    .where(
      and(
        eq(subscriptionVideoRetries.subscriptionId, subscriptionId),
        eq(subscriptionVideoRetries.videoUrl, videoUrl)
      )
    )
    .run();
}

/** Move an attempted target behind unattempted and older failed targets. */
export function markVideoRetryAttempted(
  subscriptionId: string,
  videoUrl: string
): void {
  db.update(subscriptionVideoRetries)
    .set({ lastAttemptAt: Date.now() })
    .where(
      and(
        eq(subscriptionVideoRetries.subscriptionId, subscriptionId),
        eq(subscriptionVideoRetries.videoUrl, videoUrl)
      )
    )
    .run();
}
