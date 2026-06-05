import {
    DownloadCancelledError,
    isCancelledError,
} from "../errors/DownloadErrors";
import { extractSourceVideoId } from "../utils/helpers";
import { logger, sanitizeLogMessage } from "../utils/logger";
import { CloudStorageService } from "./CloudStorageService";
import { createDownloadTask } from "./downloadService";
import { assertDownloadsAllowed } from "./filenameTemplate/renameLockService";
import { HookService } from "./hookService";
import {
  recordEvent,
  platformFromUrl,
  normalizeSourceKind,
  normalizeSurface,
} from "./statistics";
import type {
  ActorRole,
  CanonicalSourceKind,
  StatisticsSurface,
} from "./statistics";
import type { DownloadHistoryItem } from "./storageService";
import * as storageService from "./storageService";

interface StatisticsAttribution {
  actorRole: ActorRole;
  surface: StatisticsSurface;
  sourceKind: CanonicalSourceKind;
  relatedEventId: string | null;
  enqueuedEventId: string | null;
}

interface DownloadTask {
  downloadFn: (registerCancel: (cancel: () => void) => void) => Promise<any>;
  id: string;
  title: string;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  cancelFn?: () => void;
  sourceUrl?: string;
  type?: string;
  cancelled?: boolean;
  cancellationFinalized?: boolean;
  cancellationRejected?: boolean;
  statistics?: StatisticsAttribution;
}

export interface AddDownloadStatisticsOptions {
  actorRole?: ActorRole;
  surface?: StatisticsSurface | string;
  sourceKind?: CanonicalSourceKind | string;
  relatedEventId?: string | null;
  enqueuedEventId?: string | null;
}

const TASK_FAIL_HOOK_WAIT_TIMEOUT_MS = 5000;
const CANCEL_TASK_WAIT_TIMEOUT_MS = 5000;
const DEFAULT_AUTO_RETRY_TIMES = 3;
const DEFAULT_AUTO_RETRY_INTERVAL_MINUTES = 5;
const AUTO_RETRY_INTERVAL_OPTIONS = new Set([1, 5, 10, 30, 60]);
const PENDING_RETRY_STATUS = "pending_retry";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeAutoRetryTimes(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_AUTO_RETRY_TIMES;
  }

  return Math.min(10, Math.max(1, Math.floor(numeric)));
}

function normalizeAutoRetryIntervalMinutes(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_AUTO_RETRY_INTERVAL_MINUTES;
  }

  const normalized = Math.floor(numeric);
  return AUTO_RETRY_INTERVAL_OPTIONS.has(normalized)
    ? normalized
    : DEFAULT_AUTO_RETRY_INTERVAL_MINUTES;
}

