import { eq, type InferSelectModel } from "drizzle-orm";
import { db } from "../../db";
import { continuousDownloadTasks } from "../../db/schema";
import { logger } from "../../utils/logger";
import { ContinuousDownloadTask, type DownloadOrder } from "./types";

type TaskStatus = "active" | "paused" | "completed" | "cancelled";
type ContinuousDownloadTaskRow = InferSelectModel<typeof continuousDownloadTasks>;

const toOptional = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;

const toCount = (value: number | null | undefined): number => value ?? 0;

const toTaskStatus = (value: unknown): TaskStatus =>
  value as TaskStatus;

const toDownloadOrder = (value: unknown): DownloadOrder | undefined => {
  if (
    value === "dateDesc" ||
    value === "dateAsc" ||
    value === "viewsDesc" ||
    value === "viewsAsc"
  ) {
    return value;
  }

  return undefined;
};

const mapTaskRowToEntity = (
  task: ContinuousDownloadTaskRow,
  playlistName: string | null
): ContinuousDownloadTask => ({
  ...task,
  subscriptionId: toOptional(task.subscriptionId),
  collectionId: toOptional(task.collectionId),
  playlistName: toOptional(playlistName),
  updatedAt: toOptional(task.updatedAt),
  completedAt: toOptional(task.completedAt),
  error: toOptional(task.error),
  status: toTaskStatus(task.status),
  totalVideos: toCount(task.totalVideos),
  downloadedCount: toCount(task.downloadedCount),
  skippedCount: toCount(task.skippedCount),
  failedCount: toCount(task.failedCount),
  currentVideoIndex: toCount(task.currentVideoIndex),
  downloadOrder: toDownloadOrder(task.downloadOrder),
  frozenVideoListPath: toOptional(task.frozenVideoListPath),
});

/**
 * Repository for managing continuous download tasks in the database
 */
export class TaskRepository {
  /**
   * Create a new task in the database
   */
  async createTask(task: ContinuousDownloadTask): Promise<void> {
    // Remove playlistName from the insert object as it's not in the table
    const { playlistName, ...taskToInsert } = task;
    await db.insert(continuousDownloadTasks).values(taskToInsert);
    logger.info(
      `Created continuous download task ${task.id} for ${task.author} (${task.platform})`
    );
  }

  /**
   * Get all tasks with optional playlist name from collections
   */
  async getAllTasks(): Promise<ContinuousDownloadTask[]> {
    const { collections } = await import("../../db/schema");
    const result = await db
      .select({
        task: continuousDownloadTasks,
        playlistName: collections.name,
      })
      .from(continuousDownloadTasks)
      .leftJoin(
        collections,
        eq(continuousDownloadTasks.collectionId, collections.id)
      );

    return result.map(({ task, playlistName }) =>
      mapTaskRowToEntity(task, playlistName)
    );
  }

  /**
   * Get a task by ID with optional playlist name from collections
   */
  async getTaskById(id: string): Promise<ContinuousDownloadTask | null> {
    const { collections } = await import("../../db/schema");
    const result = await db
      .select({
        task: continuousDownloadTasks,
        playlistName: collections.name,
      })
      .from(continuousDownloadTasks)
      .leftJoin(
        collections,
        eq(continuousDownloadTasks.collectionId, collections.id)
      )
      .where(eq(continuousDownloadTasks.id, id))
      .limit(1);

    if (result.length === 0) return null;

    const { task, playlistName } = result[0];

    return mapTaskRowToEntity(task, playlistName);
  }

