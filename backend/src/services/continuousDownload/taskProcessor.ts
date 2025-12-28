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
    const processBatchSize = 10; // Process 10 videos at a time

    // Process videos incrementally
    for (
      let i = task.currentVideoIndex;
      i < totalVideos;
      i += processBatchSize
    ) {
      // Check if task was cancelled
      const currentTask = await this.taskRepository.getTaskById(task.id);
      if (!currentTask || currentTask.status !== "active") {
        logger.info(`Task ${task.id} was cancelled or paused`);
        break;
      }

      // Fetch batch of URLs if using incremental mode
      let videoUrls: string[] = [];
      if (useIncremental) {
        // Fetch only the batch we need
        const batchStart = i;
        const batchEnd = Math.min(i + fetchBatchSize, totalVideos);
        videoUrls = await this.videoUrlFetcher.getVideoUrlsIncremental(
          task.authorUrl,
          task.platform,
          batchStart,
          batchEnd - batchStart
        );
      } else {
        // For non-incremental, use cached URLs if provided
        if (cachedVideoUrls) {
          videoUrls = cachedVideoUrls;
        } else {
          // Fallback: fetch all URLs if cache not provided
          videoUrls = await this.videoUrlFetcher.getAllVideoUrls(
            task.authorUrl,
            task.platform
          );
        }
      }

      // Process videos in this batch
      for (let j = 0; j < videoUrls.length && i + j < totalVideos; j++) {
        const videoIndex = i + j;
        const videoUrl = videoUrls[j];
        logger.info(
          `Processing video ${
            videoIndex + 1
          }/${totalVideos} for task ${task.id}: ${videoUrl}`
        );

        try {
          await this.processVideo(task, videoUrl, videoIndex, currentTask);
        } catch (downloadError: any) {
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
          if (currentTaskAfterError) {
            await this.taskRepository.updateProgress(task.id, {
              failedCount: (currentTaskAfterError.failedCount || 0) + 1,
              currentVideoIndex: videoIndex + 1,
            });
          }
        }

        // Small delay to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Clear videoUrls reference after processing batch to help GC
      videoUrls = [];
    }

    // Mark task as completed
    const finalTask = await this.taskRepository.getTaskById(task.id);
    if (finalTask && finalTask.status === "active") {
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
    // Check if video already exists
    const existingVideo = storageService.getVideoBySourceUrl(videoUrl);
    if (existingVideo) {
      logger.debug(`Video ${videoUrl} already exists, skipping`);
      await this.taskRepository.updateProgress(task.id, {
        skippedCount: (currentTask.skippedCount || 0) + 1,
        currentVideoIndex: videoIndex + 1,
      });
      return;
    }

    // Download the video
    let downloadResult: any;
    if (task.platform === "Bilibili") {
      downloadResult = await downloadSingleBilibiliPart(
        videoUrl,
        1,
        1,
        ""
      );
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
        storageService.addVideoToCollection(
          task.collectionId,
          videoData.id
        );
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

    // Update task progress
    await this.taskRepository.updateProgress(task.id, {
      downloadedCount: (currentTask.downloadedCount || 0) + 1,
      currentVideoIndex: videoIndex + 1,
    });
  }
}

