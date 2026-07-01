import { sanitizeLogMessage } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import { createDownloadTask } from "../downloadService";
import {
  canRestoreDetachedTask,
  parseRetryMetadata,
  requiresRetryMetadata,
  serializeRetryMetadata,
  type DownloadRetryMetadata,
} from "../downloadRetryMetadata";
import {
  normalizeAutoRetryIntervalMinutes,
  normalizeAutoRetryTimes,
  PENDING_RETRY_STATUS,
} from "./retryPolicy";
import { platformFromUrl } from "../statistics";
import type { DownloadHistoryItem } from "../storageService";
import type { DownloadTask } from "./types";

export const BILIBILI_RETRY_RESTORE_FAILED_MESSAGE =
  "Bilibili retry could not be restored after restart. Please download again.";

/**
 * Build a restorable, detached task for a persisted download/retry that is
 * being rehydrated at startup. Returns null if the task cannot be restored
 * (the caller then finalizes the retry history item as unrestorable).
 *
 * The detached task resolves/rejects via console logs — it has no caller to
 * notify, since it was reconstructed from storage.
 */
export function buildDetachedTask(
  id: string,
  title: string,
  sourceUrl: string,
  type: string,
  retryMetadata?: DownloadRetryMetadata,
  rawRetryMetadata?: string | null,
): DownloadTask | null {
  if (!canRestoreDetachedTask(type, rawRetryMetadata)) {
    return null;
  }

  return {
    downloadFn: createDownloadTask(type, sourceUrl, id, retryMetadata),
    id,
    title,
    sourceUrl,
    type,
    retryMetadata,
    resolve: (value) =>
      console.log("Restored task completed", sanitizeLogMessage(id), value),
    reject: (error) =>
      console.error("Restored task failed", sanitizeLogMessage(id), error),
  };
}

interface BuildRetryHistoryItemInput {
  task: DownloadTask;
  error: unknown;
  retryLimit: number;
  retryIntervalMinutes: number;
  retryCount: number;
  existingHistory?: DownloadHistoryItem;
}

/**
 * Assemble the pending-retry history item persisted when a failed download
 * is scheduled for automatic retry. The shape of this payload is asserted on
 * by downloadManager.test.ts, so it must stay byte-for-byte stable.
 */
export function buildRetryHistoryItem({
  task,
  error,
  retryLimit,
  retryIntervalMinutes,
  retryCount,
  existingHistory,
}: BuildRetryHistoryItemInput): DownloadHistoryItem {
  return {
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
    retryMetadata:
      task.retryMetadata && requiresRetryMetadata(task.retryMetadata)
        ? serializeRetryMetadata(task.retryMetadata)
        : existingHistory?.retryMetadata,
  };
}

/**
 * Resolve the retry policy parameters (limit / interval / current count) for
 * a failed task, reading persisted history first and falling back to the
 * normalized settings defaults. Returns null when no retry budget remains.
 */
export function resolveRetryPolicy(
  task: DownloadTask,
  autoRetryTimes: number,
  autoRetryIntervalMinutes: number,
  existingHistory?: DownloadHistoryItem,
): {
  retryLimit: number;
  retryIntervalMinutes: number;
  retryCount: number;
} | null {
  const retryLimit =
    existingHistory?.retryLimit ?? normalizeAutoRetryTimes(autoRetryTimes);
  const retryIntervalMinutes =
    existingHistory?.retryIntervalMinutes ??
    normalizeAutoRetryIntervalMinutes(autoRetryIntervalMinutes);
  const retryCount = existingHistory?.retryCount ?? 0;

  if (retryCount >= retryLimit) {
    return null;
  }

  return { retryLimit, retryIntervalMinutes, retryCount };
}

export { parseRetryMetadata };
