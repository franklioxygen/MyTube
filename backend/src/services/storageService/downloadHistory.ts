import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { DatabaseError } from "../../errors/DownloadErrors";
import { db } from "../../db";
import { downloadHistory } from "../../db/schema";
import { logger } from "../../utils/logger";
import { DownloadHistoryItem } from "./types";

const PENDING_RETRY_STATUS = "pending_retry";
const PARTIAL_STATUS = "partial";

function mapDownloadHistoryRow(row: typeof downloadHistory.$inferSelect): DownloadHistoryItem {
  return {
    ...row,
    status: row.status as DownloadHistoryItem["status"],
    author: row.author || undefined,
    sourceUrl: row.sourceUrl || undefined,
    error: row.error || undefined,
    videoPath: row.videoPath || undefined,
    thumbnailPath: row.thumbnailPath || undefined,
    totalSize: row.totalSize || undefined,
    videoId: row.videoId || undefined,
    downloadedAt: row.downloadedAt || undefined,
    deletedAt: row.deletedAt || undefined,
    subscriptionId: row.subscriptionId || undefined,
    taskId: row.taskId || undefined,
    platform: row.platform || undefined,
    sourceKind: row.sourceKind || undefined,
    downloadType: row.downloadType || undefined,
    retryCount: row.retryCount ?? undefined,
    retryLimit: row.retryLimit ?? undefined,
    retryIntervalMinutes: row.retryIntervalMinutes ?? undefined,
    nextRetryAt: row.nextRetryAt ?? undefined,
    retryMetadata: row.retryMetadata || undefined,
  };
}

export function addDownloadHistoryItem(item: DownloadHistoryItem): void {
  try {
    const values = {
      id: item.id,
      title: item.title,
      author: item.author ?? null,
      sourceUrl: item.sourceUrl ?? null,
      finishedAt: item.finishedAt,
      status: item.status,
      error: item.error ?? null,
      videoPath: item.videoPath ?? null,
      thumbnailPath: item.thumbnailPath ?? null,
      totalSize: item.totalSize ?? null,
      videoId: item.videoId ?? null,
      downloadedAt: item.downloadedAt ?? null,
      deletedAt: item.deletedAt ?? null,
      subscriptionId: item.subscriptionId ?? null,
      taskId: item.taskId ?? null,
      platform: item.platform ?? null,
      sourceKind: item.sourceKind ?? null,
      downloadType: item.downloadType ?? null,
      retryCount: item.retryCount ?? null,
      retryLimit: item.retryLimit ?? null,
      retryIntervalMinutes: item.retryIntervalMinutes ?? null,
      nextRetryAt: item.nextRetryAt ?? null,
      retryMetadata: item.retryMetadata ?? null,
    } as const;

    db.insert(downloadHistory)
      .values(values)
      .onConflictDoUpdate({
        target: downloadHistory.id,
        set: values,
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
    return history.map(mapDownloadHistoryRow);
  } catch (error) {
    logger.error("Error getting download history", error instanceof Error ? error : new Error(String(error)));
    // Return empty array for backward compatibility
    return [];
  }
}

export function getDownloadHistoryItem(id: string): DownloadHistoryItem | undefined {
  try {
    const item = db
      .select()
      .from(downloadHistory)
      .where(eq(downloadHistory.id, id))
      .get();

    return item ? mapDownloadHistoryRow(item) : undefined;
  } catch (error) {
    logger.error("Error getting download history item", error instanceof Error ? error : new Error(String(error)));
    return undefined;
  }
}

export function getLatestRetryHistoryItemBySourceUrl(
  sourceUrl: string,
  downloadType?: string,
): DownloadHistoryItem | undefined {
  try {
    // Filter in SQL so we only hydrate matching rows: retryMetadata must be
    // present, the status must be retryable, and downloadType is optional.
    const conditions = [
      eq(downloadHistory.sourceUrl, sourceUrl),
      isNotNull(downloadHistory.retryMetadata),
      ne(downloadHistory.retryMetadata, ""),
      inArray(downloadHistory.status, [
        "failed",
        PARTIAL_STATUS,
        PENDING_RETRY_STATUS,
      ]),
    ];
    if (downloadType) {
      conditions.push(eq(downloadHistory.downloadType, downloadType));
    }

    const item = db
      .select()
      .from(downloadHistory)
      .where(and(...conditions))
      .orderBy(desc(downloadHistory.finishedAt))
      .limit(1)
      .get();

    return item ? mapDownloadHistoryRow(item) : undefined;
  } catch (error) {
    logger.error(
      "Error getting latest retry history item by source URL",
      error instanceof Error ? error : new Error(String(error))
    );
    return undefined;
  }
}

export function getPendingRetryHistoryItems(): DownloadHistoryItem[] {
  try {
    const items = db
      .select()
      .from(downloadHistory)
      .where(eq(downloadHistory.status, PENDING_RETRY_STATUS))
      .orderBy(asc(downloadHistory.nextRetryAt))
      .all();

    return items.map(mapDownloadHistoryRow);
  } catch (error) {
    logger.error(
      "Error getting pending retry download history items",
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}

export function removeDownloadHistoryItem(id: string): void {
  try {
    db.delete(downloadHistory)
      .where(
        and(
          eq(downloadHistory.id, id),
          ne(downloadHistory.status, PENDING_RETRY_STATUS)
        )
      )
      .run();
  } catch (error) {
    logger.error("Error removing download history item", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download history operations are non-critical
  }
}

export function finalizePendingRetryHistoryItem(
  id: string,
  errorMessage?: string
): void {
  const item = getDownloadHistoryItem(id);
  if (!item || item.status !== PENDING_RETRY_STATUS) {
    return;
  }

  addDownloadHistoryItem({
    ...item,
    status: "failed",
    error: errorMessage ?? item.error,
    nextRetryAt: undefined,
  });
}

export function markDownloadHistoryDeletedByVideoId(
  videoId: string,
  deletedAt: number = Date.now()
): void {
  try {
    db.update(downloadHistory)
      .set({ status: "deleted", deletedAt })
      .where(
        and(
          eq(downloadHistory.videoId, videoId),
          eq(downloadHistory.status, "success")
        )
      )
      .run();
  } catch (error) {
    logger.error(
      "Error marking download history as deleted",
      error instanceof Error ? error : new Error(String(error))
    );
    // Don't throw - download history operations are non-critical
  }
}

export function clearDownloadHistory(): void {
  try {
    db.delete(downloadHistory)
      .where(ne(downloadHistory.status, PENDING_RETRY_STATUS))
      .run();
  } catch (error) {
    logger.error("Error clearing download history", error instanceof Error ? error : new Error(String(error)));
    throw new DatabaseError(
      "Failed to clear download history",
      error instanceof Error ? error : new Error(String(error)),
      "clearDownloadHistory"
    );
  }
}
