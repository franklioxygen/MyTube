import { eq } from "drizzle-orm";
import { db } from "../../db";
import { continuousDownloadTasks } from "../../db/schema";
import { logger } from "../../utils/logger";
import { ContinuousDownloadTask } from "./types";

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

    // Convert null to undefined for TypeScript compatibility and ensure status type
    return result.map(({ task, playlistName }) => ({
      ...task,
      subscriptionId: task.subscriptionId ?? undefined,
      collectionId: task.collectionId ?? undefined,
      playlistName: playlistName ?? undefined,
      updatedAt: task.updatedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
      error: task.error ?? undefined,
      status: task.status as "active" | "paused" | "completed" | "cancelled",
      totalVideos: task.totalVideos ?? 0,
      downloadedCount: task.downloadedCount ?? 0,
      skippedCount: task.skippedCount ?? 0,
      failedCount: task.failedCount ?? 0,
      currentVideoIndex: task.currentVideoIndex ?? 0,
    }));
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

    // Convert null to undefined for TypeScript compatibility and ensure status type
    return {
      ...task,
      subscriptionId: task.subscriptionId ?? undefined,
      collectionId: task.collectionId ?? undefined,
      playlistName: playlistName ?? undefined,
      updatedAt: task.updatedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
      error: task.error ?? undefined,
      status: task.status as "active" | "paused" | "completed" | "cancelled",
      totalVideos: task.totalVideos ?? 0,
      downloadedCount: task.downloadedCount ?? 0,
      skippedCount: task.skippedCount ?? 0,
      failedCount: task.failedCount ?? 0,
      currentVideoIndex: task.currentVideoIndex ?? 0,
    };
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

    // Convert null to undefined for TypeScript compatibility and ensure status type
    return {
      ...task,
      subscriptionId: task.subscriptionId ?? undefined,
      collectionId: task.collectionId ?? undefined,
      playlistName: playlistName ?? undefined,
      updatedAt: task.updatedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
      error: task.error ?? undefined,
      status: task.status as "active" | "paused" | "completed" | "cancelled",
      totalVideos: task.totalVideos ?? 0,
      downloadedCount: task.downloadedCount ?? 0,
      skippedCount: task.skippedCount ?? 0,
      failedCount: task.failedCount ?? 0,
      currentVideoIndex: task.currentVideoIndex ?? 0,
    };
  }
}

