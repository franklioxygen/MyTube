import type Database from "better-sqlite3";
import { videoIdentity } from "../utils/videoIdentity";

/** Upgrade retry rows from earlier releases while preserving their URL and position. */
export function backfillSubscriptionRetryIdentity(sqlite: Database.Database): void {
  const rows = sqlite.prepare(
    "SELECT subscription_id, video_url FROM subscription_video_retries WHERE video_key IS NULL"
  ).all() as Array<{ subscription_id: string; video_url: string }>;
  if (rows.length === 0) return;
  const update = sqlite.prepare(
    "UPDATE subscription_video_retries SET video_key = ? WHERE subscription_id = ? AND video_url = ?"
  );
  sqlite.transaction(() => {
    for (const row of rows) {
      update.run(videoIdentity(row.video_url), row.subscription_id, row.video_url);
    }
  })();
}
