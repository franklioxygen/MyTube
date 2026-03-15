import { v4 as uuidv4 } from "uuid";
import {
  ensureDirSync,
  readUtf8FileSync,
  removeFileSync,
  writeUtf8FileSync,
} from "../utils/fileSystemAccess";
import { logger } from "../utils/logger";
import { TaskCleanup } from "./continuousDownload/taskCleanup";
import {
  buildFrozenListPath,
  getFrozenListsRoot,
  resolveStoredFrozenListPath,
} from "./continuousDownload/frozenListPaths";
import { TaskProcessor } from "./continuousDownload/taskProcessor";
import { TaskRepository } from "./continuousDownload/taskRepository";
import { ContinuousDownloadTask, DownloadOrder } from "./continuousDownload/types";
import { sortVideoEntries, VideoUrlFetcher } from "./continuousDownload/videoUrlFetcher";

/**
 * Main service for managing continuous download tasks
 * Orchestrates task creation, management, and processing
 */
export class ContinuousDownloadService {
  private static instance: ContinuousDownloadService;
  private processingTasks: Set<string> = new Set();
  // In-memory cache kept only for incremental (playlist+YouTube+dateDesc) tasks
  private videoUrlCache: Map<string, string[]> = new Map();

  private taskRepository: TaskRepository;
  private videoUrlFetcher: VideoUrlFetcher;
  private taskCleanup: TaskCleanup;
  private taskProcessor: TaskProcessor;

  private constructor() {
    this.taskRepository = new TaskRepository();
    this.videoUrlFetcher = new VideoUrlFetcher();
    this.taskCleanup = new TaskCleanup(this.videoUrlFetcher);
    this.taskProcessor = new TaskProcessor(
      this.taskRepository,
      this.videoUrlFetcher
    );
  }

  public static getInstance(): ContinuousDownloadService {
    if (!ContinuousDownloadService.instance) {
      ContinuousDownloadService.instance = new ContinuousDownloadService();
    }
    return ContinuousDownloadService.instance;
  }

  /**
   * Create a new continuous download task
   */
  async createTask(
    authorUrl: string,
    author: string,
    platform: string,
    subscriptionId?: string,
    downloadOrder: DownloadOrder = "dateDesc"
  ): Promise<ContinuousDownloadTask> {
    const task: ContinuousDownloadTask = {
      id: uuidv4(),
      subscriptionId,
      authorUrl,
      author,
      platform,
      status: "active",
      totalVideos: 0,
      downloadedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      currentVideoIndex: 0,
      createdAt: Date.now(),
      downloadOrder,
    };

    await this.taskRepository.createTask(task);

    // Start processing the task asynchronously
    this.processTask(task.id).catch((error) => {
      logger.error(`Error processing task ${task.id}:`, error);
    });

    return task;
  }

  /**
   * Create a new continuous download task for a playlist
   */
  async createPlaylistTask(
    playlistUrl: string,
    author: string,
    platform: string,
    collectionId: string | null | undefined
  ): Promise<ContinuousDownloadTask> {
    const task: ContinuousDownloadTask = {
      id: uuidv4(),
      collectionId: collectionId || undefined,
      authorUrl: playlistUrl,
      author,
      platform,
      status: "active",
      totalVideos: 0,
      downloadedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      currentVideoIndex: 0,
      createdAt: Date.now(),
      downloadOrder: "dateDesc",
    };

    await this.taskRepository.createTask(task);
    logger.info(
      `Created playlist download task ${task.id}${
        collectionId ? ` for collection ${collectionId}` : ""
      } (${platform})`
    );

    // Start processing the task asynchronously
    this.processTask(task.id).catch((error) => {
      logger.error(`Error processing task ${task.id}:`, error);
    });

    return task;
  }

  /**
   * Get all tasks
   */
  async getAllTasks(): Promise<ContinuousDownloadTask[]> {
    return this.taskRepository.getAllTasks();
  }

  /**
   * Get a task by ID
   */
  async getTaskById(id: string): Promise<ContinuousDownloadTask | null> {
    return this.taskRepository.getTaskById(id);
  }

  /**
   * Get a task by authorUrl (playlist URL)
   */
  async getTaskByAuthorUrl(
    authorUrl: string
  ): Promise<ContinuousDownloadTask | null> {
    return this.taskRepository.getTaskByAuthorUrl(authorUrl);
  }

