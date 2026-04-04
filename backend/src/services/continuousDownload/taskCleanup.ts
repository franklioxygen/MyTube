import { DATA_DIR } from "../../config/paths";
import { readFileSafeSync } from "../../utils/security";
import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import { ContinuousDownloadTask } from "./types";
import { VideoUrlFetcher } from "./videoUrlFetcher";

/**
 * Service for cleaning up temporary files and resources for tasks
 */
export class TaskCleanup {
  constructor(private videoUrlFetcher: VideoUrlFetcher) {}

  /**
   * Clean up temporary files for the current video being downloaded in a task.
   * Uses the frozen list when available to identify the current video URL,
   * avoiding an extra network fetch.
   */
  async cleanupCurrentVideoTempFiles(
    task: ContinuousDownloadTask
  ): Promise<void> {
    // If no videos have been processed yet, nothing to clean up
    if (task.currentVideoIndex === 0 || task.totalVideos === 0) {
      return;
    }

    try {
      // Prefer frozen list to identify the current video URL
      let videoUrls: string[] | null = null;

      if (task.frozenVideoListPath) {
        try {
          const raw = readFileSafeSync(task.frozenVideoListPath, DATA_DIR, "utf8");
          videoUrls = JSON.parse(raw) as string[];
        } catch (err) {
          logger.debug(`Could not read frozen list for cleanup of task ${task.id}:`, err);
        }
      }

      if (!videoUrls) {
        // Fallback: fetch all URLs (legacy path for incremental tasks or missing frozen list)
        videoUrls = await this.videoUrlFetcher.getAllVideoUrls(
          task.authorUrl,
          task.platform
        );
      }

      if (task.currentVideoIndex < videoUrls.length) {
        const currentVideoUrl = videoUrls[task.currentVideoIndex];
        logger.info(
          `Cleaning up temp files for current video: ${currentVideoUrl}`
        );

        // Get video info to determine the expected filename
        const { getVideoInfo } = await import("../downloadService");
        const videoInfo = await getVideoInfo(currentVideoUrl);

        if (videoInfo.title) {
          const { formatVideoFilename } = await import("../../utils/helpers");
          const { VIDEOS_DIR } = await import("../../config/paths");
          const path = await import("path");

          // Generate the expected base filename
          const baseFilename = formatVideoFilename(
            videoInfo.title,
            videoInfo.author || task.author,
            videoInfo.date ||
              new Date().toISOString().slice(0, 10).replace(/-/g, "")
          );

          // Clean up video artifacts (temp files, .part files, etc.)
          const { cleanupVideoArtifacts } = await import(
            "../../utils/downloadUtils"
          );
          const deletedFiles = await cleanupVideoArtifacts(
            baseFilename,
            VIDEOS_DIR
          );

          if (deletedFiles.length > 0) {
            logger.info(
              `Cleaned up ${deletedFiles.length} temp files for cancelled task ${task.id}`
            );
          }

          // Also check active downloads and cancel any matching download
          const downloadStatus = storageService.getDownloadStatus();
          const activeDownloads = downloadStatus.activeDownloads;

          // Import download manager to properly cancel downloads
          const downloadManager = await import("../downloadManager");

          for (const download of activeDownloads) {
            if (
              download.sourceUrl === currentVideoUrl ||
              (download.filename && download.filename.includes(baseFilename))
            ) {
              logger.info(
                `Cancelling active download ${download.id} for video ${currentVideoUrl}`
              );
              try {
                downloadManager.default.cancelDownload(download.id);
              } catch (error) {
                logger.error(
                  `Error cancelling download ${download.id}:`,
                  error
                );
                // Fallback: just remove from database if download manager fails
                storageService.removeActiveDownload(download.id);
              }

              // Clean up temp files for this download
              if (download.filename) {
                const { cleanupVideoArtifacts: cleanupArtifacts } =
                  await import("../../utils/downloadUtils");
                const path = await import("path");
                const { VIDEOS_DIR } = await import("../../config/paths");
                // Extract base filename without extension
                const baseFilenameForCleanup = path.basename(
                  download.filename,
                  path.extname(download.filename)
                );
                await cleanupArtifacts(baseFilenameForCleanup, VIDEOS_DIR);
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(
        `Error in cleanupCurrentVideoTempFiles for task ${task.id}:`,
        error
      );
      // Don't throw - we want cancellation to proceed even if cleanup fails
    }
  }
}
