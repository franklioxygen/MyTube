import { eq, isNull, or, sql, type SQL } from "drizzle-orm";
import crypto from "crypto";
import path from "path";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { logger } from "../../utils/logger";

/**
 * A video is treated as publicly visible unless visibility is explicitly 0.
 * Mirrors the frontend contract `(visibility ?? 1) === 1`.
 */
export function isVideoPublic(video: {
  visibility?: number | null;
}): boolean {
  return (video.visibility ?? 1) === 1;
}

export type MediaVisibility = "public" | "hidden" | "unknown";

const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, "\\$&");

const CLOUD_THUMBNAIL_CACHE_KEY_PATTERN = /^[a-f0-9]{64}\.jpg$/;

const normalizeCloudThumbnailCacheKey = (value: string): string | null => {
  const key = path.posix.basename(value).toLowerCase();
  return CLOUD_THUMBNAIL_CACHE_KEY_PATTERN.test(key) ? key : null;
};

const getCloudThumbnailCacheKey = (cloudPath: string): string =>
  `${crypto.createHash("sha256").update(cloudPath).digest("hex")}.jpg`;

const getCachedCloudThumbnailVisibilityRows = (
  cacheKeys: Set<string>
): Array<{ visibility: number | null }> => {
  if (cacheKeys.size === 0) {
    return [];
  }

  const rows = db
    .select({
      thumbnailPath: videos.thumbnailPath,
      thumbnailUrl: videos.thumbnailUrl,
      visibility: videos.visibility,
    })
    .from(videos)
    .where(
      or(
        sql`${videos.thumbnailPath} LIKE ${"cloud:%"}`,
        sql`${videos.thumbnailUrl} LIKE ${"cloud:%"}`
      )
    )
    .all();

  return rows
    .filter((row) => {
      const candidates = [row.thumbnailPath, row.thumbnailUrl].filter(
        (value): value is string => typeof value === "string" && value.length > 0
      );
      return candidates.some((candidate) =>
        cacheKeys.has(getCloudThumbnailCacheKey(candidate))
      );
    })
    .map((row) => ({ visibility: row.visibility }));
};

/**
 * Classify a piece of static media by the visibility of the video(s) that
 * reference it. Used as defense-in-depth on the static/cloud media routes
 * (GHSA-hcm6-w6x8-6jhr): even after the login wall, media that belongs only to
 * hidden videos must not be served to non-admin callers, while public media
 * stays reachable (e.g. for RSS clients).
 *
 * - `exactPaths` are matched against `videoPath`/`thumbnailPath`/`thumbnailUrl`.
 * - `subtitlePaths` are matched against entries inside the `subtitles` JSON.
 * - `cloudThumbnailCacheKeys` are matched by recomputing the stable cache key
 *   for cloud thumbnail paths, which lets the static cache route enforce the
 *   same visibility rule even though its URL only contains a hash filename.
 *
 * Returns "public" if any referencing video is visible, "hidden" if every
 * referencing video is hidden, and "unknown" if no video references the media
 * (orphan files, frontend assets, avatars — left untouched).
 */
export function classifyMediaVisibility(opts: {
  exactPaths?: string[];
  subtitlePaths?: string[];
  cloudThumbnailCacheKeys?: string[];
}): MediaVisibility {
  const conditions: SQL[] = [];
  const cloudThumbnailCacheKeys = new Set(
    (opts.cloudThumbnailCacheKeys ?? [])
      .map(normalizeCloudThumbnailCacheKey)
      .filter((key): key is string => key != null)
  );

  for (const candidate of opts.exactPaths ?? []) {
    if (!candidate) continue;
    conditions.push(eq(videos.videoPath, candidate));
    conditions.push(eq(videos.thumbnailPath, candidate));
    conditions.push(eq(videos.thumbnailUrl, candidate));
  }

  for (const candidate of opts.subtitlePaths ?? []) {
    if (!candidate) continue;
    const pattern = `%"${escapeLikePattern(candidate)}"%`;
    conditions.push(sql`${videos.subtitles} LIKE ${pattern} ESCAPE '\\'`);
  }

  if (conditions.length === 0 && cloudThumbnailCacheKeys.size === 0) {
    return "unknown";
  }

  try {
    const rows: Array<{ visibility: number | null }> =
      conditions.length > 0
        ? db
            .select({ visibility: videos.visibility })
            .from(videos)
            .where(or(...conditions))
            .all()
        : [];

    rows.push(...getCachedCloudThumbnailVisibilityRows(cloudThumbnailCacheKeys));

    if (rows.length === 0) {
      return "unknown";
    }

    // Any visible reference makes the file public (a thumbnail could be shared);
    // only block when every match is hidden.
    return rows.some((row) => isVideoPublic(row)) ? "public" : "hidden";
  } catch (error) {
    logger.error(
      "Error classifying media visibility",
      error instanceof Error ? error : new Error(String(error))
    );
    // Fail closed: treat as hidden so a transient DB error can't leak media.
    return "hidden";
  }
}

/**
 * Whether a visitor may access a cloud-stored file. Shared by the cloud
 * redirect routes and the signed-url controller so the "is this `cloud:` ref
 * hidden?" rule lives in exactly one place. A file is visitor-accessible unless
 * every video referencing it is hidden; orphan files (no match) stay reachable
 * so cached thumbnails keep resolving. Part of GHSA-hcm6-w6x8-6jhr.
 */
export function isCloudFileVisibleToVisitor(filename: string): boolean {
  if (!filename) return true;
  return (
    classifyMediaVisibility({ exactPaths: [`cloud:${filename}`] }) !== "hidden"
  );
}
