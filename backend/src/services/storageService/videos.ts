import { and, desc, eq } from "drizzle-orm";
import path from "path";
import {
    AVATARS_DIR,
    IMAGES_DIR,
    SUBTITLES_DIR,
    UPLOADS_DIR,
    VIDEOS_DIR,
} from "../../config/paths";
import { db } from "../../db";
import { downloadHistory, videos } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { formatVideoFilename } from "../../utils/helpers";
import { logger } from "../../utils/logger";
import { getCollections } from "./collections";
import {
  buildStoragePath,
  findImageFile,
  findVideoFile,
  pathExists,
  removeFileIfExists,
  renamePath,
} from "./fileHelpers";
import { markVideoDownloadDeleted } from "./videoDownloadTracking";
import {
  deleteSmallThumbnailMirrorSync,
  moveSmallThumbnailMirrorSync,
  resolveManagedThumbnailWebPathFromAbsolutePath,
} from "../thumbnailMirrorService";

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
    logger.error(
      "Error getting videos",
      error instanceof Error ? error : new Error(String(error))
    );
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
    logger.error(
      "Error getting video by sourceUrl",
      error instanceof Error ? error : new Error(String(error))
    );
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
    logger.error(
      "Error getting video by id",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to get video by id: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "getVideoById"
    );
  }
}

/**
 * Check if a video part already exists by sourceUrl
 * Returns the existing video if found, undefined otherwise
 */
