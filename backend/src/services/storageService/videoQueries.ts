import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { logger } from "../../utils/logger";

export type VideoCallerRole = "admin" | "visitor";

// Visibility: 0 = hidden, 1 = public (see db/schema.ts). Visitors are only
// allowed to see public videos; admins see everything. Mirrors the existing
// RSS feed filter (rssService.ts). Used to fix GHSA-hcm6-w6x8-6jhr.
// A NULL visibility is treated as public to match the `(visibility ?? 1) === 1`
// contract in isVideoPublic and the media classifier; a plain `= 1` would hide
// imported/legacy rows that wrote NULL from visitors only.
// Built lazily so the schema reference is not evaluated at module load time
// (which would break tests that partially mock the db schema).
const publicOnlyVisitorFilter = () =>
  or(eq(videos.visibility, 1), isNull(videos.visibility));

export function getVideos(
  role?: VideoCallerRole
): import("./types").Video[] {
  try {
    const baseQuery = db
      .select()
      .from(videos)
      .orderBy(desc(videos.createdAt));
    const allVideos =
      role === "visitor"
        ? baseQuery.where(publicOnlyVisitorFilter()).all()
        : baseQuery.all();
    return allVideos.map((v) => ({
      ...v,
      tags: v.tags ? JSON.parse(v.tags) : [],
      subtitles: v.subtitles ? JSON.parse(v.subtitles) : undefined,
    })) as import("./types").Video[];
  } catch (error) {
    logger.error(
      "Error getting videos",
      error instanceof Error ? error : new Error(String(error))
    );
    // Return empty array for backward compatibility with frontend
    return [];
  }
}

// Every videos column except the heavy free-text ones. `description` (KBs of
// YouTube description per row) and `subtitles` (JSON blobs) are only consumed
// by the player, which fetches the full row via getVideoById — omitting them
// here keeps the list payload and its per-row JSON.parse cost proportional to
// what list views actually render.
const videoSummaryColumns = {
  id: videos.id,
  title: videos.title,
  author: videos.author,
  date: videos.date,
  source: videos.source,
  sourceUrl: videos.sourceUrl,
  videoFilename: videos.videoFilename,
  thumbnailFilename: videos.thumbnailFilename,
  videoPath: videos.videoPath,
  thumbnailPath: videos.thumbnailPath,
  thumbnailUrl: videos.thumbnailUrl,
  addedAt: videos.addedAt,
  createdAt: videos.createdAt,
  updatedAt: videos.updatedAt,
  partNumber: videos.partNumber,
  totalParts: videos.totalParts,
  seriesTitle: videos.seriesTitle,
  rating: videos.rating,
  viewCount: videos.viewCount,
  duration: videos.duration,
  tags: videos.tags,
  progress: videos.progress,
  fileSize: videos.fileSize,
  lastPlayedAt: videos.lastPlayedAt,
  channelUrl: videos.channelUrl,
  visibility: videos.visibility,
  authorAvatarFilename: videos.authorAvatarFilename,
  authorAvatarPath: videos.authorAvatarPath,
};

/**
 * List-view projection of the library: all columns except `description` and
 * `subtitles`. Used by the GET /videos list endpoint; internal callers that
 * need full rows keep using getVideos().
 */
export function getVideoSummaries(
  role?: VideoCallerRole
): import("./types").Video[] {
  try {
    const baseQuery = db
      .select(videoSummaryColumns)
      .from(videos)
      .orderBy(desc(videos.createdAt));
    const allVideos =
      role === "visitor"
        ? baseQuery.where(publicOnlyVisitorFilter()).all()
        : baseQuery.all();
    return allVideos.map((v) => ({
      ...v,
      tags: v.tags ? JSON.parse(v.tags) : [],
    })) as import("./types").Video[];
  } catch (error) {
    logger.error(
      "Error getting video summaries",
      error instanceof Error ? error : new Error(String(error))
    );
    // Return empty array for backward compatibility with frontend
    return [];
  }
}

export function getVideoBySourceUrl(
  sourceUrl: string
): import("./types").Video | undefined {
  try {
    const result = db
      .select()
      .from(videos)
      .where(eq(videos.sourceUrl, sourceUrl))
      .get();

    if (result) {
      return {
        ...result,
        tags: result.tags ? JSON.parse(result.tags) : [],
        subtitles: result.subtitles ? JSON.parse(result.subtitles) : undefined,
      } as import("./types").Video;
    }
    return undefined;
  } catch (error) {
    logger.error(
      "Error getting video by sourceUrl",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to get video by source URL: ${sourceUrl}`,
      error instanceof Error ? error : new Error(String(error)),
      "getVideoBySourceUrl"
    );
  }
}

export function getVideoById(
  id: string,
  role?: VideoCallerRole
): import("./types").Video | undefined {
  try {
    const baseQuery = db.select().from(videos);
    const video =
      role === "visitor"
        ? baseQuery
            .where(
              and(eq(videos.id, id), publicOnlyVisitorFilter())
            )
            .get()
        : baseQuery.where(eq(videos.id, id)).get();
    if (video) {
      return {
        ...video,
        tags: video.tags ? JSON.parse(video.tags) : [],
        subtitles: video.subtitles ? JSON.parse(video.subtitles) : undefined,
      } as import("./types").Video;
    }
    return undefined;
  } catch (error) {
    logger.error(
      "Error getting video by id",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to get video by id: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "getVideoById"
    );
  }
}

/**
 * Check if a video part already exists by sourceUrl
 * Returns the existing video if found, undefined otherwise
 */
export function getVideoPartBySourceUrl(
  sourceUrl: string
): import("./types").Video | undefined {
  return getVideoBySourceUrl(sourceUrl);
}
