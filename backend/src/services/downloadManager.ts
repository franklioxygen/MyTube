import {
    DownloadCancelledError,
    isCancelledError,
} from "../errors/DownloadErrors";
import { extractSourceVideoId } from "../utils/helpers";
import { getErrorMessage } from "../utils/errors";
import { sanitizeLogMessage } from "../utils/logger";
import { CloudStorageService } from "./CloudStorageService";
import {
  canRestoreDetachedTask,
  parseRetryMetadata,
  requiresRetryMetadata,
  serializeRetryMetadata,
  type DownloadRetryMetadata,
} from "./downloadRetryMetadata";
import { awaitTaskCancellationHook, awaitTaskFailHook } from "./downloadManager/hooks";
import {
  buildDetachedTask,
  buildRetryHistoryItem,
  BILIBILI_RETRY_RESTORE_FAILED_MESSAGE,
  resolveRetryPolicy,
} from "./downloadManager/retryScheduler";
import { PARTIAL_STATUS, PENDING_RETRY_STATUS } from "./downloadManager/retryPolicy";
import {
  getStructuredDownloadResult,
  isStructuredDownloadResult,
  type AddDownloadStatisticsOptions,
  type DownloadTask,
} from "./downloadManager/types";
import { assertDownloadsAllowed } from "./filenameTemplate/renameLockService";
import { HookService } from "./hookService";
import {
  recordEvent,
  platformFromUrl,
  normalizeSourceKind,
  normalizeSurface,
} from "./statistics";
import type { DownloadHistoryItem } from "./storageService";
import * as storageService from "./storageService";
import { logger } from "../utils/logger";

class DownloadManager {
  private queue: DownloadTask[];
  private activeTasks: Map<string, DownloadTask>;
  private retryTimers: Map<string, NodeJS.Timeout>;
  private activeDownloads: number;
  private maxConcurrentDownloads: number;

  constructor() {
    this.queue = [];
    this.activeTasks = new Map();
    this.retryTimers = new Map();
    this.activeDownloads = 0;
    this.maxConcurrentDownloads = 3; // Default
  }

  private async loadSettings() {
    try {
      const settings = storageService.getSettings();
      if (settings.maxConcurrentDownloads) {
        this.maxConcurrentDownloads = settings.maxConcurrentDownloads;
        logger.info(
          `Loaded maxConcurrentDownloads from database: ${this.maxConcurrentDownloads}`
        );
      }
    } catch (error) {
      logger.error("Error loading settings in DownloadManager:", error);
    }
  }

  private hasTask(id: string): boolean {
    return this.activeTasks.has(id) || this.queue.some((task) => task.id === id);
  }

  private enqueueTask(task: DownloadTask, persistQueue = true): void {
    if (this.hasTask(task.id)) {
      return;
    }

    this.queue.push(task);
    if (persistQueue) {
      this.updateQueuedDownloads();
    }
    this.processQueue();
  }

  private clearRetryTimer(id: string): void {
    const timer = this.retryTimers.get(id);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.retryTimers.delete(id);
  }

  private scheduleRetryTask(
    task: DownloadTask,
    historyItem: DownloadHistoryItem,
  ): void {
    if (!task.sourceUrl || !task.type) {
      storageService.finalizePendingRetryHistoryItem(
        task.id,
        historyItem.error ?? "Retry metadata missing"
      );
      return;
    }

    this.clearRetryTimer(task.id);

    const nextRetryAt = historyItem.nextRetryAt ?? Date.now();
    const delayMs = Math.max(nextRetryAt - Date.now(), 0);
    const timer = setTimeout(() => {
      this.retryTimers.delete(task.id);

      const latestHistory =
        storageService.getDownloadHistoryItem(task.id) ?? historyItem;
      if (latestHistory.status !== PENDING_RETRY_STATUS || this.hasTask(task.id)) {
        return;
      }

      this.enqueueTask(task);
    }, delayMs);

    this.retryTimers.set(task.id, timer);
  }

  private restorePendingRetries(): void {
    const pendingRetries = storageService.getPendingRetryHistoryItems();
    if (pendingRetries.length === 0) {
      return;
    }

    for (const item of pendingRetries) {
      if (this.hasTask(item.id)) {
        continue;
      }

      if (!item.sourceUrl || !item.downloadType) {
        storageService.finalizePendingRetryHistoryItem(
          item.id,
          item.error ?? "Retry metadata missing"
        );
        continue;
      }

      if (!canRestoreDetachedTask(item.downloadType, item.retryMetadata)) {
        storageService.finalizePendingRetryHistoryItem(
          item.id,
          BILIBILI_RETRY_RESTORE_FAILED_MESSAGE,
        );
        continue;
      }

      const retryMetadata = parseRetryMetadata(item.retryMetadata);
      const task = buildDetachedTask(
        item.id,
        item.title,
        item.sourceUrl,
        item.downloadType,
        retryMetadata,
        item.retryMetadata,
      );
      if (!task) {
        storageService.finalizePendingRetryHistoryItem(
          item.id,
          BILIBILI_RETRY_RESTORE_FAILED_MESSAGE,
        );
        continue;
      }
      this.scheduleRetryTask(task, item);
    }
  }

