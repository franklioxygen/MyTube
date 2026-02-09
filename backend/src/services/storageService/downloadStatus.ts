import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "../../db";
import { downloads } from "../../db/schema";
import { logger } from "../../utils/logger";
import { DownloadInfo, DownloadStatus } from "./types";

const ACTIVE_DOWNLOAD_STALE_MS = 24 * 60 * 60 * 1000;
const ACTIVE_DOWNLOAD_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let lastActiveCleanupAt = 0;

type DownloadRow = {
  id: string;
  title: string;
  timestamp: number | null;
  filename: string | null;
  totalSize: string | null;
  downloadedSize: string | null;
  progress: number | null;
  speed: string | null;
  sourceUrl: string | null;
  type: string | null;
};

function mapDownloadRow(download: DownloadRow): DownloadInfo {
  return {
    id: download.id,
    title: download.title,
    timestamp: download.timestamp || 0,
    filename: download.filename || undefined,
    totalSize: download.totalSize || undefined,
    downloadedSize: download.downloadedSize || undefined,
    progress:
      download.progress !== null && download.progress !== undefined
        ? download.progress
        : undefined,
    speed: download.speed || undefined,
    sourceUrl: download.sourceUrl || undefined,
    type: download.type || undefined,
  };
}

function cleanupStaleActiveDownloadsIfNeeded(now: number): void {
  if (now - lastActiveCleanupAt < ACTIVE_DOWNLOAD_CLEANUP_INTERVAL_MS) {
    return;
  }

  lastActiveCleanupAt = now;
  const threshold = now - ACTIVE_DOWNLOAD_STALE_MS;
  db.delete(downloads)
    .where(and(lt(downloads.timestamp, threshold), eq(downloads.status, "active")))
    .run();
}

export function addActiveDownload(id: string, title: string): void {
  try {
    const now = Date.now();
    db.insert(downloads)
      .values({
        id,
        title,
        timestamp: now,
        status: "active",
      })
      .onConflictDoUpdate({
        target: downloads.id,
        set: {
          title,
          timestamp: now,
          status: "active",
        },
      })
      .run();
    logger.info(`Added/Updated active download: ${title} (${id})`);
  } catch (error) {
    logger.error("Error adding active download", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download tracking is non-critical
  }
}

export function updateActiveDownload(
  id: string,
  updates: Partial<DownloadInfo>
): void {
  try {
    const updateData: any = {
      timestamp: Date.now(),
    };

    // Explicitly set all fields that might be updated
    if (updates.progress !== undefined) updateData.progress = updates.progress;
    if (updates.totalSize !== undefined)
      updateData.totalSize = updates.totalSize;
    if (updates.downloadedSize !== undefined)
      updateData.downloadedSize = updates.downloadedSize;
    if (updates.speed !== undefined) updateData.speed = updates.speed;
    if (updates.filename !== undefined) updateData.filename = updates.filename;
    if (updates.sourceUrl !== undefined)
      updateData.sourceUrl = updates.sourceUrl;
    if (updates.type !== undefined) updateData.type = updates.type;
    if (updates.title !== undefined) updateData.title = updates.title;

    db.update(downloads).set(updateData).where(eq(downloads.id, id)).run();
  } catch (error) {
    logger.error("Error updating active download", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download tracking is non-critical
  }
}

export function removeActiveDownload(id: string): void {
  try {
    db.delete(downloads).where(eq(downloads.id, id)).run();
    logger.info(`Removed active download: ${id}`);
  } catch (error) {
    logger.error("Error removing active download", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download tracking is non-critical
  }
}

export function updateActiveDownloadTitle(id: string, title: string): void {
  updateActiveDownload(id, { title });
}

export function setQueuedDownloads(queuedDownloads: DownloadInfo[]): void {
  try {
    const latestQueuedById = new Map<string, DownloadInfo>();
    for (const queuedDownload of queuedDownloads) {
      latestQueuedById.set(queuedDownload.id, queuedDownload);
    }

    db.transaction(() => {
      const existingQueued = db
        .select({ id: downloads.id })
        .from(downloads)
        .where(eq(downloads.status, "queued"))
        .all();

      for (const download of latestQueuedById.values()) {
        db.insert(downloads)
          .values({
            id: download.id,
            title: download.title,
            timestamp: download.timestamp,
            status: "queued",
            sourceUrl: download.sourceUrl,
            type: download.type,
          })
          .onConflictDoUpdate({
            target: downloads.id,
            set: {
              title: download.title,
              timestamp: download.timestamp,
              status: "queued",
              sourceUrl: download.sourceUrl,
              type: download.type,
            },
          })
          .run();
      }

      const latestIds = new Set(latestQueuedById.keys());
      const staleQueuedIds = existingQueued
        .map((item) => item.id)
        .filter((id) => !latestIds.has(id));

      if (staleQueuedIds.length > 0) {
        db.delete(downloads)
          .where(
            and(
              eq(downloads.status, "queued"),
              inArray(downloads.id, staleQueuedIds)
            )
          )
          .run();
      }
    });
  } catch (error) {
    logger.error("Error setting queued downloads", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download tracking is non-critical
  }
}

export function getDownloadStatus(): DownloadStatus {
  try {
    cleanupStaleActiveDownloadsIfNeeded(Date.now());

    const activeDownloads = db
      .select()
      .from(downloads)
      .where(eq(downloads.status, "active"))
      .all()
      .map(mapDownloadRow);

    const queuedDownloads = db
      .select()
      .from(downloads)
      .where(eq(downloads.status, "queued"))
      .all()
      .map(mapDownloadRow);

    return { activeDownloads, queuedDownloads };
  } catch (error) {
    logger.error("Error reading download status", error instanceof Error ? error : new Error(String(error)));
    // Return empty arrays for backward compatibility
    return { activeDownloads: [], queuedDownloads: [] };
  }
}

export function getActiveDownload(id: string): DownloadInfo | undefined {
  try {
    const download = db
      .select()
      .from(downloads)
      .where(and(eq(downloads.id, id), eq(downloads.status, "active")))
      .get();

    if (download) {
      return mapDownloadRow(download);
    }

    return undefined;
  } catch (error) {
    logger.error(
      "Error getting active download",
      error instanceof Error ? error : new Error(String(error))
    );
    return undefined;
  }
}
