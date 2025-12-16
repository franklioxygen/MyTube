import { desc, eq } from "drizzle-orm";
import fs from "fs-extra";
import path from "path";
import {
  IMAGES_DIR,
  SUBTITLES_DIR,
  UPLOADS_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import { DatabaseError, NotFoundError } from "../../errors/DownloadErrors";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { formatVideoFilename } from "../../utils/helpers";
import { logger } from "../../utils/logger";
import { findImageFile, findVideoFile } from "./fileHelpers";
import { markVideoDownloadDeleted } from "./videoDownloadTracking";

export function getVideos(): import("./types").Video[] {
  try {
    const allVideos = db
      .select()
      .from(videos)
      .orderBy(desc(videos.createdAt))
      .all();
    return allVideos.map((v) => ({
      ...v,
      tags: v.tags ? JSON.parse(v.tags) : [],
      subtitles: v.subtitles ? JSON.parse(v.subtitles) : undefined,
    })) as import("./types").Video[];
  } catch (error) {
    logger.error("Error getting videos", error instanceof Error ? error : new Error(String(error)));
    // Return empty array for backward compatibility with frontend
    return [];
  }
}

export function getVideoBySourceUrl(
  sourceUrl: string
): import("./types").Video | undefined {
  try {
    const result = db
      .select()
      .from(videos)
      .where(eq(videos.sourceUrl, sourceUrl))
      .get();

    if (result) {
      return {
        ...result,
        tags: result.tags ? JSON.parse(result.tags) : [],
        subtitles: result.subtitles ? JSON.parse(result.subtitles) : undefined,
      } as import("./types").Video;
    }
    return undefined;
  } catch (error) {
    logger.error("Error getting video by sourceUrl", error instanceof Error ? error : new Error(String(error)));
    throw new DatabaseError(
      `Failed to get video by source URL: ${sourceUrl}`,
      error instanceof Error ? error : new Error(String(error)),
      "getVideoBySourceUrl"
    );
  }
}

export function getVideoById(id: string): import("./types").Video | undefined {
  try {
    const video = db.select().from(videos).where(eq(videos.id, id)).get();
    if (video) {
      return {
        ...video,
        tags: video.tags ? JSON.parse(video.tags) : [],
        subtitles: video.subtitles ? JSON.parse(video.subtitles) : undefined,
      } as import("./types").Video;
    }
    return undefined;
  } catch (error) {
    logger.error("Error getting video by id", error instanceof Error ? error : new Error(String(error)));
    throw new DatabaseError(
      `Failed to get video by id: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "getVideoById"
    );
  }
}

/**
 * Format legacy filenames to the new standard format: Title-Author-YYYY
 */
export function formatLegacyFilenames(): {
  processed: number;
  renamed: number;
  errors: number;
  details: string[];
} {
  const results = {
    processed: 0,
    renamed: 0,
    errors: 0,
    details: [] as string[],
  };

  try {
    const allVideos = getVideos();
    logger.info(
      `Starting legacy filename formatting for ${allVideos.length} videos...`
    );

    for (const video of allVideos) {
      results.processed++;

      try {
        // Generate new filename
        const newBaseFilename = formatVideoFilename(
          video.title,
          video.author || "Unknown",
          video.date
        );

        // preserve subdirectory if it exists (e.g. for collections)
        // We rely on videoPath because videoFilename is usually just the basename
        let subdirectory = "";
        if (video.videoPath) {
          // videoPath is like "/videos/SubDir/file.mp4" or "/videos/file.mp4"
          const relPath = video.videoPath.replace(/^\/videos\//, "");
          const dir = path.dirname(relPath);
          if (dir && dir !== ".") {
            subdirectory = dir;
          }
        }

        // New filename (basename only)
        const newVideoFilename = `${newBaseFilename}.mp4`;
        const newThumbnailFilename = `${newBaseFilename}.jpg`;

        // Calculate full paths for checks
        // For the check we need to know if the resulting full path is different
        // But the check "video.videoFilename === newVideoFilename" only checks basename.
        // If basename matches, we might still want to rename if we were normalizing something else,
        // but usually if format matches, we skip.
        if (video.videoFilename === newVideoFilename) {
          continue;
        }

        logger.info(
          `Renaming video ${video.id}: ${video.videoFilename} -> ${newVideoFilename} (Subdir: ${subdirectory})`
        );

        // Paths
        // Old path must be constructed using the subdirectory derived from videoPath
        const oldVideoPath = path.join(
          VIDEOS_DIR,
          subdirectory,
          video.videoFilename || ""
        );
        const newVideoPath = path.join(
          VIDEOS_DIR,
          subdirectory,
          newVideoFilename
        );

        // Handle thumbnail subdirectory
        let thumbSubdir = "";
        if (video.thumbnailPath) {
          const relPath = video.thumbnailPath.replace(/^\/images\//, "");
          const dir = path.dirname(relPath);
          if (dir && dir !== ".") {
            thumbSubdir = dir;
          }
        }

        const oldThumbnailPath = video.thumbnailFilename
          ? path.join(IMAGES_DIR, thumbSubdir, video.thumbnailFilename)
          : null;
        const newThumbnailPath = path.join(
          IMAGES_DIR,
          thumbSubdir,
          newThumbnailFilename
        );

        // Rename video file
        if (fs.existsSync(oldVideoPath)) {
          if (fs.existsSync(newVideoPath) && oldVideoPath !== newVideoPath) {
            // Destination exists, append timestamp to avoid collision
            const uniqueSuffix = `_${Date.now()}`;
            const uniqueBase = `${newBaseFilename}${uniqueSuffix}`;

            const uniqueVideoBase = `${uniqueBase}.mp4`;
            const uniqueThumbBase = `${uniqueBase}.jpg`;

            // Full paths for rename
            const uniqueVideoPath = path.join(
              VIDEOS_DIR,
              subdirectory,
              uniqueVideoBase
            );
            const uniqueThumbPath = path.join(
              IMAGES_DIR,
              thumbSubdir,
              uniqueThumbBase
            ); // Use thumbSubdir

            logger.info(
              `Destination exists, using unique suffix: ${uniqueVideoBase}`
            );

            fs.renameSync(oldVideoPath, uniqueVideoPath);

            if (oldThumbnailPath && fs.existsSync(oldThumbnailPath)) {
              fs.renameSync(oldThumbnailPath, uniqueThumbPath);
            }

            // Handle subtitles (Keep in their original folder, assuming root or derived from path if available)
            if (video.subtitles && video.subtitles.length > 0) {
              const newSubtitles = [];
              for (const subtitle of video.subtitles) {
                // Subtitles usually in SUBTITLES_DIR root, checking...
                const oldSubPath = path.join(SUBTITLES_DIR, subtitle.filename);

                // If we ever supported subdirs for subtitles, we'd need to parse subtitle.path here too
                // For now assuming existing structure matches simple join

                if (fs.existsSync(oldSubPath)) {
                  const newSubFilename = `${uniqueBase}.${subtitle.language}.vtt`;
                  const newSubPath = path.join(SUBTITLES_DIR, newSubFilename);
                  fs.renameSync(oldSubPath, newSubPath);
                  newSubtitles.push({
                    ...subtitle,
                    filename: newSubFilename,
                    path: `/subtitles/${newSubFilename}`,
                  });
                } else {
                  newSubtitles.push(subtitle);
                }
              }
              // Update video record with unique names
              // videoFilename should be BASENAME only
              // videoPath should be FULL WEB PATH including subdir
              db.update(videos)
                .set({
                  videoFilename: uniqueVideoBase,
                  thumbnailFilename: video.thumbnailFilename
                    ? uniqueThumbBase
                    : undefined,
                  videoPath: `/videos/${
                    subdirectory ? subdirectory + "/" : ""
                  }${uniqueVideoBase}`,
                  thumbnailPath: video.thumbnailFilename
                    ? `/images/${
                        thumbSubdir ? thumbSubdir + "/" : ""
                      }${uniqueThumbBase}`
                    : null,
                  subtitles: JSON.stringify(newSubtitles),
                })
                .where(eq(videos.id, video.id))
                .run();
            } else {
              // Update video record with unique names
              db.update(videos)
                .set({
                  videoFilename: uniqueVideoBase,
                  thumbnailFilename: video.thumbnailFilename
                    ? uniqueThumbBase
                    : undefined,
                  videoPath: `/videos/${
                    subdirectory ? subdirectory + "/" : ""
                  }${uniqueVideoBase}`,
                  thumbnailPath: video.thumbnailFilename
                    ? `/images/${
                        thumbSubdir ? thumbSubdir + "/" : ""
                      }${uniqueThumbBase}`
                    : null,
                })
                .where(eq(videos.id, video.id))
                .run();
            }

            results.renamed++;
            results.details.push(`Renamed (unique): ${video.title}`);
          } else {
            // Rename normally
            fs.renameSync(oldVideoPath, newVideoPath);

            if (oldThumbnailPath && fs.existsSync(oldThumbnailPath)) {
              // Check if new thumbnail path exists (it shouldn't if specific to this video, but safety check)
              if (
                fs.existsSync(newThumbnailPath) &&
                oldThumbnailPath !== newThumbnailPath
              ) {
                fs.unlinkSync(newThumbnailPath);
              }
              fs.renameSync(oldThumbnailPath, newThumbnailPath);
            }

            // Handle subtitles
            const updatedSubtitles = [];
            if (video.subtitles && video.subtitles.length > 0) {
              for (const subtitle of video.subtitles) {
                const oldSubPath = path.join(SUBTITLES_DIR, subtitle.filename);
                if (fs.existsSync(oldSubPath)) {
                  // Keep subtitles in their current location (usually root SUBTITLES_DIR)
                  const newSubFilename = `${newBaseFilename}.${subtitle.language}.vtt`;
                  const newSubPath = path.join(SUBTITLES_DIR, newSubFilename);

                  // Remove dest if exists
                  if (fs.existsSync(newSubPath)) fs.unlinkSync(newSubPath);

                  fs.renameSync(oldSubPath, newSubPath);
                  updatedSubtitles.push({
                    ...subtitle,
                    filename: newSubFilename,
                    path: `/subtitles/${newSubFilename}`,
                  });
                } else {
                  updatedSubtitles.push(subtitle);
                }
              }
            }

            // Update DB
            db.update(videos)
              .set({
                videoFilename: newVideoFilename,
                thumbnailFilename: video.thumbnailFilename
                  ? newThumbnailFilename
                  : undefined,
                videoPath: `/videos/${
                  subdirectory ? subdirectory + "/" : ""
                }${newVideoFilename}`,
                thumbnailPath: video.thumbnailFilename
                  ? `/images/${
                      thumbSubdir ? thumbSubdir + "/" : ""
                    }${newThumbnailFilename}`
                  : null,
                subtitles:
                  updatedSubtitles.length > 0
                    ? JSON.stringify(updatedSubtitles)
                    : video.subtitles
                    ? JSON.stringify(video.subtitles)
                    : undefined,
              })
              .where(eq(videos.id, video.id))
              .run();

            results.renamed++;
          }
        } else {
          results.details.push(`Skipped (file missing): ${video.title}`);
          // results.errors++; // Not necessarily an error, maybe just missing file
        }
      } catch (err: any) {
        logger.error(`Error renaming video ${video.id}`, err instanceof Error ? err : new Error(String(err)));
        results.errors++;
        results.details.push(`Error: ${video.title} - ${err.message}`);
      }
    }

    return results;
  } catch (error: any) {
    logger.error("Error in formatLegacyFilenames", error instanceof Error ? error : new Error(String(error)));
    throw new DatabaseError(
      "Failed to format legacy filenames",
      error instanceof Error ? error : new Error(String(error)),
      "formatLegacyFilenames"
    );
  }
}

export function saveVideo(
  videoData: import("./types").Video
): import("./types").Video {
  try {
    const videoToSave = {
      ...videoData,
      tags: videoData.tags ? JSON.stringify(videoData.tags) : undefined,
      subtitles: videoData.subtitles
        ? JSON.stringify(videoData.subtitles)
        : undefined,
    };
    db.insert(videos)
      .values(videoToSave as any)
      .onConflictDoUpdate({
        target: videos.id,
        set: videoToSave,
      })
      .run();
    return videoData;
  } catch (error) {
    logger.error("Error saving video", error instanceof Error ? error : new Error(String(error)));
    throw new DatabaseError(
      `Failed to save video: ${videoData.id}`,
      error instanceof Error ? error : new Error(String(error)),
      "saveVideo"
    );
  }
}

export function updateVideo(
  id: string,
  updates: Partial<import("./types").Video>
): import("./types").Video | null {
  try {
    const updatesToSave = {
      ...updates,
      // Only include tags/subtitles if they are explicitly in the updates object
      ...(updates.tags !== undefined
        ? { tags: updates.tags ? JSON.stringify(updates.tags) : undefined }
        : {}),
      ...(updates.subtitles !== undefined
        ? {
            subtitles: updates.subtitles
              ? JSON.stringify(updates.subtitles)
              : undefined,
          }
        : {}),
    };
    // If tags is explicitly empty array, we might want to save it as '[]' or null.
    // JSON.stringify([]) is '[]', which is fine.

    const result = db
      .update(videos)
      .set(updatesToSave as any)
      .where(eq(videos.id, id))
      .returning()
      .get();

    if (result) {
      return {
        ...result,
        tags: result.tags ? JSON.parse(result.tags) : [],
        subtitles: result.subtitles ? JSON.parse(result.subtitles) : undefined,
      } as import("./types").Video;
    }
    return null;
  } catch (error) {
    logger.error("Error updating video", error instanceof Error ? error : new Error(String(error)));
    throw new DatabaseError(
      `Failed to update video: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "updateVideo"
    );
  }
}

export function deleteVideo(id: string): boolean {
  try {
    const videoToDelete = getVideoById(id);
    if (!videoToDelete) return false;

    // Lazy import to avoid circular dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCollections } = require("./collections");
    const allCollections = getCollections();

    // Remove video file
    if (videoToDelete.videoFilename) {
      const actualPath = findVideoFile(
        videoToDelete.videoFilename,
        allCollections
      );
      if (actualPath && fs.existsSync(actualPath)) {
        fs.unlinkSync(actualPath);
      }
    }

    // Remove thumbnail file
    if (videoToDelete.thumbnailFilename) {
      const actualPath = findImageFile(
        videoToDelete.thumbnailFilename,
        allCollections
      );
      if (actualPath && fs.existsSync(actualPath)) {
        fs.unlinkSync(actualPath);
      }
    }

    // Remove subtitle files
    if (videoToDelete.subtitles && videoToDelete.subtitles.length > 0) {
      for (const subtitle of videoToDelete.subtitles) {
        let subtitlePath: string | null = null;

        // Determine the actual file path based on subtitle.path
        if (subtitle.path) {
          if (subtitle.path.startsWith("/videos/")) {
            // Subtitle is stored alongside video file
            subtitlePath = path.join(
              VIDEOS_DIR,
              subtitle.path.replace(/^\/videos\//, "")
            );
          } else if (subtitle.path.startsWith("/subtitles/")) {
            // Subtitle is in subtitles directory (may be in collection subdirectory)
            subtitlePath = path.join(
              UPLOADS_DIR,
              subtitle.path.replace(/^\//, "")
            );
          }
        }

        // Fallback: try to find by filename if path-based lookup fails
        if (!subtitlePath || !fs.existsSync(subtitlePath)) {
          // Try root subtitles directory
          subtitlePath = path.join(SUBTITLES_DIR, subtitle.filename);
          if (!fs.existsSync(subtitlePath)) {
            // Try alongside video file
            if (videoToDelete.videoFilename) {
              const videoPath = findVideoFile(
                videoToDelete.videoFilename,
                allCollections
              );
              if (videoPath) {
                const videoDir = path.dirname(videoPath);
                subtitlePath = path.join(videoDir, subtitle.filename);
              }
            }
          }
        }

        // Delete the subtitle file if it exists
        if (subtitlePath && fs.existsSync(subtitlePath)) {
          try {
            fs.unlinkSync(subtitlePath);
            logger.info(`Deleted subtitle file: ${subtitlePath}`);
          } catch (error) {
            logger.error(
              `Error deleting subtitle file ${subtitlePath}`,
              error instanceof Error ? error : new Error(String(error))
            );
          }
        }
      }
    }

    // Mark video as deleted in download history
    markVideoDownloadDeleted(id);

    // Delete from DB
    db.delete(videos).where(eq(videos.id, id)).run();
    return true;
  } catch (error) {
    logger.error("Error deleting video", error instanceof Error ? error : new Error(String(error)));
    throw new DatabaseError(
      `Failed to delete video: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "deleteVideo"
    );
  }
}