  private maybeScheduleRetry(task: DownloadTask, error: unknown): boolean {
    if (!task.sourceUrl || !task.type) {
      return false;
    }

    const settings = storageService.getSettings();
    if (settings.autoRetryEnabled !== true) {
      return false;
    }

    const existingHistory = storageService.getDownloadHistoryItem(task.id);
    const policy = resolveRetryPolicy(
      task,
      settings.autoRetryTimes,
      settings.autoRetryIntervalMinutes,
      existingHistory,
    );
    if (!policy) {
      return false;
    }

    const historyItem = buildRetryHistoryItem({
      task,
      error,
      retryLimit: policy.retryLimit,
      retryIntervalMinutes: policy.retryIntervalMinutes,
      retryCount: policy.retryCount,
      existingHistory,
    });

    storageService.addDownloadHistoryItem(historyItem);
    this.scheduleRetryTask(task, historyItem);
    return true;
  }

  /**
   * Initialize the download manager and restore queued tasks
   */
  initialize(): void {
    try {
      logger.info("Initializing DownloadManager...");
      this.loadSettings();
      const status = storageService.getDownloadStatus();
      const queuedDownloads = status.queuedDownloads;

      if (queuedDownloads && queuedDownloads.length > 0) {
        logger.info("Restoring queued downloads...", queuedDownloads.length);

        for (const download of queuedDownloads) {
          if (download.sourceUrl && download.type) {
            logger.info(
              "Restoring task:",
              sanitizeLogMessage(download.title),
              sanitizeLogMessage(download.id),
            );

            if (!canRestoreDetachedTask(download.type, download.retryMetadata)) {
              logger.warn(
                `Skipping restoration of task ${download.id} due to unrestorable Bilibili retry metadata`,
              );
              continue;
            }

            const restoredTask = buildDetachedTask(
              download.id,
              download.title,
              download.sourceUrl,
              download.type,
              parseRetryMetadata(download.retryMetadata),
              download.retryMetadata,
            );
            if (!restoredTask) {
              logger.warn(
                `Skipping restoration of task ${download.id} due to invalid retry metadata`,
              );
              continue;
            }

            this.queue.push(restoredTask);
          } else {
            logger.warn(
              `Skipping restoration of task ${download.id} due to missing sourceUrl or type`
            );
          }
        }
      }

      this.restorePendingRetries();
      this.processQueue();
    } catch (error) {
      logger.error("Error initializing DownloadManager:", error);
    }
  }

  /**
   * Set the maximum number of concurrent downloads
   * @param limit - Maximum number of concurrent downloads
   */
  setMaxConcurrentDownloads(limit: number): void {
    this.maxConcurrentDownloads = limit;
    this.processQueue();
  }

  /**
   * Add a download task to the manager
   * @param downloadFn - Async function that performs the download
   * @param id - Unique ID for the download
   * @param title - Title of the video being downloaded
   * @param sourceUrl - Source URL of the video
   * @param type - Type of the download (youtube, bilibili, missav)
   * @returns - Resolves when the download is complete
   */
  async addDownload(
    downloadFn: (registerCancel: (cancel: () => void) => void) => Promise<any>,
    id: string,
    title: string,
    sourceUrl?: string,
    type?: string,
    statistics?: AddDownloadStatisticsOptions,
    retryMetadata?: DownloadRetryMetadata,
  ): Promise<any> {
    assertDownloadsAllowed();
    return new Promise((resolve, reject) => {
      const task: DownloadTask = {
        downloadFn,
        id,
        title,
        resolve,
        reject,
        sourceUrl,
        type,
        retryMetadata,
        statistics: statistics
          ? {
              actorRole: statistics.actorRole ?? "admin",
              surface: normalizeSurface(statistics.surface ?? "web"),
              sourceKind: normalizeSourceKind(statistics.sourceKind ?? "manual"),
              relatedEventId: statistics.relatedEventId ?? null,
              enqueuedEventId: statistics.enqueuedEventId ?? null,
            }
          : undefined,
      };

      this.queue.push(task);
      this.updateQueuedDownloads();
      this.processQueue();
    });
  }

