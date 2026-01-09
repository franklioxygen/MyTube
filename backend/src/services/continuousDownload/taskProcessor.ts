import { v4 as uuidv4 } from "uuid";
import { logger } from "../../utils/logger";
import {
  downloadSingleBilibiliPart,
  downloadYouTubeVideo,
} from "../downloadService";
import { DownloadResult } from "../downloaders/bilibili/types";
import * as storageService from "../storageService";
import { Video } from "../storageService";
import { TaskRepository } from "./taskRepository";
import { ContinuousDownloadTask } from "./types";
import { VideoUrlFetcher } from "./videoUrlFetcher";

/**
 * Union type for download results from different platforms
 * - Bilibili returns DownloadResult (wrapped with success/error)
 * - YouTube returns Video (direct video object)
 */
type DownloadResultUnion = DownloadResult | Video;

/**
 * Extract Video data from download result, handling both result formats
 */
function extractVideoData(
  result: DownloadResultUnion | null | undefined
): Video | null {
  if (!result) {
    return null;
  }

  // Check if it's a DownloadResult (has videoData property)
  if ("videoData" in result && result.videoData) {
    return result.videoData;
  }

  // Check if it's already a Video object
  if ("id" in result && "title" in result) {
    return result as Video;
  }

  return null;
}

/**
 * Timing constants for download task processing
 * These conservative values prevent overwhelming the system while maintaining
 * reasonable throughput. Can be made configurable in the future if needed.
 */
const PROCESSING_DELAY_MS = 1000; // Delay between video processing iterations
const SLOT_POLL_INTERVAL_MS = 1000; // Polling interval for download slot availability

/**
 * Service for processing continuous download tasks
 */
export class TaskProcessor {
  constructor(
    private taskRepository: TaskRepository,
    private videoUrlFetcher: VideoUrlFetcher
  ) {}