export function getVideoPartBySourceUrl(
  sourceUrl: string
): import("./types").Video | undefined {
  return getVideoBySourceUrl(sourceUrl);
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
        const oldVideoPath = buildStoragePath(
          VIDEOS_DIR,
          subdirectory,
          video.videoFilename || ""
        );
        const newVideoPath = buildStoragePath(
          VIDEOS_DIR,
          subdirectory,
          newVideoFilename
        );

        // Handle thumbnail subdirectory
        let thumbSubdir = "";
        let thumbnailBaseDir = IMAGES_DIR;
        let thumbnailPathPrefix = "/images";
        if (video.thumbnailPath) {
          const relPath = video.thumbnailPath
            .replace(/^\/images\//, "")
            .replace(/^\/videos\//, "");
          const dir = path.dirname(relPath);
          if (dir && dir !== ".") {
            thumbSubdir = dir;
          }

          if (video.thumbnailPath.startsWith("/videos/")) {
            thumbnailBaseDir = VIDEOS_DIR;
            thumbnailPathPrefix = "/videos";
          }
        }

        const oldThumbnailPath = video.thumbnailFilename
          ? buildStoragePath(
              thumbnailBaseDir,
              thumbSubdir,
              video.thumbnailFilename,
            )
          : null;
        const newThumbnailPath = buildStoragePath(
          thumbnailBaseDir,
          thumbSubdir,
          newThumbnailFilename
        );

        // Rename video file
        if (pathExists(oldVideoPath)) {
          if (pathExists(newVideoPath) && oldVideoPath !== newVideoPath) {
            // Destination exists, append timestamp to avoid collision
            const uniqueSuffix = `_${Date.now()}`;
            const uniqueBase = `${newBaseFilename}${uniqueSuffix}`;

            const uniqueVideoBase = `${uniqueBase}.mp4`;
            const uniqueThumbBase = `${uniqueBase}.jpg`;

            // Full paths for rename
            const uniqueVideoPath = buildStoragePath(
              VIDEOS_DIR,
              subdirectory,
              uniqueVideoBase
            );
            const uniqueThumbPath = buildStoragePath(
              thumbnailBaseDir,
              thumbSubdir,
              uniqueThumbBase
            ); // Use thumbSubdir

            logger.info(
              `Destination exists, using unique suffix: ${uniqueVideoBase}`
            );

            renamePath(oldVideoPath, uniqueVideoPath);

            if (oldThumbnailPath && pathExists(oldThumbnailPath)) {
              renamePath(oldThumbnailPath, uniqueThumbPath);
              moveSmallThumbnailMirrorSync(
                video.thumbnailPath,
                `${thumbnailPathPrefix}/${
                  thumbSubdir ? thumbSubdir + "/" : ""
                }${uniqueThumbBase}`,
              );
            }

            // Handle subtitles (Keep in their original folder, assuming root or derived from path if available)
            if (video.subtitles && video.subtitles.length > 0) {
              const newSubtitles = [];
              for (const subtitle of video.subtitles) {
                // Subtitles usually in SUBTITLES_DIR root, checking...
                const oldSubPath = buildStoragePath(
                  SUBTITLES_DIR,
                  subtitle.filename,
                );

                // If we ever supported subdirs for subtitles, we'd need to parse subtitle.path here too
                // For now assuming existing structure matches simple join

                if (pathExists(oldSubPath)) {
                  const newSubFilename = `${uniqueBase}.${subtitle.language}.vtt`;
                  const newSubPath = buildStoragePath(
                    SUBTITLES_DIR,
                    newSubFilename,
                  );
                  renamePath(oldSubPath, newSubPath);
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
                    ? `${thumbnailPathPrefix}/${
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
                    ? `${thumbnailPathPrefix}/${
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
            renamePath(oldVideoPath, newVideoPath);

            if (oldThumbnailPath && pathExists(oldThumbnailPath)) {
              // Check if new thumbnail path exists (it shouldn't if specific to this video, but safety check)
              if (pathExists(newThumbnailPath) && oldThumbnailPath !== newThumbnailPath) {
                removeFileIfExists(newThumbnailPath);
              }
              renamePath(oldThumbnailPath, newThumbnailPath);
              moveSmallThumbnailMirrorSync(
                video.thumbnailPath,
                `${thumbnailPathPrefix}/${
                  thumbSubdir ? thumbSubdir + "/" : ""
                }${newThumbnailFilename}`,
              );
            }

            // Handle subtitles
            const updatedSubtitles = [];
            if (video.subtitles && video.subtitles.length > 0) {
              for (const subtitle of video.subtitles) {
                const oldSubPath = buildStoragePath(
                  SUBTITLES_DIR,
                  subtitle.filename,
                );
                if (pathExists(oldSubPath)) {
                  // Keep subtitles in their current location (usually root SUBTITLES_DIR)
                  const newSubFilename = `${newBaseFilename}.${subtitle.language}.vtt`;
                  const newSubPath = buildStoragePath(
                    SUBTITLES_DIR,
                    newSubFilename,
                  );

                  // Remove dest if exists
                  removeFileIfExists(newSubPath);

                  renamePath(oldSubPath, newSubPath);
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
                  ? `${thumbnailPathPrefix}/${
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
        logger.error(
          `Error renaming video ${video.id}`,
          err instanceof Error ? err : new Error(String(err))
        );
        results.errors++;
        results.details.push(`Error: ${video.title} - ${err.message}`);
      }
    }

    return results;
  } catch (error: any) {
    logger.error(
      "Error in formatLegacyFilenames",
      error instanceof Error ? error : new Error(String(error))
    );
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
    logger.error(
      "Error saving video",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to save video: ${videoData.id}`,
      error instanceof Error ? error : new Error(String(error)),
      "saveVideo"
    );
  }
}

export function saveVideoIfAbsent(
  videoData: import("./types").Video
): boolean {
  try {
    const videoToSave = {
      ...videoData,
      tags: videoData.tags ? JSON.stringify(videoData.tags) : undefined,
      subtitles: videoData.subtitles
        ? JSON.stringify(videoData.subtitles)
        : undefined,
    };

    const result = db
      .insert(videos)
      .values(videoToSave as any)
      .onConflictDoNothing({
        target: videos.id,
      })
      .run();

    return result.changes > 0;
  } catch (error) {
    logger.error(
      "Error saving video if absent",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to save video if absent: ${videoData.id}`,
      error instanceof Error ? error : new Error(String(error)),
      "saveVideoIfAbsent"
    );
  }
}

export function updateVideo(
  id: string,
  updates: Partial<import("./types").Video>
): import("./types").Video | null {
  try {
    const updatesToSave: Record<string, unknown> = {
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

    // Keep thumbnailUrl aligned when callers only update thumbnailPath
    if (
      Object.prototype.hasOwnProperty.call(updates, "thumbnailPath") &&
      !Object.prototype.hasOwnProperty.call(updates, "thumbnailUrl")
    ) {
      updatesToSave.thumbnailUrl = updates.thumbnailPath ?? null;
    }

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
    logger.error(
      "Error updating video",
      error instanceof Error ? error : new Error(String(error))
    );
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

    const allCollections = getCollections();

    // Remove video file
    deleteVideoFile(videoToDelete, allCollections);

    // Remove thumbnail file
    deleteThumbnailFile(videoToDelete, allCollections);

    // Remove author avatar file only if this is the last video from this author
    deleteAuthorAvatarIfNeeded(videoToDelete, id);

    // Remove subtitle files
    deleteSubtitleFiles(videoToDelete, allCollections);

    // Mark video as deleted in download history
    markVideoDownloadDeleted(id);

    // Mark any download history entries for this video as deleted
    db.update(downloadHistory)
      .set({ status: "deleted", deletedAt: Date.now() })
      .where(and(eq(downloadHistory.videoId, id), eq(downloadHistory.status, "success")))
      .run();

    // Delete from DB
    db.delete(videos).where(eq(videos.id, id)).run();
    return true;
  } catch (error) {
    logger.error(
      "Error deleting video",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to delete video: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "deleteVideo"
    );
  }
}

function isLocalManagedVideo(
  video: import("./types").Video
): boolean {
  return !video.videoPath || video.videoPath.startsWith("/videos/");
}

export function isThumbnailReferencedByOtherVideo(
  video: import("./types").Video,
  exceptionId: string
): boolean {
  if (!video.thumbnailFilename && !video.thumbnailPath) {
    return false;
  }

  const allVideos = getVideos();

  return allVideos.some((candidate) => {
    if (candidate.id === exceptionId) {
      return false;
    }

    if (video.thumbnailPath && candidate.thumbnailPath === video.thumbnailPath) {
      return true;
    }

    return Boolean(
      video.thumbnailFilename &&
        candidate.thumbnailFilename === video.thumbnailFilename &&
        (!video.thumbnailPath ||
          !candidate.thumbnailPath ||
          candidate.thumbnailPath === video.thumbnailPath)
    );
  });
}

function deleteVideoFile(
  video: import("./types").Video,
  allCollections: import("./types").Collection[]
): void {
  if (!isLocalManagedVideo(video)) {
    return;
  }

  if (video.videoFilename) {
    const actualPath = findVideoFile(video.videoFilename, allCollections);
    if (actualPath && pathExists(actualPath)) {
      removeFileIfExists(actualPath);
    }
  }
}

function deleteThumbnailFile(
  video: import("./types").Video,
  allCollections: import("./types").Collection[]
): void {
  if (video.thumbnailFilename) {
    const canUseLocalFallbacks = isLocalManagedVideo(video);
    let thumbnailPath: string | null = null;

    // Determine the actual file path based on thumbnailPath
    if (video.thumbnailPath) {
      if (video.thumbnailPath.startsWith("/videos/")) {
        // Thumbnail is stored alongside video file
        thumbnailPath = buildStoragePath(
          VIDEOS_DIR,
          video.thumbnailPath.replace(/^\/videos\//, "")
        );
      } else if (video.thumbnailPath.startsWith("/images/")) {
        // Thumbnail is in images directory (may be in collection subdirectory)
        thumbnailPath = buildStoragePath(
          UPLOADS_DIR,
          video.thumbnailPath.replace(/^\//, "")
        );
      }
    }

    // Fallback: try to find by filename if path-based lookup fails
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (
      canUseLocalFallbacks &&
      (!thumbnailPath || !pathExists(thumbnailPath))
    ) {
      // Try alongside video file (when moveThumbnailsToVideoFolder is enabled)
      if (video.videoFilename) {
        const videoPath = findVideoFile(video.videoFilename, allCollections);
        if (videoPath) {
          const videoDir = path.dirname(videoPath);
          thumbnailPath = buildStoragePath(videoDir, video.thumbnailFilename);
          if (!pathExists(thumbnailPath)) {
            thumbnailPath = null;
          }
        }
      }
    }

    // Final fallback: try standard image locations
    if (
      canUseLocalFallbacks &&
      (!thumbnailPath || !pathExists(thumbnailPath))
    ) {
      thumbnailPath = findImageFile(video.thumbnailFilename, allCollections);
    }

    // Delete the thumbnail file if it exists
    if (thumbnailPath && pathExists(thumbnailPath)) {
      if (isThumbnailReferencedByOtherVideo(video, video.id)) {
        logger.info(
          `Skipping thumbnail deletion - another video still references it: ${thumbnailPath}`
        );
        return;
      }

      try {
        const thumbnailWebPath =
          resolveManagedThumbnailWebPathFromAbsolutePath(thumbnailPath) ||
          video.thumbnailPath ||
          null;
        removeFileIfExists(thumbnailPath);
        deleteSmallThumbnailMirrorSync(thumbnailWebPath);
        logger.info(`Deleted thumbnail file: ${thumbnailPath}`);
      } catch (error) {
        logger.error(
          `Error deleting thumbnail file ${thumbnailPath}`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }
}

function deleteAuthorAvatarIfNeeded(
  video: import("./types").Video,
  exceptionId: string
): void {
  if (video.authorAvatarFilename && video.author) {
    // Check if there are other videos from the same author
    const allVideos = getVideos();
    const otherVideosFromAuthor = allVideos.filter(
      (v) => v.id !== exceptionId && v.author === video.author
    );

    // Only delete avatar if this is the last video from this author
    if (otherVideosFromAuthor.length === 0) {
      let avatarPath: string | null = null;

      // Determine the actual file path based on authorAvatarPath
      if (video.authorAvatarPath) {
        if (video.authorAvatarPath.startsWith("/avatars/")) {
          // Avatar is in avatars directory
          avatarPath = buildStoragePath(
            UPLOADS_DIR,
            video.authorAvatarPath.replace(/^\//, "")
          );
        } else if (video.authorAvatarPath.startsWith("/images/")) {
          // Legacy: Avatar might be in images directory (for backward compatibility)
          avatarPath = buildStoragePath(
            UPLOADS_DIR,
            video.authorAvatarPath.replace(/^\//, "")
          );
        }
      }

      // Fallback: try to find by filename in avatars directory
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (!avatarPath || !pathExists(avatarPath)) {
        const fallbackPath = buildStoragePath(
          AVATARS_DIR,
          video.authorAvatarFilename
        );
        if (pathExists(fallbackPath)) {
          avatarPath = fallbackPath;
        }
      }

      // Delete the avatar file if it exists
      if (avatarPath && pathExists(avatarPath)) {
        try {
          removeFileIfExists(avatarPath);
          logger.info(`Deleted author avatar file: ${avatarPath}`);
        } catch (error) {
          logger.error(
            `Error deleting author avatar file ${avatarPath}`,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    } else {
      logger.info(
        `Skipping avatar deletion - ${otherVideosFromAuthor.length} other video(s) from author "${video.author}" still exist`
      );
    }
  }
}

function deleteSubtitleFiles(
  video: import("./types").Video,
  allCollections: import("./types").Collection[]
): void {
  if (video.subtitles && video.subtitles.length > 0) {
    const canUseLocalFallbacks = isLocalManagedVideo(video);
    for (const subtitle of video.subtitles) {
      let subtitlePath: string | null = null;

      // Determine the actual file path based on subtitle.path
      if (subtitle.path) {
        if (subtitle.path.startsWith("/videos/")) {
          // Subtitle is stored alongside video file
          subtitlePath = buildStoragePath(
            VIDEOS_DIR,
            subtitle.path.replace(/^\/videos\//, "")
          );
        } else if (subtitle.path.startsWith("/subtitles/")) {
          // Subtitle is in subtitles directory (may be in collection subdirectory)
          subtitlePath = buildStoragePath(
            UPLOADS_DIR,
            subtitle.path.replace(/^\//, "")
          );
        }
      }

      // Fallback: try to find by filename if path-based lookup fails
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (
        canUseLocalFallbacks &&
        (!subtitlePath || !pathExists(subtitlePath))
      ) {
        // Try root subtitles directory
        subtitlePath = buildStoragePath(SUBTITLES_DIR, subtitle.filename);
        if (!pathExists(subtitlePath)) {
          // Try alongside video file
          if (video.videoFilename) {
            const videoPath = findVideoFile(
              video.videoFilename,
              allCollections
            );
            if (videoPath) {
              const videoDir = path.dirname(videoPath);
              subtitlePath = buildStoragePath(videoDir, subtitle.filename);
            }
          }
        }
      }

      // Delete the subtitle file if it exists
      if (subtitlePath && pathExists(subtitlePath)) {
        try {
          removeFileIfExists(subtitlePath);
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
}
