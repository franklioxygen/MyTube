import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { TaskCleanup } from "./continuousDownload/taskCleanup";
import { TaskProcessor } from "./continuousDownload/taskProcessor";
import { TaskRepository } from "./continuousDownload/taskRepository";
import { ContinuousDownloadTask } from "./continuousDownload/types";
import { VideoUrlFetcher } from "./continuousDownload/videoUrlFetcher";

/**
 * Main service for managing continuous download tasks
 * Orchestrates task creation, management, and processing
 */
export class ContinuousDownloadService {
  private static instance: ContinuousDownloadService;
  private processingTasks: Set<string> = new Set();
  // Cache video URLs for tasks to avoid re-fetching large playlists
  // Uses Map to store cached URLs, cleared when tasks are deleted
  private videoUrlCache: Map<string, string[]> = new Map();
  // Note: incrementalFetchTasks tracking was removed - we determine incrementality
  // dynamically based on URL pattern (playlist + YouTube) in processTask()

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
    subscriptionId?: string
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
    collectionId: string
  ): Promise<ContinuousDownloadTask> {
    const task: ContinuousDownloadTask = {
      id: uuidv4(),
      collectionId,
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
    };

    await this.taskRepository.createTask(task);
    logger.info(
      `Created playlist download task ${task.id} for collection ${collectionId} (${platform})`
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

    // Clean up temporary files for the current video being downloaded
    try {
      await this.taskCleanup.cleanupCurrentVideoTempFiles(task);
    } catch (error) {
      logger.error(`Error cleaning up temp files for task ${id}:`, error);
      // Continue with cancellation even if cleanup fails
    }

    // Clear cached video URLs for this task
    const cacheKey = `${id}:${task.authorUrl}`;
    this.videoUrlCache.delete(cacheKey);

    await this.taskRepository.cancelTask(id);
  }

  /**
   * Delete a task (remove from database)
   */
  async deleteTask(id: string): Promise<void> {
    const task = await this.getTaskById(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    // Clear cached video URLs for this task
    const cacheKey = `${id}:${task.authorUrl}`;
    this.videoUrlCache.delete(cacheKey);

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
   * Process a continuous download task
   */
  private async processTask(taskId: string): Promise<void> {
    // Prevent concurrent processing of the same task
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

      // For non-incremental mode, cache video URLs
      const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
      const isPlaylist = playlistRegex.test(task.authorUrl);
      const useIncremental = isPlaylist && task.platform === "YouTube";

      let cachedVideoUrls: string[] | undefined;
      if (!useIncremental) {
        // Cache video URLs for non-incremental tasks
        const cacheKey = `${taskId}:${task.authorUrl}`;
        if (!this.videoUrlCache.has(cacheKey)) {
          const videoUrls = await this.videoUrlFetcher.getAllVideoUrls(
            task.authorUrl,
            task.platform
          );
          this.videoUrlCache.set(cacheKey, videoUrls);
        }
        cachedVideoUrls = this.videoUrlCache.get(cacheKey);
      }

      // Process the task
      await this.taskProcessor.processTask(task, cachedVideoUrls);

      // Clear cached video URLs to free memory
      const finalTask = await this.getTaskById(taskId);
      if (finalTask) {
        const cacheKey = `${taskId}:${finalTask.authorUrl}`;
        this.videoUrlCache.delete(cacheKey);
      }
    } catch (error) {
      logger.error(`Error processing task ${taskId}:`, error);
      await this.taskRepository.cancelTaskWithError(
        taskId,
        error instanceof Error ? error.message : String(error)
      );

      // Clear cached video URLs on error to free memory
      const task = await this.getTaskById(taskId);
      if (task) {
        const cacheKey = `${taskId}:${task.authorUrl}`;
        this.videoUrlCache.delete(cacheKey);
      }
    } finally {
      this.processingTasks.delete(taskId);
    }
  }
}

// Export the type for backward compatibility
export type { ContinuousDownloadTask } from "./continuousDownload/types";

export const continuousDownloadService =
  ContinuousDownloadService.getInstance();