async function awaitTaskFailHook(
  context: Record<string, string | undefined>,
): Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    await Promise.race([
      HookService.executeHook("task_fail", context),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(
            `task_fail hook exceeded ${TASK_FAIL_HOOK_WAIT_TIMEOUT_MS}ms; continuing task failure handling.`
          );
          resolve();
        }, TASK_FAIL_HOOK_WAIT_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.error("task_fail hook failed:", error);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function awaitTaskCancellationHook(
  taskId: string,
  cancelFn: () => void | Promise<void>,
): Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    await Promise.race([
      Promise.resolve().then(() => cancelFn()),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(
            `Cancel hook for download ${sanitizeLogMessage(taskId)} exceeded ${CANCEL_TASK_WAIT_TIMEOUT_MS}ms; finalizing cancellation anyway.`
          );
          resolve();
        }, CANCEL_TASK_WAIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

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
        console.log(
          `Loaded maxConcurrentDownloads from database: ${this.maxConcurrentDownloads}`
        );
      }
    } catch (error) {
      console.error("Error loading settings in DownloadManager:", error);
    }
  }

  private createDetachedTask(
    id: string,
    title: string,
    sourceUrl: string,
    type: string,
  ): DownloadTask {
    return {
      downloadFn: createDownloadTask(type, sourceUrl, id),
      id,
      title,
      sourceUrl,
      type,
      resolve: (value) =>
        console.log("Restored task completed", sanitizeLogMessage(id), value),
      reject: (error) =>
        console.error("Restored task failed", sanitizeLogMessage(id), error),
    };
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

      const task = this.createDetachedTask(
        item.id,
        item.title,
        item.sourceUrl,
        item.downloadType,
      );
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
    const retryLimit =
      existingHistory?.retryLimit ??
      normalizeAutoRetryTimes(settings.autoRetryTimes);
    const retryIntervalMinutes =
      existingHistory?.retryIntervalMinutes ??
      normalizeAutoRetryIntervalMinutes(settings.autoRetryIntervalMinutes);
    const retryCount = existingHistory?.retryCount ?? 0;

    if (retryCount >= retryLimit) {
      return false;
    }

    const historyItem: DownloadHistoryItem = {
      id: task.id,
      title: task.title,
      finishedAt: Date.now(),
      status: PENDING_RETRY_STATUS,
      error: getErrorMessage(error),
      sourceUrl: task.sourceUrl,
      platform: platformFromUrl(task.sourceUrl),
      sourceKind: task.statistics?.sourceKind ?? existingHistory?.sourceKind ?? "unknown",
      downloadType: task.type,
      retryCount: retryCount + 1,
      retryLimit,
      retryIntervalMinutes,
      nextRetryAt: Date.now() + retryIntervalMinutes * 60 * 1000,
    };

    storageService.addDownloadHistoryItem(historyItem);
    this.scheduleRetryTask(task, historyItem);
    return true;
  }

  /**
   * Initialize the download manager and restore queued tasks
   */
  initialize(): void {
    try {
      console.log("Initializing DownloadManager...");
      this.loadSettings();
      const status = storageService.getDownloadStatus();
      const queuedDownloads = status.queuedDownloads;

      if (queuedDownloads && queuedDownloads.length > 0) {
        console.log("Restoring queued downloads...", queuedDownloads.length);

        for (const download of queuedDownloads) {
          if (download.sourceUrl && download.type) {
            console.log(
              "Restoring task:",
              sanitizeLogMessage(download.title),
              sanitizeLogMessage(download.id),
            );

            this.queue.push(
              this.createDetachedTask(
                download.id,
                download.title,
                download.sourceUrl,
                download.type,
              )
            );
          } else {
            console.warn(
              `Skipping restoration of task ${download.id} due to missing sourceUrl or type`
            );
          }
        }
      }

      this.restorePendingRetries();
      this.processQueue();
    } catch (error) {
      console.error("Error initializing DownloadManager:", error);
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
    statistics?: AddDownloadStatisticsOptions
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
      console.log(
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
        console.log(
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
      console.log(
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
          console.error(
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
        console.log("Removing queued download:", sanitizeLogMessage(id));
        this.removeFromQueue(id);
        return;
      }

      const pendingRetryItem = storageService.getDownloadHistoryItem(id);
      if (pendingRetryItem?.status === PENDING_RETRY_STATUS) {
        console.log("Cancelling pending retry:", sanitizeLogMessage(id));
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
      console.log(
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

      // Extract video data from result
      // videoController returns { success: true, video: ... }
      // But some downloaders might return the video object directly or different structure
      const videoData = result.video || result;

      // For multi-part downloads, don't remove from active downloads yet
      // The background download will handle removing it when all parts are done
      const isMultiPart = result.isMultiPart === true && result.totalParts > 1;
      if (!isMultiPart) {
        // Download complete (single video)
        storageService.removeActiveDownload(task.id);
      } else {
        // Multi-part download - keep it active until all parts are done
        logger.info(
          `Multi-part download in progress: ${result.totalParts} parts. Keeping download active.`
        );
      }

      console.log(
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
      }).catch((err) => console.error("Background cloud upload failed:", err));

      task.resolve(result);
    } catch (error) {
      // Check if this is a cancellation - handle differently
      if (isCancelledError(error) || task.cancelled) {
        console.log("Download cancelled:", sanitizeLogMessage(task.title));
        task.cancelled = true;
        this.finalizeCancelledTask(
          task,
          isCancelledError(error) ? error : DownloadCancelledError.create(),
        );
        return;
      } else {
        console.error(
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
        storageService.addDownloadHistoryItem({
          id: task.id,
          title: task.title,
          finishedAt: Date.now(),
          status: "failed",
          error: getErrorMessage(error),
          sourceUrl: task.sourceUrl,
          platform: platformFromUrl(task.sourceUrl),
          sourceKind: task.statistics?.sourceKind ?? "unknown",
          downloadType: task.type,
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
