import { v4 as uuidv4 } from "uuid";
import { getErrorMessage } from "../../utils/errors";
import { logger } from "../../utils/logger";
import {
  downloadSingleBilibiliPart,
  downloadYouTubeVideo,
} from "../downloadService";
import { platformFromUrl } from "../statistics";
import { getEffectiveUserYtDlpConfig } from "../../utils/ytDlpUtils";
import { resolveDownloadAudioMode } from "../downloaders/ytdlp/ytdlpConfig";
import { DownloadResult } from "../downloaders/bilibili/types";
import { stripChannelSuffixFromPlaylistName } from "../filenameTemplate/sourceNaming";
import { FilenameTemplateSourceOptions } from "../filenameTemplate/types";
import * as storageService from "../storageService";
import { Video } from "../storageService";
import { buildFilenameTemplateSourceOptions } from "../subscription/helpers";
import type { Subscription } from "../subscription/types";
import { TaskRepository } from "./taskRepository";
import { ContinuousDownloadTask } from "./types";
import { VideoUrlFetcher } from "./videoUrlFetcher";

/**
 * Union type for download results from different platforms
 * - Bilibili returns DownloadResult (wrapped with success/error)
 * - YouTube returns Video (direct video object)
 */
type DownloadResultUnion = DownloadResult | Video;

// Re-read the task status from the DB at most every N iterations. The loop
// also observes the in-memory interruption signal every iteration, so this
// only governs how often we re-confirm external (DB-level) changes.
const STATUS_DB_CHECK_EVERY_ITERS = 10;

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

type TaskProgressState = {
  downloadedCount: number;
  skippedCount: number;
  failedCount: number;
  currentVideoIndex: number;
};

function getArrayItem<T>(items: readonly T[], index: number): T | null {
  if (index < 0 || index >= items.length) {
    return null;
  }

  const [item] = items.slice(index, index + 1);
  return item ?? null;
}

/**
 * Service for processing continuous download tasks
 */
export class TaskProcessor {
  // In-memory set of task ids that have been paused/cancelled since the
  // running loop last checked. Lets the hot loop detect interruption without
  // polling the DB on every iteration; the loop still falls back to a
  // throttled DB read as the source of truth.
  private interruptedTaskIds = new Set<string>();

  constructor(
    private taskRepository: TaskRepository,
    private videoUrlFetcher: VideoUrlFetcher
  ) {}

  private getLinkedSubscriptionFilenameTemplate(
    task: ContinuousDownloadTask,
    taskSubscription: Subscription | null
  ): string | null {
    if (!task.subscriptionId || taskSubscription?.id !== task.subscriptionId) {
      return null;
    }
    return taskSubscription.filenameTemplate ?? null;
  }

  /**
   * Signal that a task has been paused or cancelled. The running loop (if any)
   * observes this via isTaskInterrupted() on its next iteration.
   */
  signalInterruption(taskId: string): void {
    this.interruptedTaskIds.add(taskId);
  }

  /**
   * Cheap in-memory interruption check (no DB round-trip).
   */
  isTaskInterrupted(taskId: string): boolean {
    return this.interruptedTaskIds.has(taskId);
  }

  /**
   * Drop a task's in-memory interruption signal. Called when a task is resumed
   * so a quick pause→resume doesn't leave a stale flag that kills the resumed
   * worker before it observes the new "active" status.
   */
  clearInterruption(taskId: string): void {
    this.interruptedTaskIds.delete(taskId);
  }

  /**
   * Decide whether the loop should stop because of an interruption signal.
   *
   * The in-memory flag is only a fast hint, not the source of truth: when it is
   * set we confirm against the DB. If the task is "active" again (a quick
   * pause→resume landed while this loop was mid-iteration), the signal is stale —
   * we clear it and keep going so the task isn't left active with no worker.
   * Returns true only when the DB confirms the task is no longer active.
   */
  private async shouldStopForInterruption(taskId: string): Promise<boolean> {
    if (!this.isTaskInterrupted(taskId)) {
      return false;
    }
    const status = await this.taskRepository.getTaskStatus(taskId);
    if (status === "active") {
      this.clearInterruption(taskId);
      return false;
    }
    return true;
  }

