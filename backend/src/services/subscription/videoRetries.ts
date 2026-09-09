import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { subscriptions, subscriptionVideoRetries } from "../../db/schema";

/** Persist each failed URL independently; never rewind the feed cursor. */
export function queueVideoRetry(subscriptionId: string, videoUrl: string): void {
  db.transaction((tx) => {
    const subscription = tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .get();
    if (!subscription) return;

    tx.insert(subscriptionVideoRetries)
      .values({ subscriptionId, videoUrl, createdAt: Date.now() })
      .onConflictDoNothing()
      .run();
  });
}

// Keep one subscription's backlog from occupying a check worker indefinitely.
export const VIDEO_RETRIES_PER_CHECK = 5;

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
