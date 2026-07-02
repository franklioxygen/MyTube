import { DATA_DIR } from "../../config/paths";
import { readFileSafeSync } from "../../utils/security";
import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import { ContinuousDownloadTask } from "./types";

/**
 * Service for cleaning up temporary files and resources for tasks
 */
export class TaskCleanup {
  /**
   * Cancel the active download for the task's current video, if any.
   *
   * Deliberately offline: the current video URL comes from the frozen list
   * only, and artifact deletion is owned by the downloader's cancel hook
   * (registered with downloadManager), which knows the exact filenames it
   * created. The previous implementation reconstructed filenames here via
   * getVideoInfo — and, without a frozen list, a full channel enumeration —
   * putting network fetches on the cancellation path.
   */
  async cleanupCurrentVideoTempFiles(
    task: ContinuousDownloadTask
  ): Promise<void> {
    // If no videos have been processed yet, nothing to clean up
    if (task.currentVideoIndex === 0 || task.totalVideos === 0) {
      return;
    }

    try {
      const currentVideoUrl = this.resolveCurrentVideoUrl(task);
      if (!currentVideoUrl) {
        // Without a frozen list there is no offline way to attribute an
        // active download to the current video. The caller (cancelTask)
        // already cancelled every download it could match against the task's
        // known URL set, so stop here rather than enumerate the channel.
        return;
      }

      const { activeDownloads } = storageService.getDownloadStatus();
      const downloadManager = await import("../downloadManager");

      for (const download of activeDownloads) {
        if (download.sourceUrl !== currentVideoUrl) {
          continue;
        }
        logger.info(
          `Cancelling active download ${download.id} for video ${currentVideoUrl}`
        );
        try {
          // The downloader's cancel hook kills the subprocess and deletes its
          // partial video/thumbnail/subtitle artifacts.
          await downloadManager.default.cancelDownload(download.id);
        } catch (error) {
          logger.error(`Error cancelling download ${download.id}:`, error);
          // Fallback: drop the record and sweep artifacts by the record's own
          // filename — still offline information.
          storageService.removeActiveDownload(download.id);
          if (download.filename) {
            const { cleanupVideoArtifacts } = await import(
              "../../utils/downloadUtils"
            );
            const path = await import("path");
            const { VIDEOS_DIR } = await import("../../config/paths");
            const baseFilename = path.basename(
              download.filename,
              path.extname(download.filename)
            );
            await cleanupVideoArtifacts(baseFilename, VIDEOS_DIR);
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

  /** Current video URL from the frozen list, or null when unavailable. */
  private resolveCurrentVideoUrl(task: ContinuousDownloadTask): string | null {
    if (!task.frozenVideoListPath) {
      return null;
    }
    try {
      const raw = readFileSafeSync(task.frozenVideoListPath, DATA_DIR, "utf8");
      const videoUrls = JSON.parse(raw) as string[];
      if (task.currentVideoIndex < videoUrls.length) {
        return videoUrls[task.currentVideoIndex] ?? null;
      }
    } catch (err) {
      logger.debug(
        `Could not read frozen list for cleanup of task ${task.id}:`,
        err
      );
    }
    return null;
  }
}