  /**
   * Returns true if the task is still "active" and the loop should continue.
   *
   * Checks the cheap in-memory interruption signal first (confirmed against the
   * DB before stopping — see shouldStopForInterruption). To stay resilient to
   * external (DB-level) status changes, it also re-reads the DB status on a
   * throttle (every STATUS_DB_CHECK_EVERY_ITERS iterations) rather than on
   * every iteration — this removes the per-video DB round-trips while still
   * bounding the worst-case detection latency.
   */
  private async isTaskStillActive(
    taskId: string,
    iteration: number,
    startIndex: number
  ): Promise<boolean> {
    if (await this.shouldStopForInterruption(taskId)) {
      return false;
    }
    const sinceStart = iteration - startIndex;
    if (sinceStart % STATUS_DB_CHECK_EVERY_ITERS === 0) {
      const status = await this.taskRepository.getTaskStatus(taskId);
      if (status !== "active") {
        return false;
      }
    }
    return true;
  }

  /**
   * Process a continuous download task
   * @param task - The task to process
   * @param cachedVideoUrls - Optional cached video URLs for non-incremental mode
   */
  async processTask(
    task: ContinuousDownloadTask,
    cachedVideoUrls?: string[]
  ): Promise<void> {
    const progressState = this.createProgressState(task);
    const maxConcurrentDownloads = this.resolveMaxConcurrentDownloads();

    // Mode is determined by the service: if cachedVideoUrls was passed, it's always full-fetch.
    // Incremental is only used for YouTube playlists when no pre-fetched list is provided.
    const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
    const isPlaylist = playlistRegex.test(task.authorUrl);
    const useIncremental = !cachedVideoUrls && isPlaylist && task.platform === "YouTube";

    // Resolve the subscription (and its per-subscription yt-dlp override) up
    // front so proxy/rate-limit overrides needed to enumerate the source apply
    // to the count/list probes below, not just the eventual per-video download
    // (issue #345). Falls back to task metadata when unresolvable.
    let taskSubscription: Subscription | null = null;
    try {
      taskSubscription = await this.taskRepository.getSubscriptionForTask(task);
    } catch (error) {
      logger.warn(
        `Unable to resolve subscription source options for task ${task.id}; falling back to task metadata`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
    const subscriptionYtdlpConfig = taskSubscription?.ytdlpConfig ?? null;

    // Get total count if not set
    if (task.totalVideos === 0) {
      await this.initializeTotalVideos(
        task,
        useIncremental,
        cachedVideoUrls,
        subscriptionYtdlpConfig
      );
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
          task.platform,
          subscriptionYtdlpConfig
        );
      }
    }

    // Buffer for incremental fetching
    let videoUrlBatch: string[] = [];
    let batchStartIndex = -1;

    // Process videos one by one
    const startIndex = task.currentVideoIndex;
    for (let i = startIndex; i < totalVideos; i++) {
      // Check if task was cancelled or paused. Uses the in-memory interruption
      // signal plus a throttled DB read (see isTaskStillActive).
      const stillActive = await this.isTaskStillActive(task.id, i, startIndex);
      if (!stillActive) {
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
            countToFetch,
            subscriptionYtdlpConfig
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
        const batchVideoUrl = getArrayItem(videoUrlBatch, indexInBatch);
        if (!batchVideoUrl) {
          logger.warn(
            `No video URL found at batch index ${indexInBatch} for task ${task.id}`
          );
          break;
        }
        videoUrl = batchVideoUrl;
      } else {
        // Non-incremental: access from full list
        const fullListVideoUrl = getArrayItem(allVideoUrls, i);
        if (!fullListVideoUrl) {
          break;
        }
        videoUrl = fullListVideoUrl;
      }

      // Re-check the interruption signal before starting the slow download.
      // The in-memory flag is confirmed against the DB so a quick pause→resume
      // doesn't abort the (now active) task here.
      if (await this.shouldStopForInterruption(task.id)) {
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
        await this.processVideo(
          task,
          videoUrl,
          i,
          progressState,
          maxConcurrentDownloads,
          taskSubscription
        );
      } catch (downloadError: unknown) {
        const downloadErrorMessage = getErrorMessage(downloadError);
        // Check if error is due to task being paused/cancelled
        const isPauseOrCancel =
          downloadErrorMessage.includes("not active") ||
          downloadErrorMessage.includes("paused") ||
          downloadErrorMessage.includes("cancelled");

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
          error: downloadErrorMessage || "Download failed",
          taskId: task.id,
          subscriptionId: task.subscriptionId,
          platform: platformFromUrl(videoUrl),
          sourceKind: "task",
        });

        const taskStatusAfterError = await this.taskRepository.getTaskStatus(
          task.id
        );
        if (taskStatusAfterError === "active") {
          progressState.failedCount += 1;
          progressState.currentVideoIndex = i + 1;
          await this.persistProgress(task.id, progressState);
        }
      }