  /**
   * Update the title of a download task (queued or active)
   * @param id - ID of the download
   * @param title - New title
   */
  updateTaskTitle(id: string, title: string): void {
    // Check active tasks
    const activeTask = this.activeTasks.get(id);
    if (activeTask) {
      logger.info(
        "Updating active task title:",
        sanitizeLogMessage(id),
        sanitizeLogMessage(title),
      );
      activeTask.title = title;
      storageService.updateActiveDownloadTitle(id, title);
    } else {
      // Check queued tasks
      const queuedTask = this.queue.find((t) => t.id === id);
      if (queuedTask) {
        logger.info(
          "Updating queued task title:",
          sanitizeLogMessage(id),
          sanitizeLogMessage(title),
        );
        queuedTask.title = title;
        this.updateQueuedDownloads();
      }
    }
  }

  /**
   * Cancel an active download
   * @param id - ID of the download to cancel
   */
  private finalizeCancelledTask(
    task: DownloadTask,
    error: DownloadCancelledError = DownloadCancelledError.create(),
  ): void {
    if (!task.cancellationFinalized) {
      task.cancellationFinalized = true;
      this.clearRetryTimer(task.id);
      storageService.removeActiveDownload(task.id);
      storageService.addDownloadHistoryItem({
        id: task.id,
        title: task.title,
        finishedAt: Date.now(),
        status: "failed",
        error: "Download cancelled by user",
        sourceUrl: task.sourceUrl,
        platform: platformFromUrl(task.sourceUrl),
        sourceKind: task.statistics?.sourceKind ?? "unknown",
        downloadType: task.type,
      });

      HookService.executeHook("task_cancel", {
        taskId: task.id,
        taskTitle: task.title,
        sourceUrl: task.sourceUrl,
        status: "cancel",
      });
    }

    if (!task.cancellationRejected) {
      task.cancellationRejected = true;
      task.reject(error);
    }

    if (this.activeTasks.has(task.id)) {
      this.activeTasks.delete(task.id);
      this.activeDownloads = Math.max(0, this.activeDownloads - 1);
      this.processQueue();
    }
  }

  async cancelDownload(id: string): Promise<void> {
    const task = this.activeTasks.get(id);
    if (task) {
      logger.info(
        "Cancelling active download:",
        sanitizeLogMessage(task.title),
        sanitizeLogMessage(id),
      );
      task.cancelled = true;

      // Call the cancel function if available
      if (task.cancelFn) {
        try {
          await awaitTaskCancellationHook(
            id,
            task.cancelFn as () => void | Promise<void>,
          );
        } catch (error) {
          logger.error(
            "Error calling cancel function for download:",
            sanitizeLogMessage(id),
            error,
          );
        }
      }

      this.finalizeCancelledTask(task);
    } else {
      // Check if it's in the queue and remove it
      const inQueue = this.queue.some((t) => t.id === id);
      if (inQueue) {
        logger.info("Removing queued download:", sanitizeLogMessage(id));
        this.removeFromQueue(id);
        return;
      }

      const pendingRetryItem = storageService.getDownloadHistoryItem(id);
      if (pendingRetryItem?.status === PENDING_RETRY_STATUS) {
        logger.info("Cancelling pending retry:", sanitizeLogMessage(id));
        this.clearRetryTimer(id);
        storageService.finalizePendingRetryHistoryItem(
          id,
          "Retry cancelled by user"
        );
      }
    }
  }

  /**
   * Remove a download from the queue
   * @param id - ID of the download to remove
   */
  removeFromQueue(id: string): void {
    const removedTasks = this.queue.filter((task) => task.id === id);
    this.queue = this.queue.filter((task) => task.id !== id);
    this.clearRetryTimer(id);
    const pendingRetryItem = storageService.getDownloadHistoryItem(id);
    const isPendingRetry = pendingRetryItem?.status === PENDING_RETRY_STATUS;
    if (isPendingRetry) {
      storageService.finalizePendingRetryHistoryItem(
        id,
        "Retry removed from queue by user"
      );
    }
    for (const task of removedTasks) {
      if (isPendingRetry) {
        task.reject(new Error("Retry removed from queue by user"));
      }
    }
    this.updateQueuedDownloads();
  }

  /**
   * Clear the download queue
   */
  clearQueue(): void {
    const queuedTasks = [...this.queue];
    this.queue = [];
    for (const task of queuedTasks) {
      this.clearRetryTimer(task.id);
      const pendingRetryItem = storageService.getDownloadHistoryItem(task.id);
      if (pendingRetryItem?.status === PENDING_RETRY_STATUS) {
        storageService.finalizePendingRetryHistoryItem(
          task.id,
          "Retry removed from queue by user"
        );
        task.reject(new Error("Retry removed from queue by user"));
      }
    }
    this.updateQueuedDownloads();
  }

