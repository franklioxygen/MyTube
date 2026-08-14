import { eq } from "drizzle-orm";
import path from "path";
import { VIDEOS_DIR } from "../../../config/paths";
import { db, sqlite } from "../../../db";
import { videos } from "../../../db/schema";
import { AUDIO_FORMATS } from "../../../types/settings";
import { logger } from "../../../utils/logger";
import {
  pathExistsSafeSync,
  pathExistsTrustedSync,
  resolveSafeChildPath,
  statTrustedSync,
} from "../../../utils/security";
import { findVideoFile } from "../fileHelpers";

// Populate fileSize for existing videos that are missing it.
export function populateVideoFileSizes(): void {
  const allVideos = db.select().from(videos).all();
  let updatedCount = 0;
  for (const video of allVideos) {
    if (!video.fileSize) {
      let videoPath: string | null = null;

      // Check if video is in a mount directory
      if (video.videoPath?.startsWith("mount:")) {
        // Extract the actual file path (remove "mount:" prefix)
        const rawFilePath = video.videoPath.substring(6); // Remove "mount:" prefix

        // Validate path is absolute and doesn't contain traversal
        if (path.isAbsolute(rawFilePath) && !rawFilePath.includes("..") && !rawFilePath.includes("\0")) {
          const resolvedPath = path.resolve(rawFilePath);
          if (pathExistsTrustedSync(resolvedPath)) {
            videoPath = resolvedPath;
          }
        }
      } else if (video.videoPath?.startsWith("/videos/")) {
        // Prefer videoPath for template-created subdirectory paths
        const relativePath = video.videoPath.replace("/videos/", "");
        const fullPath = resolveSafeChildPath(VIDEOS_DIR, relativePath);
        if (pathExistsSafeSync(fullPath, VIDEOS_DIR)) {
          videoPath = fullPath;
        }
      } else if (video.videoFilename) {
        // Legacy fallback: use findVideoFile by basename
        videoPath = findVideoFile(video.videoFilename);
      }

      if (videoPath && pathExistsTrustedSync(videoPath)) {
        try {
          const stats = statTrustedSync(videoPath);
          // Skip 0-byte files
          if (stats.size > 0) {
            db.update(videos)
              .set({ fileSize: stats.size.toString() })
              .where(eq(videos.id, video.id))
              .run();
            updatedCount++;
          }
        } catch (error) {
          logger.warn(`Failed to get file size for video ${video.id}: ${error}`);
        }
      }
    }
  }
  if (updatedCount > 0) {
    logger.info(`Populated fileSize for ${updatedCount} videos.`);
  }
}