  /**
   * Cancel a task
   */
  async cancelTask(id: string): Promise<void> {
    const task = await this.getTaskById(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.status === "completed" || task.status === "cancelled") {
      return; // Already completed or cancelled
    }

    // Mark as cancelled FIRST so status checks stop processing immediately
    await this.taskRepository.cancelTask(id);

    // Remove from processing set to stop any ongoing processing immediately
    this.processingTasks.delete(id);

    // Cancel all active downloads that might belong to this task
    try {
      const { getDownloadStatus } = await import("../services/storageService");
      const downloadManager = await import("../services/downloadManager");
      const downloadStatus = getDownloadStatus();
      const activeDownloads = downloadStatus.activeDownloads || [];

      // Prefer frozen list for URL matching; fall back to incremental cache
      let taskVideoUrls: string[] = [];
      if (task.frozenVideoListPath) {
        try {
            const safeFrozenListPath = resolveStoredFrozenListPath(
              task.frozenVideoListPath
            );
            const raw = readUtf8FileSync(safeFrozenListPath, [getFrozenListsRoot()]);
            taskVideoUrls = JSON.parse(raw) as string[];
        } catch (err) {
          logger.debug(`Could not load frozen list for task ${id} cancellation:`, err);
        }
      }

      if (taskVideoUrls.length === 0) {
        const cacheKey = `${id}:${task.authorUrl}`;
        if (this.videoUrlCache.has(cacheKey)) {
          taskVideoUrls = this.videoUrlCache.get(cacheKey) || [];
        }
      }

      if (taskVideoUrls.length === 0) {
        // Best-effort fallback for incremental tasks when no frozen list/cache exists.
        const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
        const isPlaylist = playlistRegex.test(task.authorUrl);
        if (task.platform === "YouTube" && isPlaylist) {
          try {
            taskVideoUrls = await this.videoUrlFetcher.getVideoUrlsIncremental(
              task.authorUrl,
              task.platform,
              0,
              200
            );
          } catch (err) {
            logger.debug(
              `Could not fetch incremental URLs for task ${id} cancellation:`,
              err
            );
          }
        }
      }

      // Cancel any active downloads whose sourceUrl matches this task's videos
      for (const download of activeDownloads) {
        if (download.sourceUrl && taskVideoUrls.includes(download.sourceUrl)) {
          logger.info(
            `Cancelling active download ${download.id} for cancelled task ${id}`
          );
          downloadManager.default.cancelDownload(download.id);
        }
      }
    } catch (error) {
      logger.error(`Error cancelling active downloads for task ${id}:`, error);
    }

    // Clean up temporary files for the current video being downloaded
    try {
      await this.taskCleanup.cleanupCurrentVideoTempFiles(task);
    } catch (error) {
      logger.error(`Error cleaning up temp files for task ${id}:`, error);
    }

    // Clear incremental cache
    const cacheKey = `${id}:${task.authorUrl}`;
    this.videoUrlCache.delete(cacheKey);

    // Delete frozen list file if present
    await this.deleteFrozenList(task);

    logger.info(`Task ${id} cancelled successfully`);
  }

  /**
   * Pause a task
   */
  async pauseTask(id: string): Promise<void> {
    const task = await this.getTaskById(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.status !== "active") {
      throw new Error(`Task ${id} is not active (status: ${task.status})`);
    }

    await this.taskRepository.pauseTask(id);
  }

  /**
   * Resume a task
   */
  async resumeTask(id: string): Promise<void> {
    const task = await this.getTaskById(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.status !== "paused") {
      throw new Error(`Task ${id} is not paused (status: ${task.status})`);
    }

    await this.taskRepository.resumeTask(id);

    // Resume processing
    this.processTask(id).catch((error) => {
      logger.error(`Error resuming task ${id}:`, error);
    });
  }