  /**
   * Update the queued downloads in storage
   */
  private updateQueuedDownloads(): void {
    const queuedDownloads = this.queue.map((task) => ({
      id: task.id,
      title: task.title,
      timestamp: Date.now(),
      sourceUrl: task.sourceUrl,
      type: task.type,
      retryMetadata:
        task.retryMetadata && requiresRetryMetadata(task.retryMetadata)
          ? serializeRetryMetadata(task.retryMetadata)
          : undefined,
    }));
    storageService.setQueuedDownloads(queuedDownloads);
  }

  /**
   * Process the download queue
   */
  private async processQueue(): Promise<void> {
    if (
      this.activeDownloads >= this.maxConcurrentDownloads ||
      this.queue.length === 0
    ) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.updateQueuedDownloads();
    this.activeDownloads++;
    this.activeTasks.set(task.id, task);

    // Update status in storage
    storageService.addActiveDownload(task.id, task.title);
    // Update with extra info if available
    if (task.sourceUrl || task.type) {
      storageService.updateActiveDownload(task.id, {
        sourceUrl: task.sourceUrl,
        type: task.type,
      });
    }

    // download_started: pair with download_enqueued via relatedEventId so the
    // queue-wait percentile rollups can match the two without write-time joins.
    try {
      const stats = task.statistics;
      const platform = platformFromUrl(task.sourceUrl);
      recordEvent({
        eventType: "download_started",
        actorRole: stats?.actorRole ?? "system",
        surface: stats?.surface ?? "background",
        sessionId: null,
        relatedEventId: stats?.enqueuedEventId ?? stats?.relatedEventId ?? null,
        platform,
        sourceKind: stats?.sourceKind ?? "unknown",
        payload: { downloadId: task.id },
      });
    } catch {
      // statistics is best-effort
    }

    try {
      logger.info(
        "Starting download:",
        sanitizeLogMessage(task.title),
        sanitizeLogMessage(task.id),
      );

      // Execute hook
      await HookService.executeHook("task_before_start", {
        taskId: task.id,
        taskTitle: task.title,
        sourceUrl: task.sourceUrl,
        status: "start",
      });

      const result = await task.downloadFn((cancel) => {
        task.cancelFn = cancel;
      });
      if (task.cancelled) {
        throw DownloadCancelledError.create();
      }

      if (isStructuredDownloadResult(result)) {
        if (result.success === false || result.partial === true) {
          throw Object.assign(
            new Error(result.error || "Download did not complete successfully"),
            { downloadResult: result },
          );
        }
      }

      // Extract video data from result
      // videoController returns { success: true, video: ... }
      // But some downloaders might return the video object directly or different structure
      const videoData = result.video || result.videoData || result;
      storageService.removeActiveDownload(task.id);

      logger.info(
        "Download finished for task",
        sanitizeLogMessage(task.title),
        sanitizeLogMessage(videoData.title),
      );

      // Determine best title
      let finalTitle = videoData.title;
      const genericTitles = [
        "YouTube Video",
        "Bilibili Video",
        "MissAV Video",
        "Video",
      ];
      if (!finalTitle || genericTitles.includes(finalTitle)) {
        if (task.title && !genericTitles.includes(task.title)) {
          finalTitle = task.title;
        }
      }

      // Add to history
      if (!task.cancelled) {
        this.clearRetryTimer(task.id);
        const historySourceUrl = videoData.sourceUrl || task.sourceUrl;
        const historyTotalSize =
          typeof videoData.fileSize === "string" || typeof videoData.fileSize === "number"
            ? String(videoData.fileSize)
            : undefined;
        storageService.addDownloadHistoryItem({
          id: task.id,
          title: finalTitle || task.title,
          finishedAt: Date.now(),
          status: "success",
          videoPath: videoData.videoPath,
          thumbnailPath: videoData.thumbnailPath,
          sourceUrl: historySourceUrl,
          author: videoData.author,
          videoId: videoData.id,
          totalSize: historyTotalSize,
          platform: platformFromUrl(historySourceUrl),
          sourceKind: task.statistics?.sourceKind ?? "manual",
          downloadType: task.type,
          retryMetadata:
            task.retryMetadata && requiresRetryMetadata(task.retryMetadata)
              ? serializeRetryMetadata(task.retryMetadata)
              : undefined,
        });

        // Record video download for future duplicate detection
        const sourceUrl = videoData.sourceUrl || task.sourceUrl;
        if (sourceUrl && videoData.id) {
          const { id: sourceVideoId, platform } =
            extractSourceVideoId(sourceUrl);
          if (sourceVideoId) {
            // Check if this is a re-download of previously deleted video
            const existingRecord =
              storageService.checkVideoDownloadBySourceId(
                sourceVideoId,
                platform
              );
            if (existingRecord.found && existingRecord.status === "deleted") {
              // Update existing record
              storageService.updateVideoDownloadRecord(
                sourceVideoId,
                videoData.id,
                finalTitle || task.title,
                videoData.author,
                platform
              );
            } else if (!existingRecord.found) {
              // New download, create record
              storageService.recordVideoDownload(
                sourceVideoId,
                sourceUrl,
                platform,
                videoData.id,
                finalTitle || task.title,
                videoData.author
              );
            }
          }
        }
      }



      // Execute hook - Await this so user script can process local file before cloud upload/delete
      await HookService.executeHook("task_success", {
        taskId: task.id,
        taskTitle: finalTitle || task.title,
        sourceUrl: task.sourceUrl,
        status: "success",
        videoPath: videoData.videoPath,
        thumbnailPath: videoData.thumbnailPath,
      });

      import("./telegramService").then(({ TelegramService }) =>
        TelegramService.notifyTaskComplete({
          taskTitle: finalTitle || task.title,
          status: "success",
          sourceUrl: task.sourceUrl,
        })
      ).catch(() => {});

      // Trigger Cloud Upload (Async, don't await to block queue processing?)
      // Actually, we might want to await it if we want to ensure it's done before resolving,
      // but that would block the download queue.
      // Let's run it in background but log it.
      CloudStorageService.uploadVideo({
        ...videoData,
        title: finalTitle || task.title,
        sourceUrl: task.sourceUrl,
      }).catch((err) => logger.error("Background cloud upload failed:", err));

      task.resolve(result);
    } catch (error) {
      // Check if this is a cancellation - handle differently
      if (isCancelledError(error) || task.cancelled) {
        logger.info("Download cancelled:", sanitizeLogMessage(task.title));
        task.cancelled = true;
        this.finalizeCancelledTask(
          task,
          isCancelledError(error) ? error : DownloadCancelledError.create(),
        );
        return;
      } else {
        logger.error(
          "Error downloading task:",
          sanitizeLogMessage(task.title),
          error,
        );
      }

      // Download failed
      storageService.removeActiveDownload(task.id);

      // Add to history (unless already added by cancelDownload)
      let retryScheduled = false;
      if (!task.cancelled) {
        retryScheduled = this.maybeScheduleRetry(task, error);
      }

      if (!task.cancelled && !retryScheduled) {
        this.clearRetryTimer(task.id);
        const structuredResult = getStructuredDownloadResult(error);
        storageService.addDownloadHistoryItem({
          id: task.id,
          title: task.title,
          finishedAt: Date.now(),
          status: structuredResult?.partial === true ? PARTIAL_STATUS : "failed",
          error: getErrorMessage(error),
          sourceUrl: task.sourceUrl,
          platform: platformFromUrl(task.sourceUrl),
          sourceKind: task.statistics?.sourceKind ?? "unknown",
          downloadType: task.type,
          retryMetadata:
            task.retryMetadata && requiresRetryMetadata(task.retryMetadata)
              ? serializeRetryMetadata(task.retryMetadata)
              : undefined,
        });
      }

      if (!retryScheduled) {
        // Await failure hooks so notifications and other side effects complete
        // before the task rejection propagates to callers.
        await awaitTaskFailHook({
          taskId: task.id,
          taskTitle: task.title,
          sourceUrl: task.sourceUrl,
          status: "fail",
          error: getErrorMessage(error),
        });

        import("./telegramService").then(({ TelegramService }) =>
          TelegramService.notifyTaskComplete({
            taskTitle: task.title,
            status: "fail",
            sourceUrl: task.sourceUrl,
            error: getErrorMessage(error),
          })
        ).catch(() => {});

        task.reject(error);
      }
    } finally {
      // Only clean up if the task wasn't already cleaned up by cancelDownload
      if (this.activeTasks.has(task.id)) {
        this.activeTasks.delete(task.id);
        this.activeDownloads--;
      }
      // Process next item in queue
      this.processQueue();
    }
  }

  /**
   * Get current status
   */
  getStatus(): { active: number; queued: number } {
    return {
      active: this.activeDownloads,
      queued: this.queue.length,
    };
  }
}

// Export a singleton instance
export default new DownloadManager();
