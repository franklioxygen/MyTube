import { eq } from "drizzle-orm";
import { getErrorMessage } from "../../utils/errors";
import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { formatVideoFilename } from "../../utils/helpers";
import { logger } from "../../utils/logger";
import {
  buildStoragePath,
  pathExists,
  removeFileIfExists,
  renamePath,
} from "./fileHelpers";
import { moveSmallThumbnailMirrorSync } from "../thumbnailMirrorService";
import { bumpVideosListRevision } from "./videoListRevision";
import { getVideos } from "./videoQueries";

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
      } catch (err: unknown) {
        logger.error(
          `Error renaming video ${video.id}`,
          err instanceof Error ? err : new Error(String(err))
        );
        results.errors++;
        results.details.push(`Error: ${video.title} - ${getErrorMessage(err)}`);
      }
    }

    if (results.renamed > 0) {
      bumpVideosListRevision();
    }
    return results;
  } catch (error: unknown) {
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
