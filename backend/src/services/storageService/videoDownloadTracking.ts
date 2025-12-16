import { eq } from "drizzle-orm";
import { DatabaseError } from "../../errors/DownloadErrors";
import { db } from "../../db";
import { videoDownloads } from "../../db/schema";
import { logger } from "../../utils/logger";
import { VideoDownloadCheckResult } from "./types";

/**
 * Check if a video has been downloaded before by its source video ID
 */
export function checkVideoDownloadBySourceId(
  sourceVideoId: string
): VideoDownloadCheckResult {
  try {
    const record = db
      .select()
      .from(videoDownloads)
      .where(eq(videoDownloads.sourceVideoId, sourceVideoId))
      .get();

    if (record) {
      return {
        found: true,
        status: record.status as "exists" | "deleted",
        videoId: record.videoId || undefined,
        title: record.title || undefined,
        author: record.author || undefined,
        downloadedAt: record.downloadedAt,
        deletedAt: record.deletedAt || undefined,
      };
    }

    return { found: false };
  } catch (error) {
    logger.error("Error checking video download by source ID", error instanceof Error ? error : new Error(String(error)));
    // Return not found on error for graceful degradation
    return { found: false };
  }
}

/**
 * Check if a video has been downloaded before by its source URL
 */
export function checkVideoDownloadByUrl(
  sourceUrl: string
): VideoDownloadCheckResult {
  try {
    const record = db
      .select()
      .from(videoDownloads)
      .where(eq(videoDownloads.sourceUrl, sourceUrl))
      .get();

    if (record) {
      return {
        found: true,
        status: record.status as "exists" | "deleted",
        videoId: record.videoId || undefined,
        title: record.title || undefined,
        author: record.author || undefined,
        downloadedAt: record.downloadedAt,
        deletedAt: record.deletedAt || undefined,
      };
    }

    return { found: false };
  } catch (error) {
    logger.error("Error checking video download by URL", error instanceof Error ? error : new Error(String(error)));
    // Return not found on error for graceful degradation
    return { found: false };
  }
}

/**
 * Record a new video download
 */
export function recordVideoDownload(
  sourceVideoId: string,
  sourceUrl: string,
  platform: string,
  videoId: string,
  title?: string,
  author?: string
): void {
  try {
    const id = `${platform}-${sourceVideoId}-${Date.now()}`;
    db.insert(videoDownloads)
      .values({
        id,
        sourceVideoId,
        sourceUrl,
        platform,
        videoId,
        title,
        author,
        status: "exists",
        downloadedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: videoDownloads.id,
        set: {
          videoId,
          title,
          author,
          status: "exists",
          deletedAt: null,
        },
      })
      .run();
    logger.info(
      `Recorded video download: ${title || sourceVideoId} (${platform})`
    );
  } catch (error) {
    logger.error("Error recording video download", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download tracking is non-critical
  }
}

/**
 * Mark a video as deleted in the download history
 */
export function markVideoDownloadDeleted(videoId: string): void {
  try {
    db.update(videoDownloads)
      .set({
        status: "deleted",
        deletedAt: Date.now(),
        videoId: null,
      })
      .where(eq(videoDownloads.videoId, videoId))
      .run();
    logger.info(`Marked video download as deleted: ${videoId}`);
  } catch (error) {
    logger.error("Error marking video download as deleted", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download tracking is non-critical
  }
}

/**
 * Update video download record when re-downloading a previously deleted video
 */
export function updateVideoDownloadRecord(
  sourceVideoId: string,
  newVideoId: string,
  title?: string,
  author?: string
): void {
  try {
    db.update(videoDownloads)
      .set({
        videoId: newVideoId,
        title,
        author,
        status: "exists",
        deletedAt: null,
      })
      .where(eq(videoDownloads.sourceVideoId, sourceVideoId))
      .run();
    logger.info(`Updated video download record: ${title || sourceVideoId}`);
  } catch (error) {
    logger.error("Error updating video download record", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download tracking is non-critical
  }
}

