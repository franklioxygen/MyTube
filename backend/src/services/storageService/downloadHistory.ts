import { desc, eq } from "drizzle-orm";
import { DatabaseError } from "../../errors/DownloadErrors";
import { db } from "../../db";
import { downloadHistory } from "../../db/schema";
import { logger } from "../../utils/logger";
import { DownloadHistoryItem } from "./types";

export function addDownloadHistoryItem(item: DownloadHistoryItem): void {
  try {
    db.insert(downloadHistory)
      .values({
        id: item.id,
        title: item.title,
        author: item.author,
        sourceUrl: item.sourceUrl,
        finishedAt: item.finishedAt,
        status: item.status,
        error: item.error,
        videoPath: item.videoPath,
        thumbnailPath: item.thumbnailPath,
        totalSize: item.totalSize,
        videoId: item.videoId,
        downloadedAt: item.downloadedAt,
        deletedAt: item.deletedAt,
        subscriptionId: item.subscriptionId,
        taskId: item.taskId,
      })
      .run();
  } catch (error) {
    logger.error("Error adding download history item", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download history is non-critical
  }
}

export function getDownloadHistory(): DownloadHistoryItem[] {
  try {
    const history = db
      .select()
      .from(downloadHistory)
      .orderBy(desc(downloadHistory.finishedAt))
      .all();
    return history.map((h) => ({
      ...h,
      status: h.status as "success" | "failed" | "skipped" | "deleted",
      author: h.author || undefined,
      sourceUrl: h.sourceUrl || undefined,
      error: h.error || undefined,
      videoPath: h.videoPath || undefined,
      thumbnailPath: h.thumbnailPath || undefined,
      totalSize: h.totalSize || undefined,
      videoId: h.videoId || undefined,
      downloadedAt: h.downloadedAt || undefined,
      deletedAt: h.deletedAt || undefined,
      subscriptionId: h.subscriptionId || undefined,
      taskId: h.taskId || undefined,
    }));
  } catch (error) {
    logger.error("Error getting download history", error instanceof Error ? error : new Error(String(error)));
    // Return empty array for backward compatibility
    return [];
  }
}

export function removeDownloadHistoryItem(id: string): void {
  try {
    db.delete(downloadHistory).where(eq(downloadHistory.id, id)).run();
  } catch (error) {
    logger.error("Error removing download history item", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download history operations are non-critical
  }
}

export function clearDownloadHistory(): void {
  try {
    db.delete(downloadHistory).run();
  } catch (error) {
    logger.error("Error clearing download history", error instanceof Error ? error : new Error(String(error)));
    throw new DatabaseError(
      "Failed to clear download history",
      error instanceof Error ? error : new Error(String(error)),
      "clearDownloadHistory"
    );
  }
}
