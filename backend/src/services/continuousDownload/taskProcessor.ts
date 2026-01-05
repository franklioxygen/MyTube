import { v4 as uuidv4 } from "uuid";
import { logger } from "../../utils/logger";
import {
  downloadSingleBilibiliPart,
  downloadYouTubeVideo,
} from "../downloadService";
import * as storageService from "../storageService";
import { TaskRepository } from "./taskRepository";
import { ContinuousDownloadTask } from "./types";
import { VideoUrlFetcher } from "./videoUrlFetcher";

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
      if (i < totalVideos - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
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

    // Download the video
    let downloadResult: any;
    if (task.platform === "Bilibili") {
      downloadResult = await downloadSingleBilibiliPart(videoUrl, 1, 1, "");
    } else {
      downloadResult = await downloadYouTubeVideo(videoUrl);
    }

    // Add to download history
    const videoData = downloadResult?.videoData || downloadResult || {};
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
    const latestTaskForUpdate = await this.taskRepository.getTaskById(task.id);
    if (latestTaskForUpdate) {
      await this.taskRepository.updateProgress(task.id, {
        downloadedCount: (latestTaskForUpdate.downloadedCount || 0) + 1,
        currentVideoIndex: videoIndex + 1,
      });
    }
  }
}
