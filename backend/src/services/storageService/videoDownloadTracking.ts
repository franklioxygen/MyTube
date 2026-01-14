import { eq } from "drizzle-orm";
import { db } from "../../db";
import { videoDownloads } from "../../db/schema";
import { logger } from "../../utils/logger";
import { DownloadHistoryItem, Video, VideoDownloadCheckResult } from "./types";

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
    logger.error(
      "Error checking video download by source ID",
      error instanceof Error ? error : new Error(String(error))
    );
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
    logger.error(
      "Error checking video download by URL",
      error instanceof Error ? error : new Error(String(error))
    );
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
    logger.error(
      "Error recording video download",
      error instanceof Error ? error : new Error(String(error))
    );
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
    logger.error(
      "Error marking video download as deleted",
      error instanceof Error ? error : new Error(String(error))
    );
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
    logger.error(
      "Error updating video download record",
      error instanceof Error ? error : new Error(String(error))
    );
    // Don't throw - download tracking is non-critical
  }
}

/**
 * Verify if a video still exists in the database and update download record if needed
 * This consolidates the common pattern of checking video existence and handling deleted videos
 *
 * @param downloadCheck - Result from checkVideoDownloadBySourceId or checkVideoDownloadByUrl
 * @param getVideoById - Function to get video by ID from storage service
 * @returns Object with verification result and updated check if video was deleted
 */
export function verifyVideoExists(
  downloadCheck: VideoDownloadCheckResult,
  getVideoById: (videoId: string) => Video | undefined
): {
  exists: boolean;
  video?: Video;
  updatedCheck?: VideoDownloadCheckResult;
} {
  // If not found, nothing to verify
  if (!downloadCheck.found) {
    return { exists: false };
  }

  // If status is "exists" and we have a videoId, verify it still exists
  if (downloadCheck.status === "exists" && downloadCheck.videoId) {
    const existingVideo = getVideoById(downloadCheck.videoId);

    if (!existingVideo) {
      // Video was deleted but not marked in download history, update it
      markVideoDownloadDeleted(downloadCheck.videoId);

      // Return updated check result
      return {
        exists: false,
        updatedCheck: {
          ...downloadCheck,
          status: "deleted",
          videoId: undefined,
          deletedAt: Date.now(),
        },
      };
    }

    // Video exists
    return {
      exists: true,
      video: existingVideo,
    };
  }

  // Status is "deleted" or no videoId
  return {
    exists: false,
  };
}

/**
 * Handle video download check result and determine appropriate action
 * This consolidates the logic for handling download checks in controllers
 *
 * @param downloadCheck - Result from checkVideoDownloadBySourceId
 * @param sourceUrl - Source URL of the video
 * @param getVideoById - Function to get video by ID from storage service
 * @param addDownloadHistoryItem - Function to add item to download history
 * @param forceDownload - Whether to force download even if video was deleted
 * @param dontSkipDeletedVideo - Whether to automatically re-download deleted videos (from settings)
 * @returns Object indicating whether to skip download and response data if applicable
 */
export function handleVideoDownloadCheck(
  downloadCheck: VideoDownloadCheckResult,
  sourceUrl: string,
  getVideoById: (videoId: string) => Video | undefined,
  addDownloadHistoryItem: (item: DownloadHistoryItem) => void,
  forceDownload: boolean = false,
  dontSkipDeletedVideo: boolean = false
): {
  shouldSkip: boolean;
  shouldForce: boolean;
  response?: {
    success: boolean;
    skipped?: boolean;
    videoId?: string;
    title?: string;
    author?: string;
    videoPath?: string;
    thumbnailPath?: string;
    message?: string;
    previouslyDeleted?: boolean;
    downloadedAt?: number;
    deletedAt?: number;
  };
} {
  // If not found, proceed with download
  if (!downloadCheck.found) {
    return { shouldSkip: false, shouldForce: false };
  }

  // Verify video exists if status is "exists"
  if (downloadCheck.status === "exists" && downloadCheck.videoId) {
    const verification = verifyVideoExists(downloadCheck, getVideoById);

    if (verification.exists && verification.video) {
      // Video exists, add to download history as "skipped" and return success
      addDownloadHistoryItem({
        id: Date.now().toString(),
        title: downloadCheck.title || verification.video.title,
        author: downloadCheck.author || verification.video.author,
        sourceUrl,
        finishedAt: Date.now(),
        status: "skipped",
        videoPath: verification.video.videoPath,
        thumbnailPath: verification.video.thumbnailPath,
        videoId: verification.video.id,
      });

      return {
        shouldSkip: true,
        shouldForce: false,
        response: {
          success: true,
          skipped: true,
          videoId: downloadCheck.videoId,
          title: downloadCheck.title || verification.video.title,
          author: downloadCheck.author || verification.video.author,
          videoPath: verification.video.videoPath,
          thumbnailPath: verification.video.thumbnailPath,
          message: "Video already exists, skipped download",
        },
      };
    }

    // Video was deleted but not marked, update the record
    if (verification.updatedCheck) {
      // Record was updated, continue with download check
    }
  }

  // If status is "deleted" and not forcing download (and setting is off), skip
  // If dontSkipDeletedVideo is true, treat it as forceDownload for deleted videos
  const shouldForceDownload = forceDownload || (dontSkipDeletedVideo && downloadCheck.status === "deleted");
  if (downloadCheck.status === "deleted" && !shouldForceDownload) {
    // Video was previously downloaded but deleted - add to history and skip
    addDownloadHistoryItem({
      id: Date.now().toString(),
      title: downloadCheck.title || "Unknown Title",
      author: downloadCheck.author,
      sourceUrl,
      finishedAt: Date.now(),
      status: "deleted",
      downloadedAt: downloadCheck.downloadedAt,
      deletedAt: downloadCheck.deletedAt,
    });

    return {
      shouldSkip: true,
      shouldForce: false,
      response: {
        success: true,
        skipped: true,
        // clearly indicate it was deleted so frontend shows correct message
        previouslyDeleted: true,
        title: downloadCheck.title,
        author: downloadCheck.author,
        downloadedAt: downloadCheck.downloadedAt,
        deletedAt: downloadCheck.deletedAt,
        message:
          "Video was previously downloaded but deleted. Use force download to re-download.",
      },
    };
  }

  // If forcing download or status is "deleted" with forceDownload=true or dontSkipDeletedVideo=true, proceed
  if (downloadCheck.status === "deleted" && shouldForceDownload) {
    return { shouldSkip: false, shouldForce: true };
  }

  // Default: proceed with download
  return { shouldSkip: false, shouldForce: false };
}
