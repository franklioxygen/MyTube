import { eq } from "drizzle-orm";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { logger } from "../../utils/logger";

export interface SaveVideoOptions {
  // When true, suppress the library_video_added statistics event even on insert
  // (used by maintenance flows like database migration/import/merge that should
  // not appear as user-facing library mutations).
  suppressStatistics?: boolean;
  // Optional reason bucket for the library_video_added event.
  statisticsReason?: "manual" | "download" | "upload" | "scan" | "subscription" | "task";
}

export function saveVideo(
  videoData: import("./types").Video,
  options: SaveVideoOptions = {}
): import("./types").Video {
  const result = saveVideoWithInsertFlag(videoData);
  if (result.inserted && !options.suppressStatistics) {
    emitLibraryVideoAdded(videoData, options.statisticsReason ?? "download");
  }
  return videoData;
}

// Same as saveVideo but reports whether a new row was created and never emits.
// Statistics callers use this directly when they need to control emission timing.
export function saveVideoWithInsertFlag(
  videoData: import("./types").Video
): { video: import("./types").Video; inserted: boolean } {
  try {
    const existing = db
      .select({ id: videos.id })
      .from(videos)
      .where(eq(videos.id, videoData.id))
      .all();
    const inserted = existing.length === 0;
    const videoToSave = {
      ...videoData,
      tags: videoData.tags ? JSON.stringify(videoData.tags) : undefined,
      subtitles: videoData.subtitles
        ? JSON.stringify(videoData.subtitles)
        : undefined,
    };
    db.insert(videos)
      .values(videoToSave as any)
      .onConflictDoUpdate({
        target: videos.id,
        set: videoToSave,
      })
      .run();
    return { video: videoData, inserted };
  } catch (error) {
    logger.error(
      "Error saving video",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to save video: ${videoData.id}`,
      error instanceof Error ? error : new Error(String(error)),
      "saveVideo"
    );
  }
}

function emitLibraryVideoAdded(
  videoData: import("./types").Video,
  reason: string
): void {
  try {
    const { recordEvent } = require("../statistics") as {
      recordEvent: (input: any) => string | null;
    };
    const fileSizeBytes =
      videoData.fileSize !== undefined && videoData.fileSize !== null
        ? Number(videoData.fileSize) || 0
        : 0;
    recordEvent({
      eventType: "library_video_added",
      actorRole: "system",
      surface: "background",
      videoId: videoData.id,
      platform:
        typeof videoData.source === "string"
          ? videoData.source.toLowerCase()
          : null,
      payload: {
        reason,
        videoTitle: videoData.title,
        fileSizeBytes,
      },
    });
  } catch {
    // statistics is best-effort
  }
}

export function saveVideoIfAbsent(
  videoData: import("./types").Video
): boolean {
  try {
    const videoToSave = {
      ...videoData,
      tags: videoData.tags ? JSON.stringify(videoData.tags) : undefined,
      subtitles: videoData.subtitles
        ? JSON.stringify(videoData.subtitles)
        : undefined,
    };

    const result = db
      .insert(videos)
      .values(videoToSave as any)
      .onConflictDoNothing({
        target: videos.id,
      })
      .run();

    return result.changes > 0;
  } catch (error) {
    logger.error(
      "Error saving video if absent",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to save video if absent: ${videoData.id}`,
      error instanceof Error ? error : new Error(String(error)),
      "saveVideoIfAbsent"
    );
  }
}

export function updateVideo(
  id: string,
  updates: Partial<import("./types").Video>
): import("./types").Video | null {
  try {
    const updatesToSave: Record<string, unknown> = {
      ...updates,
      // Only include tags/subtitles if they are explicitly in the updates object
      ...(updates.tags !== undefined
        ? { tags: updates.tags ? JSON.stringify(updates.tags) : undefined }
        : {}),
      ...(updates.subtitles !== undefined
        ? {
            subtitles: updates.subtitles
              ? JSON.stringify(updates.subtitles)
              : undefined,
          }
        : {}),
    };

    // Keep thumbnailUrl aligned when callers only update thumbnailPath
    if (
      Object.prototype.hasOwnProperty.call(updates, "thumbnailPath") &&
      !Object.prototype.hasOwnProperty.call(updates, "thumbnailUrl")
    ) {
      updatesToSave.thumbnailUrl = updates.thumbnailPath ?? null;
    }

    // If tags is explicitly empty array, we might want to save it as '[]' or null.
    // JSON.stringify([]) is '[]', which is fine.

    const result = db
      .update(videos)
      .set(updatesToSave as any)
      .where(eq(videos.id, id))
      .returning()
      .get();

    if (result) {
      return {
        ...result,
        tags: result.tags ? JSON.parse(result.tags) : [],
        subtitles: result.subtitles ? JSON.parse(result.subtitles) : undefined,
      } as import("./types").Video;
    }
    return null;
  } catch (error) {
    logger.error(
      "Error updating video",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to update video: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "updateVideo"
    );
  }
}