      // Stop promptly if task was paused/cancelled during the download. Avoid a
      // per-video DB poll here; service-level pause/cancel sets the interruption
      // signal and external DB changes are covered by the throttled loop check.
      if (this.isTaskInterrupted(task.id)) {
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

    // Clear any in-memory interruption flag so a future run of the same task id
    // isn't observed as already interrupted.
    this.clearInterruption(task.id);
  }

  /**
   * Initialize total video count for a task
   */
  private async initializeTotalVideos(
    task: ContinuousDownloadTask,
    useIncremental: boolean,
    cachedVideoUrls?: string[],
    subscriptionYtdlpConfig?: string | null
  ): Promise<void> {
    if (useIncremental) {
      // For playlists, get count without loading all URLs
      const count = await this.videoUrlFetcher.getVideoCount(
        task.authorUrl,
        task.platform,
        subscriptionYtdlpConfig
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
          100,
          subscriptionYtdlpConfig
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
          task.platform,
          subscriptionYtdlpConfig
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
    progressState: TaskProgressState,
    maxConcurrentDownloads: number,
    taskSubscription: Subscription | null
  ): Promise<void> {
    // Last cheap chance to abort before a potentially long download operation.
    // The outer loop already performs throttled DB checks; this avoids turning
    // every successful video into another status round-trip.
    if (this.isTaskInterrupted(task.id)) {
      logger.info(
        `Task ${task.id} was cancelled or paused, aborting video download`
      );
      throw new Error(`Task ${task.id} is not active (interrupted)`);
    }

    // Per-subscription yt-dlp override (issue #345). Null when the task has no
    // resolvable subscription → identical to today's behaviour (global config).
    const subscriptionYtdlpConfig = taskSubscription?.ytdlpConfig ?? null;
    // Per-subscription filename-template override (issue #368). Null → global.
    const subscriptionFilenameTemplate =
      this.getLinkedSubscriptionFilenameTemplate(task, taskSubscription);

    // An audio-only override (e.g. --format bestaudio) saves the item under the
    // "audio" media type. Scope the duplicate check to that media type too so a
    // later backfill sees the audio rows from previous runs instead of
    // re-downloading every already-downloaded item (issue #345).
    const effectiveUserConfig = getEffectiveUserYtDlpConfig(
      videoUrl,
      subscriptionYtdlpConfig
    );
    const { audioOnly: isAudioOnlyDownload } = resolveDownloadAudioMode({
      userConfig: effectiveUserConfig,
    });

    // Check if video already exists
    const existingVideo = storageService.getVideoBySourceUrl(
      videoUrl,
      isAudioOnlyDownload ? "audio" : "video"
    );
    if (existingVideo) {
      logger.debug(`Video ${videoUrl} already exists, skipping`);
      progressState.skippedCount += 1;
      progressState.currentVideoIndex = videoIndex + 1;
      await this.persistProgress(task.id, progressState);
      return;
    }

    // Wait for an available download slot before starting
    await this.waitForDownloadSlot(task.id, maxConcurrentDownloads);

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

    const filenameTemplateSourceOptions =
      taskSubscription
        ? buildFilenameTemplateSourceOptions(taskSubscription, videoIndex + 1)
        : this.buildFallbackFilenameTemplateSourceOptions(task, videoIndex);

    try {
      // Download the video
      let downloadResult: DownloadResultUnion;
      if (task.platform === "Bilibili") {
        downloadResult = await downloadSingleBilibiliPart(
          videoUrl,
          1,
          1,
          "",
          downloadId,
          undefined,
          undefined,
          filenameTemplateSourceOptions,
          {
            subscriptionYtdlpConfig,
            subscriptionFilenameTemplate,
          }
        );

        // Check for Bilibili download errors
        if ("success" in downloadResult && !downloadResult.success) {
          throw new Error(
            downloadResult.error ||
              `Failed to download Bilibili video: ${videoUrl}`
          );
        }
      } else {
        downloadResult = await downloadYouTubeVideo(videoUrl, {
          downloadId,
          filenameTemplateSourceOptions,
          subscriptionYtdlpConfig,
          subscriptionFilenameTemplate,
        });
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
        videoPath: videoData.videoPath ?? undefined,
        thumbnailPath: videoData.thumbnailPath ?? undefined,
        videoId: videoData.id,
        taskId: task.id,
        subscriptionId: task.subscriptionId,
        platform:
          typeof task.platform === "string"
            ? task.platform.toLowerCase()
            : platformFromUrl(videoUrl),
        sourceKind: "task",
        totalSize:
          typeof videoData.fileSize === "string" ||
          typeof videoData.fileSize === "number"
            ? String(videoData.fileSize)
            : undefined,
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

      progressState.downloadedCount += 1;
      progressState.currentVideoIndex = videoIndex + 1;
      await this.persistProgress(task.id, progressState);
    } finally {
      // Always remove from active downloads when done (success or failure)
      storageService.removeActiveDownload(downloadId);
    }
  }

  private buildFallbackFilenameTemplateSourceOptions(
    task: ContinuousDownloadTask,
    videoIndex: number
  ): FilenameTemplateSourceOptions {
    // Standalone tasks do not have subscription metadata. Playlist tasks store
    // the display collection name, which may include " - <channel>", so pass
    // the clean playlist title when possible.
    const sourceCollectionName = task.collectionId
      ? stripChannelSuffixFromPlaylistName(task.playlistName, task.author) ||
        task.playlistName ||
        task.author
      : task.playlistName || task.author;
    const sourceCollectionType: FilenameTemplateSourceOptions["sourceCollectionType"] =
      task.collectionId ? "playlist" : task.subscriptionId ? "channel" : "single";

    return {
      sourceCustomName: task.author,
      sourceCollectionName,
      sourceCollectionType,
      mediaPlaylistIndex: videoIndex + 1,
    };
  }

  /**
   * Wait for an available download slot based on maxConcurrentDownloads setting
   */
  private async waitForDownloadSlot(
    taskId: string,
    maxConcurrent: number
  ): Promise<void> {
    // Poll until a slot is available. DB status is re-read on the same throttle
    // used by the main loop; service-level pause/cancel is checked every poll.
    let pollCount = 0;
    for (;;) {
      if (this.isTaskInterrupted(taskId)) {
        logger.info(
          `Task ${taskId} was cancelled or paused while waiting for download slot`
        );
        throw new Error(`Task ${taskId} is not active (interrupted)`);
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

      if (pollCount % STATUS_DB_CHECK_EVERY_ITERS === 0) {
        const currentTaskStatus = await this.taskRepository.getTaskStatus(taskId);
        if (currentTaskStatus !== "active") {
          logger.info(
            `Task ${taskId} was cancelled or paused while waiting for download slot`
          );
          throw new Error(
            `Task ${taskId} is not active (status: ${
              currentTaskStatus || "not found"
            })`
          );
        }
      }
      pollCount++;

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

  private createProgressState(task: ContinuousDownloadTask): TaskProgressState {
    return {
      downloadedCount: task.downloadedCount || 0,
      skippedCount: task.skippedCount || 0,
      failedCount: task.failedCount || 0,
      currentVideoIndex: task.currentVideoIndex || 0,
    };
  }

  private resolveMaxConcurrentDownloads(): number {
    const settings = storageService.getSettings();
    const maxConcurrent = Number(settings.maxConcurrentDownloads);
    if (Number.isFinite(maxConcurrent) && maxConcurrent > 0) {
      return Math.floor(maxConcurrent);
    }
    return 3;
  }

  private async persistProgress(
    taskId: string,
    progressState: TaskProgressState
  ): Promise<void> {
    await this.taskRepository.updateProgress(taskId, {
      downloadedCount: progressState.downloadedCount,
      skippedCount: progressState.skippedCount,
      failedCount: progressState.failedCount,
      currentVideoIndex: progressState.currentVideoIndex,
    });
  }
}