  /**
   * Delete a task (remove from database)
   */
  async deleteTask(id: string): Promise<void> {
    const task = await this.getTaskById(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    // Clear incremental cache and frozen list
    const cacheKey = `${id}:${task.authorUrl}`;
    this.videoUrlCache.delete(cacheKey);
    await this.deleteFrozenList(task);

    await this.taskRepository.deleteTask(id);
  }

  /**
   * Clear all finished tasks (completed or cancelled)
   */
  async clearFinishedTasks(): Promise<void> {
    const tasks = await this.getAllTasks();
    const finishedTasks = tasks.filter(
      (task) => task.status === "completed" || task.status === "cancelled"
    );

    logger.info(`Clearing ${finishedTasks.length} finished tasks`);

    for (const task of finishedTasks) {
      try {
        await this.deleteTask(task.id);
      } catch (error) {
        logger.error(`Error deleting task ${task.id} during cleanup:`, error);
      }
    }
  }

  /**
   * Process a continuous download task.
   * Owns the mode-decision matrix and URL-list loading before calling TaskProcessor.
   */
  private async processTask(taskId: string): Promise<void> {
    if (this.processingTasks.has(taskId)) {
      logger.debug(`Task ${taskId} is already being processed`);
      return;
    }

    this.processingTasks.add(taskId);

    try {
      const task = await this.getTaskById(taskId);
      if (!task) {
        logger.error(`Task ${taskId} not found`);
        return;
      }

      if (task.status !== "active") {
        logger.debug(`Task ${taskId} is not active, skipping`);
        return;
      }

      // Mode decision: incremental fast path only for YouTube playlist + dateDesc
      const effectiveOrder: DownloadOrder = task.downloadOrder ?? "dateDesc";
      const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
      const isPlaylist = playlistRegex.test(task.authorUrl);
      const useIncremental = isPlaylist && task.platform === "YouTube" && effectiveOrder === "dateDesc";

      let cachedVideoUrls: string[] | undefined;

      if (useIncremental) {
        // Incremental path: no frozen list needed
        cachedVideoUrls = undefined;
      } else {
        // Full-fetch path: load or build frozen list
        if (task.frozenVideoListPath) {
          // Resume: load existing frozen list
          try {
            const safeFrozenListPath = resolveStoredFrozenListPath(
              task.frozenVideoListPath
            );
            const raw = readUtf8FileSync(safeFrozenListPath, [getFrozenListsRoot()]);
            cachedVideoUrls = JSON.parse(raw) as string[];
            logger.info(`Loaded frozen list (${cachedVideoUrls.length} URLs) for task ${taskId}`);
          } catch (err) {
            logger.warn(`Failed to read frozen list for task ${taskId}, will re-fetch:`, err);
            cachedVideoUrls = undefined;
          }
        }

        if (!cachedVideoUrls) {
          // Fetch, sort, and freeze
          logger.info(`Fetching video entries for task ${taskId} (order: ${effectiveOrder})`);
          const entries = await this.videoUrlFetcher.getAllVideoEntries(task.authorUrl, task.platform);
          const sorted = sortVideoEntries(entries, effectiveOrder);
          cachedVideoUrls = sorted.map((e) => e.url);

          // Persist frozen list
          try {
            ensureDirSync(getFrozenListsRoot(), getFrozenListsRoot());
            const frozenPath = buildFrozenListPath(taskId);
            writeUtf8FileSync(frozenPath, JSON.stringify(cachedVideoUrls), [
              getFrozenListsRoot(),
            ]);
            await this.taskRepository.updateFrozenVideoListPath(taskId, frozenPath);
            // Update total from frozen list (source of truth)
            await this.taskRepository.updateTotalVideos(taskId, cachedVideoUrls.length);
            logger.info(`Wrote frozen list (${cachedVideoUrls.length} URLs) for task ${taskId}`);
          } catch (err) {
            logger.warn(`Failed to persist frozen list for task ${taskId}:`, err);
            // Continue without frozen list — will be re-fetched on resume
          }
        }
      }

      await this.taskProcessor.processTask(task, cachedVideoUrls);

      // On natural completion, clean up frozen list
      const finalTask = await this.getTaskById(taskId);
      if (finalTask && (finalTask.status === "completed" || finalTask.status === "cancelled")) {
        await this.deleteFrozenList(finalTask);
      }

      // Clear incremental cache
      const cacheKey = `${taskId}:${task.authorUrl}`;
      this.videoUrlCache.delete(cacheKey);
    } catch (error) {
      logger.error(`Error processing task ${taskId}:`, error);
      await this.taskRepository.cancelTaskWithError(
        taskId,
        error instanceof Error ? error.message : String(error)
      );

      // Clean up on error
      const task = await this.getTaskById(taskId);
      if (task) {
        const cacheKey = `${taskId}:${task.authorUrl}`;
        this.videoUrlCache.delete(cacheKey);
        await this.deleteFrozenList(task);
      }
    } finally {
      this.processingTasks.delete(taskId);
    }
  }

  /**
   * Delete the frozen list file for a task and clear the DB column.
   */
  private async deleteFrozenList(task: ContinuousDownloadTask): Promise<void> {
    if (!task.frozenVideoListPath) return;
    try {
      const safeFrozenListPath = resolveStoredFrozenListPath(
        task.frozenVideoListPath
      );
      removeFileSync(safeFrozenListPath, [getFrozenListsRoot()]);
      logger.debug(`Deleted frozen list for task ${task.id}`);
    } catch (err) {
      logger.warn(`Could not delete frozen list file for task ${task.id}:`, err);
    }
    try {
      await this.taskRepository.clearFrozenVideoListPath(task.id);
    } catch (err) {
      logger.warn(`Could not clear frozenVideoListPath in DB for task ${task.id}:`, err);
    }
  }
}

// Export the type for backward compatibility
export type { ContinuousDownloadTask } from "./continuousDownload/types";

export const continuousDownloadService =
  ContinuousDownloadService.getInstance();