// Backfill video_id in download_history for existing success records.
export function backfillDownloadHistoryVideoIds(): void {
  try {
    const result = sqlite
      .prepare(
        `
            UPDATE download_history
            SET video_id = (SELECT id FROM videos WHERE videos.source_url = download_history.source_url)
            WHERE video_id IS NULL AND status = 'success' AND source_url IS NOT NULL
        `
      )
      .run();
    if (result && result.changes > 0) {
      logger.info(
        `Backfilled video_id for ${result.changes} download history items.`
      );
    }
  } catch (error) {
    logger.error(
      "Error backfilling video_id in download history",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

// Backfill media_type for legacy history rows that point at a local video.
// The column is nullable because an old row may not have a surviving video
// reference, but a referenced video gives us an authoritative answer — unlike
// treating every NULL as video, which misclassifies legacy audio tombstones.
export function backfillDownloadHistoryMediaTypes(): void {
  try {
    const result = sqlite
      .prepare(
        `
            UPDATE download_history
            SET media_type = (
              SELECT CASE WHEN v.media_type = 'audio' THEN 'audio' ELSE 'video' END
              FROM videos v
              WHERE v.id = download_history.video_id
            )
            WHERE media_type IS NULL
              AND video_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM videos v WHERE v.id = download_history.video_id
              )
        `
      )
      .run();
    if (result && result.changes > 0) {
      logger.info(
        `Backfilled media_type for ${result.changes} download history items.`
      );
    }

    // A deleted row is exactly the case the join above cannot reach: its video
    // is gone, so it stays NULL and the media-type-scoped tombstone lookup
    // never returns it. Deletion only flips status and deleted_at, so the row
    // still carries the path of the file it saved — enough to tell the two
    // apart without assuming every legacy tombstone was a video.
    const audioExtensionMatch = AUDIO_FORMATS.map(
      (format) => `lower(video_path) LIKE '%.${format}'`
    ).join(" OR ");

    const audioResult = sqlite
      .prepare(
        `
            UPDATE download_history
            SET media_type = 'audio'
            WHERE media_type IS NULL
              AND video_path IS NOT NULL
              AND (${audioExtensionMatch})
        `
      )
      .run();

    // Whatever is left with a saved file is a video: audio-only is an explicit
    // opt-in and its containers are enumerated above.
    const videoResult = sqlite
      .prepare(
        `
            UPDATE download_history
            SET media_type = 'video'
            WHERE media_type IS NULL
              AND video_path IS NOT NULL
        `
      )
      .run();

    const fromPath = (audioResult?.changes ?? 0) + (videoResult?.changes ?? 0);
    if (fromPath > 0) {
      logger.info(
        `Backfilled media_type from the saved file path for ${fromPath} download history items whose video is gone.`
      );
    }
  } catch (error) {
    logger.error(
      "Error backfilling media_type in download history",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export function backfillDownloadHistoryDimensions(): void {
  try {
    // Backfill platform from videos.source where joinable via video_id
    sqlite
      .prepare(
        `UPDATE download_history
         SET platform = (
           SELECT LOWER(v.source) FROM videos v WHERE v.id = download_history.video_id
         )
         WHERE platform IS NULL
           AND video_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM videos v WHERE v.id = download_history.video_id AND v.source IS NOT NULL)`
      )
      .run();

    // Backfill platform from video_downloads where matched on source_url
    sqlite
      .prepare(
        `UPDATE download_history
         SET platform = (
           SELECT LOWER(vd.platform) FROM video_downloads vd
           WHERE vd.source_url = download_history.source_url
           ORDER BY vd.downloaded_at DESC
           LIMIT 1
         )
         WHERE platform IS NULL
           AND source_url IS NOT NULL`
      )
      .run();

    // Heuristic by URL host for any remaining
    sqlite
      .prepare(
        `UPDATE download_history
         SET platform = CASE
           WHEN source_url LIKE '%youtube.com%' OR source_url LIKE '%youtu.be%' THEN 'youtube'
           WHEN source_url LIKE '%bilibili.com%' OR source_url LIKE '%b23.tv%' THEN 'bilibili'
           WHEN source_url LIKE '%twitch.tv%' THEN 'twitch'
           WHEN source_url LIKE '%missav%' THEN 'missav'
           ELSE platform
         END
         WHERE platform IS NULL AND source_url IS NOT NULL`
      )
      .run();

    // Backfill source_kind from subscription/task references and known patterns.
    sqlite
      .prepare(
        `UPDATE download_history
         SET source_kind = CASE
           WHEN subscription_id IS NOT NULL THEN 'subscription'
           WHEN task_id IS NOT NULL THEN 'task'
           ELSE source_kind
         END
         WHERE source_kind IS NULL`
      )
      .run();

    // Default unclassified rows to 'unknown' rather than null so SQL is uniform.
    sqlite
      .prepare(
        `UPDATE download_history SET platform = 'unknown' WHERE platform IS NULL`
      )
      .run();
    sqlite
      .prepare(
        `UPDATE download_history SET source_kind = 'unknown' WHERE source_kind IS NULL`
      )
      .run();
  } catch (error) {
    logger.warn(
      "Best-effort backfill of download_history.platform/source_kind failed",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
