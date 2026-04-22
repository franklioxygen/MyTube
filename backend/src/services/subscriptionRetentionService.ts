import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { subscriptions, downloadHistory } from "../db/schema";
import { logger } from "../utils/logger";
import * as storageService from "./storageService";

/**
 * Runs once per hour. For each subscription that has retentionDays set,
 * deletes any locally-stored video that was downloaded via that subscription
 * and whose addedAt/createdAt date is older than retentionDays days.
 */
export async function runSubscriptionRetentionCleanup(): Promise<void> {
  try {
    // Get all subscriptions that have retention configured
    const subsWithRetention = await db
      .select()
      .from(subscriptions)
      .where(isNotNull(subscriptions.retentionDays));

    if (subsWithRetention.length === 0) {
      return;
    }

    logger.info(
      `[RetentionCleanup] Checking ${subsWithRetention.length} subscription(s) with retention policy`
    );

    for (const sub of subsWithRetention) {
      const retentionDays = sub.retentionDays;
      if (!retentionDays || retentionDays <= 0) {
        continue;
      }

      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      // Find all successful download history entries for this subscription
      // where the video was downloaded before the cutoff
      const historyEntries = await db
        .select()
        .from(downloadHistory)
        .where(
          and(
            eq(downloadHistory.subscriptionId, sub.id),
            eq(downloadHistory.status, "success")
          )
        );

      for (const entry of historyEntries) {
        // Use finishedAt as the "downloaded at" timestamp
        const downloadedAt = entry.finishedAt;
        if (!downloadedAt || downloadedAt > cutoffMs) {
          continue;
        }

        if (!entry.videoId) {
          continue;
        }

        // Check the video still exists in the DB
        const videoRecord = storageService.getVideoById(entry.videoId);
        if (!videoRecord) {
          continue;
        }

        try {
          const deleted = storageService.deleteVideo(entry.videoId);
          if (deleted) {
            logger.info(
              `[RetentionCleanup] Deleted video "${videoRecord.title}" (id=${entry.videoId}) ` +
              `from subscription "${sub.author}" (retentionDays=${retentionDays})`
            );
          }
        } catch (err) {
          logger.error(
            `[RetentionCleanup] Failed to delete video ${entry.videoId}:`,
            err instanceof Error ? err : new Error(String(err))
          );
        }
      }
    }
  } catch (error) {
    logger.error(
      "[RetentionCleanup] Unexpected error during retention cleanup:",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
