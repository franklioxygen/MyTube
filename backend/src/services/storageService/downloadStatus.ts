import { and, eq, lt } from "drizzle-orm";
import { db } from "../../db";
import { downloads } from "../../db/schema";
import { logger } from "../../utils/logger";
import { DownloadInfo, DownloadStatus } from "./types";

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
    // Transaction to clear old queued and add new ones
    db.transaction(() => {
      // First, remove all existing queued downloads
      db.delete(downloads).where(eq(downloads.status, "queued")).run();

      // Then insert new ones
      for (const download of queuedDownloads) {
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
    });
  } catch (error) {
    logger.error("Error setting queued downloads", error instanceof Error ? error : new Error(String(error)));
    // Don't throw - download tracking is non-critical
  }
}

export function getDownloadStatus(): DownloadStatus {
  try {
    // Clean up stale ACTIVE downloads (older than 24 hours) - preserve queued downloads
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    db.delete(downloads)
      .where(
        and(lt(downloads.timestamp, oneDayAgo), eq(downloads.status, "active"))
      )
      .run();

    const allDownloads = db.select().from(downloads).all();

    const activeDownloads = allDownloads
      .filter((d) => d.status === "active")
      .map((d) => ({
        id: d.id,
        title: d.title,
        timestamp: d.timestamp || 0,
        filename: d.filename || undefined,
        totalSize: d.totalSize || undefined,
        downloadedSize: d.downloadedSize || undefined,
        progress:
          d.progress !== null && d.progress !== undefined
            ? d.progress
            : undefined,
        speed: d.speed || undefined,
        sourceUrl: d.sourceUrl || undefined,
        type: d.type || undefined,
      }));

    const queuedDownloads = allDownloads
      .filter((d) => d.status === "queued")
      .map((d) => ({
        id: d.id,
        title: d.title,
        timestamp: d.timestamp || 0,
        sourceUrl: d.sourceUrl || undefined,
        type: d.type || undefined,
      }));

    return { activeDownloads, queuedDownloads };
  } catch (error) {
    logger.error("Error reading download status", error instanceof Error ? error : new Error(String(error)));
    // Return empty arrays for backward compatibility
    return { activeDownloads: [], queuedDownloads: [] };
  }
}

export function getActiveDownload(id: string): DownloadInfo | undefined {
  try {
    const results = db
      .select()
      .from(downloads)
      .where(eq(downloads.id, id))
      .all();
      
    const download = results[0];
    
    if (download && download.status === "active") {
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
    return undefined;
  } catch (error) {
    logger.error(
      "Error getting active download",
      error instanceof Error ? error : new Error(String(error))
    );
    return undefined;
  }
}