  /**
   * Get task status only (lightweight query for hot polling paths)
   */
  async getTaskStatus(
    id: string
  ): Promise<"active" | "paused" | "completed" | "cancelled" | null> {
    const result = await db
      .select({ status: continuousDownloadTasks.status })
      .from(continuousDownloadTasks)
      .where(eq(continuousDownloadTasks.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return result[0].status as
      | "active"
      | "paused"
      | "completed"
      | "cancelled";
  }

  /**
   * Update task status to cancelled
   */
  async cancelTask(id: string): Promise<void> {
    await db
      .update(continuousDownloadTasks)
      .set({
        status: "cancelled",
        updatedAt: Date.now(),
      })
      .where(eq(continuousDownloadTasks.id, id));
    logger.info(`Cancelled continuous download task ${id}`);
  }

  /**
   * Pause a task
   */
  async pauseTask(id: string): Promise<void> {
    await db
      .update(continuousDownloadTasks)
      .set({
        status: "paused",
        updatedAt: Date.now(),
      })
      .where(eq(continuousDownloadTasks.id, id));
    logger.info(`Paused continuous download task ${id}`);
  }

  /**
   * Resume a task
   */
  async resumeTask(id: string): Promise<void> {
    await db
      .update(continuousDownloadTasks)
      .set({
        status: "active",
        updatedAt: Date.now(),
      })
      .where(eq(continuousDownloadTasks.id, id));
    logger.info(`Resumed continuous download task ${id}`);
  }

  /**
   * Delete a task from the database
   */
  async deleteTask(id: string): Promise<void> {
    await db
      .delete(continuousDownloadTasks)
      .where(eq(continuousDownloadTasks.id, id));
    logger.info(`Deleted continuous download task ${id}`);
  }

  /**
   * Update task's total video count
   */
  async updateTotalVideos(id: string, totalVideos: number): Promise<void> {
    await db
      .update(continuousDownloadTasks)
      .set({
        totalVideos,
        updatedAt: Date.now(),
      })
      .where(eq(continuousDownloadTasks.id, id));
  }

  /**
   * Update task progress (downloaded, skipped, failed counts and current index)
   */
  async updateProgress(
    id: string,
    updates: {
      downloadedCount?: number;
      skippedCount?: number;
      failedCount?: number;
      currentVideoIndex?: number;
    }
  ): Promise<void> {
    await db
      .update(continuousDownloadTasks)
      .set({
        ...updates,
        updatedAt: Date.now(),
      })
      .where(eq(continuousDownloadTasks.id, id));
  }

  /**
   * Mark task as completed
   */
  async completeTask(id: string): Promise<void> {
    await db
      .update(continuousDownloadTasks)
      .set({
        status: "completed",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where(eq(continuousDownloadTasks.id, id));
  }

  /**
   * Mark task as cancelled with error
   */
  async cancelTaskWithError(id: string, error: string): Promise<void> {
    await db
      .update(continuousDownloadTasks)
      .set({
        status: "cancelled",
        error,
        updatedAt: Date.now(),
      })
      .where(eq(continuousDownloadTasks.id, id));
  }

  /**
   * Get a task by authorUrl (playlist URL) with optional playlist name from collections
   */
  async getTaskByAuthorUrl(authorUrl: string): Promise<ContinuousDownloadTask | null> {
    const { collections } = await import("../../db/schema");
    const result = await db
      .select({
        task: continuousDownloadTasks,
        playlistName: collections.name,
      })
      .from(continuousDownloadTasks)
      .leftJoin(
        collections,
        eq(continuousDownloadTasks.collectionId, collections.id)
      )
      .where(eq(continuousDownloadTasks.authorUrl, authorUrl))
      .limit(1);

    if (result.length === 0) return null;

    const { task, playlistName } = result[0];

    return mapTaskRowToEntity(task, playlistName);
  }

  /**
   * Persist the frozen video list path for a task
   */
  async updateFrozenVideoListPath(id: string, path: string): Promise<void> {
    await db
      .update(continuousDownloadTasks)
      .set({ frozenVideoListPath: path, updatedAt: Date.now() })
      .where(eq(continuousDownloadTasks.id, id));
  }

  /**
   * Clear the frozen video list path (called after file deletion on terminal state)
   */
  async clearFrozenVideoListPath(id: string): Promise<void> {
    await db
      .update(continuousDownloadTasks)
      .set({ frozenVideoListPath: null, updatedAt: Date.now() })
      .where(eq(continuousDownloadTasks.id, id));
  }
}
