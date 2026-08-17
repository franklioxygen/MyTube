import path from "path";
import { v4 as uuidv4 } from "uuid";
import { DATA_DIR } from "../config/paths";
import { DuplicateError, ValidationError } from "../errors/DownloadErrors";
import {
  ensureDirSafeSync,
  readFileSafeSync,
  resolveSafeChildPath,
  resolveSafePath,
  unlinkSafeSync,
  writeFileSafeSync,
} from "../utils/security";
import { logger } from "../utils/logger";
import { TaskCleanup } from "./continuousDownload/taskCleanup";
import { TaskProcessor } from "./continuousDownload/taskProcessor";
import { TaskRepository } from "./continuousDownload/taskRepository";
import type {
  ContinuousDownloadTask,
  DownloadOrder,
  OrderingMetadataWarning,
} from "./continuousDownload/types";
import {
  createFrozenDownloadPlanV2,
  getFrozenPlanUrls,
  parseFrozenDownloadPlan,
  validateFrozenPlanForTask,
} from "./continuousDownload/frozenDownloadPlan";
import {
  OrderingPlanInvalidError,
  OrderingPlanPersistError,
  createPlanningFailureFromError,
  parseOrderingPlanningFailure,
  serializeOrderingPlanningFailure,
} from "./continuousDownload/planningErrors";
import {
  isYouTubeUploadsPlaylistId,
  requiredMetadataMissingForAll,
  sortVideoEntries,
  VideoUrlFetcher,
  YOUTUBE_PLAYLIST_ID_REGEX,
} from "./continuousDownload/videoUrlFetcher";