  /**
   * Process a continuous download task
   * @param task - The task to process
   * @param cachedVideoUrls - Optional cached video URLs for non-incremental mode
   */
  async processTask(
    task: ContinuousDownloadTask,
    cachedVideoUrls?: string[]
  ): Promise<void> {
    // For large playlists, use incremental fetching to save memory
    // Check if it's a playlist (likely to be large)
    const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
    const isPlaylist = playlistRegex.test(task.authorUrl);
    const useIncremental = isPlaylist && task.platform === "YouTube";

    // Get total count if not set
    if (task.totalVideos === 0) {
      await this.initializeTotalVideos(task, useIncremental, cachedVideoUrls);
    }

    const totalVideos = task.totalVideos || 0;
    const fetchBatchSize = 50; // Fetch 50 URLs at a time

    // For non-incremental tasks, ensure we have the video URLs
    let allVideoUrls: string[] = [];
    if (!useIncremental) {
      if (cachedVideoUrls) {
        allVideoUrls = cachedVideoUrls;
      } else {
        allVideoUrls = await this.videoUrlFetcher.getAllVideoUrls(
          task.authorUrl,
          task.platform
        );
      }
    }

    // Buffer for incremental fetching
    let videoUrlBatch: string[] = [];
    let batchStartIndex = -1;

    // Process videos one by one
    for (let i = task.currentVideoIndex; i < totalVideos; i++) {
      // Check if task was cancelled or paused - check EVERY iteration
      const currentTask = await this.taskRepository.getTaskById(task.id);
      if (!currentTask || currentTask.status !== "active") {
        logger.info(`Task ${task.id} was cancelled or paused`);
        break;
      }

      let videoUrl: string;

      if (useIncremental) {
        // Fetch batch if needed
        // If i is outside the current batch range, fetch a new batch
        if (
          i < batchStartIndex ||
          i >= batchStartIndex + videoUrlBatch.length
        ) {
          batchStartIndex = i;
          // Don't fetch past totalVideos
          const countToFetch = Math.min(fetchBatchSize, totalVideos - i);

          logger.debug(
            `Fetching batch of ${countToFetch} URLs starting at ${i} for task ${task.id}`
          );
          videoUrlBatch = await this.videoUrlFetcher.getVideoUrlsIncremental(
            task.authorUrl,
            task.platform,
            i,
            countToFetch
          );

          if (videoUrlBatch.length === 0) {
            logger.warn(
              `No videos found in batch starting at ${i}, stopping task`
            );
            break;
          }
        }

        const indexInBatch = i - batchStartIndex;
        if (indexInBatch >= videoUrlBatch.length) {
          logger.warn(
            `Index ${i} out of bounds for batch starting at ${batchStartIndex} (length ${videoUrlBatch.length})`
          );
          break;
        }
        videoUrl = videoUrlBatch[indexInBatch];
      } else {
        // Non-incremental: access from full list
        if (i >= allVideoUrls.length) {
          break;
        }
        videoUrl = allVideoUrls[i];
      }

      // Double-check status right before starting video download
      // This prevents starting a new download if task was paused between iterations
      const taskBeforeDownload = await this.taskRepository.getTaskById(task.id);
      if (!taskBeforeDownload || taskBeforeDownload.status !== "active") {
        logger.info(
          `Task ${task.id} was cancelled or paused before starting video download`
        );
        break;
      }

      logger.info(
        `Processing video ${i + 1}/${totalVideos} for task ${
          task.id
        }: ${videoUrl}`
      );

      try {
        await this.processVideo(task, videoUrl, i, taskBeforeDownload);
      } catch (downloadError: any) {
        // Check if error is due to task being paused/cancelled
        const isPauseOrCancel =
          downloadError.message?.includes("not active") ||
          downloadError.message?.includes("paused") ||
          downloadError.message?.includes("cancelled");

        if (isPauseOrCancel) {
          // Task was paused/cancelled, don't treat as download error
          logger.info(
            `Task ${task.id} was paused or cancelled during video processing`
          );
          break;
        }

        // Actual download error
        logger.error(
          `Error downloading video ${videoUrl} for task ${task.id}:`,
          downloadError
        );

        // Add to download history as failed
        storageService.addDownloadHistoryItem({
          id: uuidv4(),
          title: `Video from ${task.author}`,
          author: task.author,
          sourceUrl: videoUrl,
          finishedAt: Date.now(),
          status: "failed",
          error: downloadError.message || "Download failed",
        });

        // Update task progress
        const currentTaskAfterError = await this.taskRepository.getTaskById(
          task.id
        );
        if (
          currentTaskAfterError &&
          currentTaskAfterError.status === "active"
        ) {
          await this.taskRepository.updateProgress(task.id, {
            failedCount: (currentTaskAfterError.failedCount || 0) + 1,
            currentVideoIndex: i + 1,
          });
        }
      }

      // Check status again after video processing completes
      // This ensures we stop immediately if task was paused during the download
      const taskAfterDownload = await this.taskRepository.getTaskById(task.id);
      if (!taskAfterDownload || taskAfterDownload.status !== "active") {
        logger.info(
          `Task ${task.id} was cancelled or paused after video download`
        );
        break;
      }

      // Small delay to avoid overwhelming the system
      // This conservative delay helps prevent resource contention and ensures
      // stable performance under load. Can be made configurable for higher
      // throughput scenarios if needed (e.g., small files, fast networks).
      if (i < totalVideos - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, PROCESSING_DELAY_MS)
        );
      }
    }

    // Mark task as completed if we reached the end and it's still active
    const finalTask = await this.taskRepository.getTaskById(task.id);
    if (
      finalTask &&
      finalTask.status === "active" &&
      finalTask.currentVideoIndex >= finalTask.totalVideos
    ) {
      await this.taskRepository.completeTask(task.id);
      logger.info(
        `Completed continuous download task ${task.id}: ${finalTask.downloadedCount} downloaded, ${finalTask.skippedCount} skipped, ${finalTask.failedCount} failed`
      );
    }
  }

  /**
   * Initialize total video count for a task
   */
  private async initializeTotalVideos(
    task: ContinuousDownloadTask,
    useIncremental: boolean,
    cachedVideoUrls?: string[]
  ): Promise<void> {
    if (useIncremental) {
      // For playlists, get count without loading all URLs
      const count = await this.videoUrlFetcher.getVideoCount(
        task.authorUrl,
        task.platform
      );
      if (count > 0) {
        await this.taskRepository.updateTotalVideos(task.id, count);
        task.totalVideos = count;
      } else {
        // Fallback: get count from first batch
        const testBatch = await this.videoUrlFetcher.getVideoUrlsIncremental(
          task.authorUrl,
          task.platform,
          0,
          100
        );
        const estimatedTotal =
          testBatch.length >= 100 ? 1000 : testBatch.length; // Estimate
        await this.taskRepository.updateTotalVideos(task.id, estimatedTotal);
        task.totalVideos = estimatedTotal;
      }
    } else {
      // For channels or small lists, use cached URLs if available
      if (cachedVideoUrls) {
        await this.taskRepository.updateTotalVideos(
          task.id,
          cachedVideoUrls.length
        );
        task.totalVideos = cachedVideoUrls.length;
      } else {
        // Fallback: fetch all URLs
        logger.info(`Fetching video list for task ${task.id}...`);
        const videoUrls = await this.videoUrlFetcher.getAllVideoUrls(
          task.authorUrl,
          task.platform
        );
        await this.taskRepository.updateTotalVideos(task.id, videoUrls.length);
        task.totalVideos = videoUrls.length;
      }
    }
  }

  /**
   * Process a single video
   */
  private async processVideo(
    task: ContinuousDownloadTask,
    videoUrl: string,
    videoIndex: number,
    currentTask: ContinuousDownloadTask
  ): Promise<void> {
    // Check status one more time right before starting the download
    // This is the last chance to abort before a potentially long download operation
    const taskStatusCheck = await this.taskRepository.getTaskById(task.id);
    if (!taskStatusCheck || taskStatusCheck.status !== "active") {
      logger.info(
        `Task ${task.id} was cancelled or paused, aborting video download`
      );
      throw new Error(
        `Task ${task.id} is not active (status: ${
          taskStatusCheck?.status || "not found"
        })`
      );
    }

    // Check if video already exists
    const existingVideo = storageService.getVideoBySourceUrl(videoUrl);
    if (existingVideo) {
      logger.debug(`Video ${videoUrl} already exists, skipping`);
      // Fetch latest task state to avoid race conditions
      const latestTask = await this.taskRepository.getTaskById(task.id);
      if (latestTask) {
        await this.taskRepository.updateProgress(task.id, {
          skippedCount: (latestTask.skippedCount || 0) + 1,
          currentVideoIndex: videoIndex + 1,
        });
      }
      return;
    }

    // Wait for an available download slot before starting
    await this.waitForDownloadSlot(task.id);

    // Generate download ID and register active download
    const downloadId = uuidv4();
    storageService.addActiveDownload(
      downloadId,
      `Downloading from ${task.author} (${videoIndex + 1}/${task.totalVideos})`
    );
    // Update with metadata for better tracking
    storageService.updateActiveDownload(downloadId, {
      sourceUrl: videoUrl,
      type: task.platform.toLowerCase(),
    });

    try {
      // Download the video
      let downloadResult: DownloadResultUnion;
      if (task.platform === "Bilibili") {
        downloadResult = await downloadSingleBilibiliPart(
          videoUrl,
          1,
          1,
          "",
          downloadId
        );

        // Check for Bilibili download errors
        if ("success" in downloadResult && !downloadResult.success) {
          throw new Error(
            downloadResult.error ||
              `Failed to download Bilibili video: ${videoUrl}`
          );
        }
      } else {
        downloadResult = await downloadYouTubeVideo(videoUrl, downloadId);
      }

      // Extract video data from result (handles both DownloadResult and Video formats)
      const videoData = extractVideoData(downloadResult);
      if (!videoData) {
        throw new Error(
          `Failed to extract video data from download result for ${videoUrl}`
        );
      }

      // Add to download history
      storageService.addDownloadHistoryItem({
        id: uuidv4(),
        title: videoData.title || `Video from ${task.author}`,
        author: videoData.author || task.author,
        sourceUrl: videoUrl,
        finishedAt: Date.now(),
        status: "success",
        videoPath: videoData.videoPath,
        thumbnailPath: videoData.thumbnailPath,
        videoId: videoData.id,
      });

      // If task has a collectionId, add video to collection
      if (task.collectionId && videoData.id) {
        try {
          storageService.addVideoToCollection(task.collectionId, videoData.id);
          logger.info(
            `Added video ${videoData.id} to collection ${task.collectionId}`
          );
        } catch (error) {
          logger.error(
            `Error adding video to collection ${task.collectionId}:`,
            error
          );
          // Don't fail the task if collection add fails
        }
      }

      // Update task progress - fetch latest state to avoid race conditions
      const latestTaskForUpdate = await this.taskRepository.getTaskById(
        task.id
      );
      if (latestTaskForUpdate) {
        await this.taskRepository.updateProgress(task.id, {
          downloadedCount: (latestTaskForUpdate.downloadedCount || 0) + 1,
          currentVideoIndex: videoIndex + 1,
        });
      }
    } finally {
      // Always remove from active downloads when done (success or failure)
      storageService.removeActiveDownload(downloadId);
    }
  }

  /**
   * Wait for an available download slot based on maxConcurrentDownloads setting
   */
  private async waitForDownloadSlot(taskId: string): Promise<void> {
    const settings = storageService.getSettings();
    const maxConcurrent = settings.maxConcurrentDownloads || 3;

    // Poll until a slot is available
    while (true) {
      // Check if task was cancelled or paused while waiting
      const currentTask = await this.taskRepository.getTaskById(taskId);
      if (!currentTask || currentTask.status !== "active") {
        logger.info(
          `Task ${taskId} was cancelled or paused while waiting for download slot`
        );
        throw new Error(
          `Task ${taskId} is not active (status: ${
            currentTask?.status || "not found"
          })`
        );
      }

      const downloadStatus = storageService.getDownloadStatus();
      const activeCount = downloadStatus.activeDownloads.length;

      if (activeCount < maxConcurrent) {
        // Slot available, proceed
        logger.debug(
          `Download slot available (${activeCount}/${maxConcurrent} active)`
        );
        return;
      }

      // Wait a bit before checking again
      // Conservative polling interval prevents excessive CPU usage while
      // maintaining reasonable responsiveness. Could be optimized with
      // adaptive intervals or event-based notifications in the future.
      logger.debug(
        `Waiting for download slot (${activeCount}/${maxConcurrent} active)`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, SLOT_POLL_INTERVAL_MS)
      );
    }
  }
}