const FROZEN_LISTS_DIR = path.join(DATA_DIR, "frozen-lists");
const SAFE_FROZEN_LIST_TASK_ID = /^[A-Za-z0-9_-]+$/;
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
    this.taskCleanup = new TaskCleanup();
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
   * Resolve the per-subscription yt-dlp override for a task (issue #345).
   * Returns null when the task has no resolvable subscription, so callers see
   * identical behaviour to the global-config-only path. Failures are logged and
   * treated as "no override" so listing still proceeds with the global config.
   */
  private async resolveSubscriptionYtdlpConfig(
    task: ContinuousDownloadTask
  ): Promise<string | null> {
    try {
      const subscription =
        await this.taskRepository.getSubscriptionForTask(task);
      return subscription?.ytdlpConfig ?? null;
    } catch (error) {
      logger.warn(
        `Unable to resolve subscription yt-dlp override for task ${task.id}; using global config`,
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  private getFrozenListsRoot(): string {
    return resolveSafePath(FROZEN_LISTS_DIR, DATA_DIR);
  }

  private buildFrozenListPath(taskId: string): string {
    const normalizedTaskId = String(taskId).trim();
    if (!SAFE_FROZEN_LIST_TASK_ID.test(normalizedTaskId)) {
      throw new Error(`Invalid task id for frozen list path: ${taskId}`);
    }

    return resolveSafeChildPath(
      this.getFrozenListsRoot(),
      `${normalizedTaskId}.json`
    );
  }

  private resolveStoredFrozenListPath(rawPath: string): string {
    const resolvedPath = resolveSafePath(rawPath, this.getFrozenListsRoot());

    const fileName = path.basename(resolvedPath);
    if (!fileName.endsWith(".json")) {
      throw new Error(`Frozen list file must be a .json file: ${rawPath}`);
    }

    const taskIdFromFileName = fileName.slice(0, -".json".length);
    if (!SAFE_FROZEN_LIST_TASK_ID.test(taskIdFromFileName)) {
      throw new Error(`Frozen list file name is invalid: ${rawPath}`);
    }

    return resolvedPath;
  }

  private readFrozenPlanUrls(
    task: ContinuousDownloadTask,
    effectiveOrder?: DownloadOrder
  ): string[] | undefined {
    if (!task.frozenVideoListPath) {
      return undefined;
    }

    const safeFrozenListPath = this.resolveStoredFrozenListPath(
      task.frozenVideoListPath
    );
    const raw = readFileSafeSync(
      safeFrozenListPath,
      this.getFrozenListsRoot(),
      "utf8"
    );
    const plan = parseFrozenDownloadPlan(raw);

    if (!effectiveOrder) {
      return getFrozenPlanUrls(plan);
    }

    if (
      plan.version === 1 &&
      task.currentVideoIndex === 0 &&
      effectiveOrder !== "dateDesc"
    ) {
      logger.warn(
        `Ignoring legacy frozen URL list for unstarted task ${task.id}; rebuilding ${effectiveOrder} plan`
      );
      return undefined;
    }

    if (!validateFrozenPlanForTask(plan, task, effectiveOrder)) {
      if (task.currentVideoIndex === 0) {
        logger.warn(
          `Ignoring mismatched frozen plan for unstarted task ${task.id}; rebuilding`
        );
        return undefined;
      }
      throw new Error(
        `Frozen download plan for task ${task.id} does not match the task source/order`
      );
    }

    return getFrozenPlanUrls(plan);
  }

  private readFrozenPlanWarnings(
    task: ContinuousDownloadTask
  ): OrderingMetadataWarning[] | undefined {
    if (!task.frozenVideoListPath) {
      return undefined;
    }

    try {
      const safeFrozenListPath = this.resolveStoredFrozenListPath(
        task.frozenVideoListPath
      );
      const raw = readFileSafeSync(
        safeFrozenListPath,
        this.getFrozenListsRoot(),
        "utf8"
      );
      const plan = parseFrozenDownloadPlan(raw);

      if (plan.version !== 2 || plan.warnings.length === 0) {
        return undefined;
      }

      if (!validateFrozenPlanForTask(plan, task, plan.downloadOrder)) {
        return undefined;
      }

      const isDateOrder =
        plan.downloadOrder === "dateAsc" || plan.downloadOrder === "dateDesc";
      const knownCount = isDateOrder
        ? plan.metadataStats.knownDates
        : plan.metadataStats.knownViewCounts;
      const unknownCount = isDateOrder
        ? plan.metadataStats.unknownDates
        : plan.metadataStats.unknownViewCounts;

      return plan.warnings.map((message) => ({
        code: "ORDERING_METADATA_PARTIAL",
        message,
        knownCount,
        unknownCount,
      }));
    } catch (error) {
      logger.warn(
        `Could not read ordering warnings for task ${task.id}:`,
        error
      );
      return undefined;
    }
  }

  private attachFrozenPlanWarnings(
    task: ContinuousDownloadTask
  ): ContinuousDownloadTask {
    const orderingWarnings = this.readFrozenPlanWarnings(task);
    return orderingWarnings ? { ...task, orderingWarnings } : task;
  }

  private buildOrderingWarnings(
    entries: Array<{ publishedAtMs: number | null; viewCount: number | null }>,
    order: DownloadOrder
  ): string[] {
    const missingCount =
      order === "dateAsc" || order === "dateDesc"
        ? entries.filter((entry) => entry.publishedAtMs === null).length
        : entries.filter((entry) => entry.viewCount === null).length;

    if (missingCount === 0) {
      return [];
    }

    const field =
      order === "dateAsc" || order === "dateDesc"
        ? "publication dates"
        : "view counts";
    return [
      `${missingCount} of ${entries.length} videos lacked ${field} and were placed after videos with known metadata.`,
    ];
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
   * Create a new continuous download task for a playlist.
   *
   * `subscriptionId` (design §7.4) is persisted when provided so a historical
   * backfill task created alongside a subscription is linked to the exact
   * subscription whose metadata (e.g. filename template / yt-dlp override) it
   * must use. Existing standalone callers that omit it remain valid.
   */
  async createPlaylistTask(
    playlistUrl: string,
    author: string,
    platform: string,
    collectionId: string | null | undefined,
    subscriptionId?: string,
    downloadOrder: DownloadOrder = "dateDesc"
  ): Promise<ContinuousDownloadTask> {
    const task: ContinuousDownloadTask = {
      id: uuidv4(),
      collectionId: collectionId || undefined,
      subscriptionId,
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
      downloadOrder,
    };

    await this.taskRepository.createTask(task);
    logger.info(
      `Created playlist download task ${task.id}${
        collectionId ? ` for collection ${collectionId}` : ""
      } (${platform})${subscriptionId ? ` linked to subscription ${subscriptionId}` : ""}`
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
    const tasks = await this.taskRepository.getAllTasks();
    return tasks.map((task) => this.attachFrozenPlanWarnings(task));
  }

  /**
   * Get a task by ID
   */
  async getTaskById(id: string): Promise<ContinuousDownloadTask | null> {
    const task = await this.taskRepository.getTaskById(id);
    return task ? this.attachFrozenPlanWarnings(task) : null;
  }

  /**
   * Get a task by authorUrl (playlist URL)
   */
  async getTaskByAuthorUrl(
    authorUrl: string
  ): Promise<ContinuousDownloadTask | null> {
    return this.taskRepository.getTaskByAuthorUrl(authorUrl);
  }

  async getBlockingPlaylistTaskByDestination(
    authorUrl: string,
    subscriptionId: string,
    collectionId: string
  ): Promise<ContinuousDownloadTask | null> {
    return this.taskRepository.getBlockingPlaylistTaskByDestination(
      authorUrl,
      subscriptionId,
      collectionId
    );
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

    // Signal the running loop (if any) so it observes the cancellation without
    // waiting for its next throttled DB status read.
    this.taskProcessor.signalInterruption(id);

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
          taskVideoUrls = this.readFrozenPlanUrls(task) ?? [];
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
            const subscriptionYtdlpConfig =
              await this.resolveSubscriptionYtdlpConfig(task);
            taskVideoUrls = await this.videoUrlFetcher.getVideoUrlsIncremental(
              task.authorUrl,
              task.platform,
              0,
              200,
              subscriptionYtdlpConfig
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
          await downloadManager.default.cancelDownload(download.id);
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

    // Signal the running loop so it observes the pause promptly.
    this.taskProcessor.signalInterruption(id);
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

    // Drop any stale pause/cancel signal from a just-paused run *after* the DB is
    // back to "active", so if the previous loop is still draining it observes the
    // resumed status (via shouldStopForInterruption) and keeps going instead of
    // leaving an active task with no worker. processTask's existing-worker guard
    // then no-ops harmlessly when that loop is still registered.
    this.taskProcessor.clearInterruption(id);

    // Resume processing
    this.processTask(id).catch((error) => {
      logger.error(`Error resuming task ${id}:`, error);
    });
  }

  /**
   * Waits for a task's worker to leave processingTasks. Returns false if it is
   * still running when the budget expires.
   */
  private async waitForTaskToDrain(
    id: string,
    timeoutMs = 2000,
    pollMs = 25
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.processingTasks.has(id)) {
      if (Date.now() >= deadline) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return true;
  }

  async retryPlanning(
    id: string,
    // Exposed so tests can exercise the drain race without waiting the full
    // budget; callers use the defaults.
    drainTimeoutMs = 2000,
    drainPollMs = 25
  ): Promise<ContinuousDownloadTask> {
    const task = await this.getTaskById(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    const planningError = parseOrderingPlanningFailure(task.error);
    if (!planningError || !planningError.retryable) {
      throw new ValidationError(
        "Task does not have a retryable ordering preparation error.",
        "id"
      );
    }

    if (task.status !== "cancelled") {
      throw new ValidationError(
        `Task ${id} must be cancelled before retrying order preparation.`,
        "id"
      );
    }

    if (
      task.downloadedCount !== 0 ||
      task.skippedCount !== 0 ||
      task.failedCount !== 0 ||
      task.currentVideoIndex !== 0
    ) {
      throw new ValidationError(
        "Order preparation can only be retried before any task progress exists.",
        "id"
      );
    }

    // The worker that failed planning clears processingTasks in its finally,
    // which runs after the cancelled-with-error state the client reacts to is
    // already visible. Returning the unchanged cancelled task here would report
    // a retry that never activated, and the worker would then exit and leave the
    // task cancelled forever. Give it a moment to drain, then refuse with a
    // conflict the client can retry rather than claiming success.
    if (
      this.processingTasks.has(id) &&
      !(await this.waitForTaskToDrain(id, drainTimeoutMs, drainPollMs))
    ) {
      throw new DuplicateError(
        "Order preparation retry",
        `Task ${id} is still finishing its previous order preparation attempt. Retry in a moment.`
      );
    }

    await this.deleteFrozenList(task);
    await this.taskRepository.activateTaskForPlanningRetry(id);
    this.taskProcessor.clearInterruption(id);

    this.processTask(id).catch((error) => {
      logger.error(`Error retrying order preparation for task ${id}:`, error);
    });

    const retriedTask = await this.getTaskById(id);
    if (!retriedTask) {
      throw new Error(`Task ${id} not found after retry`);
    }
    return retriedTask;
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

      // Mode decision: the incremental fast path is only safe for a YouTube
      // channel-uploads playlist processed newest-first, because that is the one
      // `list=` source whose raw order is guaranteed to match dateDesc without
      // hydrating publication dates. A manually-ordered playlist selected as
      // dateDesc must instead go through the sorted frozen-plan path, otherwise
      // it would download in playlist order and receive playlist-index filename
      // fields in the wrong order.
      const effectiveOrder: DownloadOrder = task.downloadOrder ?? "dateDesc";
      const playlistMatch = task.authorUrl.match(YOUTUBE_PLAYLIST_ID_REGEX);
      const isYouTubePlaylistDateDesc =
        playlistMatch !== null &&
        task.platform === "YouTube" &&
        effectiveOrder === "dateDesc";
      const isUploadsPlaylist =
        playlistMatch !== null && isYouTubeUploadsPlaylistId(playlistMatch[1]);
      // Migration guard: a non-uploads playlist that is already mid-flight —
      // numeric progress but no frozen plan — was created before this ordering
      // change and has been running incrementally in raw playlist order.
      // Switching it to a freshly date-sorted plan now would leave TaskProcessor
      // resuming from `currentVideoIndex`, an index into the *old* order, so it
      // would silently skip some videos and re-download others. Keep such
      // in-flight tasks on the legacy incremental path; only fresh (unprogressed
      // or already-frozen) tasks adopt the sorted plan.
      const isInProgressLegacyIncremental =
        isYouTubePlaylistDateDesc &&
        task.currentVideoIndex > 0 &&
        !task.frozenVideoListPath;
      const useIncremental =
        isYouTubePlaylistDateDesc &&
        (isUploadsPlaylist || isInProgressLegacyIncremental);

      let cachedVideoUrls: string[] | undefined;

      if (useIncremental) {
        // Incremental path: no frozen list needed
        cachedVideoUrls = undefined;
      } else {
        // Full-fetch path: load or build frozen list
        if (task.frozenVideoListPath) {
          // Resume: load existing frozen list
          try {
            cachedVideoUrls = this.readFrozenPlanUrls(task, effectiveOrder);
            if (cachedVideoUrls) {
              logger.info(`Loaded frozen list (${cachedVideoUrls.length} URLs) for task ${taskId}`);
            }
          } catch (err) {
            if (task.currentVideoIndex > 0) {
              throw err instanceof OrderingPlanInvalidError
                ? err
                : new OrderingPlanInvalidError(
                    task,
                    `Failed to read frozen download plan for task ${taskId}: ${
                      err instanceof Error ? err.message : String(err)
                    }`
                  );
            }
            logger.warn(`Failed to read frozen list for task ${taskId}, will re-fetch:`, err);
            cachedVideoUrls = undefined;
          }
        }

        if (!cachedVideoUrls) {
          // Fetch, sort, and freeze. Resolve the per-subscription yt-dlp
          // override first so proxy/rate-limit overrides needed to enumerate
          // the source apply to this listing probe, not just the eventual
          // per-video download (issue #345).
          const subscriptionYtdlpConfig =
            await this.resolveSubscriptionYtdlpConfig(task);
          logger.info(`Fetching video entries for task ${taskId} (order: ${effectiveOrder})`);
          const { entries, listingOrder } =
            await this.videoUrlFetcher.getAllVideoEntries(
              task.authorUrl,
              task.platform,
              subscriptionYtdlpConfig,
              effectiveOrder
            );
          // Captured before sorting: the sort consumes this to decide whether
          // it can fall back to listing order instead of failing.
          const usedListingOrderFallback = requiredMetadataMissingForAll(
            entries,
            effectiveOrder
          );
          const sorted = sortVideoEntries(
            entries,
            effectiveOrder,
            task.platform,
            listingOrder
          );
          cachedVideoUrls = sorted.map((e) => e.url);
          const frozenPlan = createFrozenDownloadPlanV2({
            task,
            downloadOrder: effectiveOrder,
            entries: sorted,
            warnings: usedListingOrderFallback
              ? [
                  `No publication dates could be recovered for any of the ${sorted.length} videos, so they were ordered by the source's own newest-first listing instead.`,
                ]
              : this.buildOrderingWarnings(sorted, effectiveOrder),
          });

          // Persist frozen list
          try {
            ensureDirSafeSync(this.getFrozenListsRoot(), DATA_DIR);
            const frozenPath = this.buildFrozenListPath(taskId);
            writeFileSafeSync(
              frozenPath,
              this.getFrozenListsRoot(),
              JSON.stringify(frozenPlan),
              "utf8"
            );
            await this.taskRepository.updateFrozenVideoListPath(taskId, frozenPath);
            // Update total from frozen list (source of truth)
            await this.taskRepository.updateTotalVideos(taskId, cachedVideoUrls.length);
            logger.info(`Wrote frozen list (${cachedVideoUrls.length} URLs) for task ${taskId}`);
          } catch (err) {
            throw new OrderingPlanPersistError(
              task,
              `Failed to persist frozen download plan for task ${taskId}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
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
      const task = await this.getTaskById(taskId);
      const planningFailure = task
        ? createPlanningFailureFromError(error, task)
        : null;
      await this.taskRepository.cancelTaskWithError(
        taskId,
        planningFailure
          ? serializeOrderingPlanningFailure(planningFailure)
          : error instanceof Error
            ? error.message
            : String(error)
      );

      // Clean up on error
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
      const safeFrozenListPath = this.resolveStoredFrozenListPath(
        task.frozenVideoListPath
      );
      unlinkSafeSync(safeFrozenListPath, this.getFrozenListsRoot());
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
