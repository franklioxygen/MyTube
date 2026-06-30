import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { collections, collectionVideos, videos } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { logger } from "../../utils/logger";
import { Collection, CollectionOrigin } from "./types";

/**
 * Repository layer for collection database operations
 * This module handles all direct database interactions for collections
 */

type CollectionRow = {
  c: typeof collections.$inferSelect;
  cv: typeof collectionVideos.$inferSelect | null;
};

function toCollectionOrigin(
  origin: string | null | undefined,
): CollectionOrigin | undefined {
  return origin === "manual" || origin === "author_auto"
    ? origin
    : undefined;
}

function sortCollectionRows(rows: CollectionRow[]): CollectionRow[] {
  return [...rows].sort((left, right) => {
    const leftOrder = left.cv?.order;
    const rightOrder = right.cv?.order;

    if (leftOrder == null && rightOrder == null) {
      return 0;
    }
    if (leftOrder == null) {
      return 1;
    }
    if (rightOrder == null) {
      return -1;
    }

    return leftOrder - rightOrder;
  });
}

function hydrateCollection(rows: CollectionRow[]): Collection | undefined {
  if (rows.length === 0) {
    return undefined;
  }

  const sortedRows = sortCollectionRows(rows);
  const collection: Collection = {
    ...sortedRows[0].c,
    title: sortedRows[0].c.title || sortedRows[0].c.name,
    origin: toCollectionOrigin(sortedRows[0].c.origin),
    updatedAt: sortedRows[0].c.updatedAt || undefined,
    sourcePlatform: sortedRows[0].c.sourcePlatform ?? undefined,
    sourceType: sortedRows[0].c.sourceType ?? undefined,
    sourceMid: sortedRows[0].c.sourceMid ?? undefined,
    sourceId: sortedRows[0].c.sourceId ?? undefined,
    videos: [],
  };

  for (const row of sortedRows) {
    if (row.cv) {
      collection.videos.push(row.cv.videoId);
    }
  }

  return collection;
}

export function getCollections(): Collection[] {
  try {
    const rows = db
      .select({
        c: collections,
        cv: collectionVideos,
      })
      .from(collections)
      .leftJoin(
        collectionVideos,
        eq(collections.id, collectionVideos.collectionId)
      )
      .all();

    const map = new Map<string, CollectionRow[]>();
    for (const row of rows) {
      const existingRows = map.get(row.c.id) ?? [];
      existingRows.push(row);
      map.set(row.c.id, existingRows);
    }

    return Array.from(map.values())
      .map((collectionRows) => hydrateCollection(collectionRows))
      .filter((collection): collection is Collection => Boolean(collection));
  } catch (error) {
    logger.error(
      "Error getting collections",
      error instanceof Error ? error : new Error(String(error))
    );
    // Return empty array for backward compatibility with frontend
    return [];
  }
}

export function getCollectionById(id: string): Collection | undefined {
  try {
    const rows = db
      .select({
        c: collections,
        cv: collectionVideos,
      })
      .from(collections)
      .leftJoin(
        collectionVideos,
        eq(collections.id, collectionVideos.collectionId)
      )
      .where(eq(collections.id, id))
      .all();

    return hydrateCollection(rows);
  } catch (error) {
    logger.error(
      "Error getting collection by id",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to get collection by id: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "getCollectionById"
    );
  }
}

/**
 * Find a collection that contains a specific video
 */
export function getCollectionByVideoId(
  videoId: string
): Collection | undefined {
  return getCollectionsByVideoId(videoId)[0];
}

export function getCollectionsByVideoId(videoId: string): Collection[] {
  try {
    const rows = db
      .select({
        c: collections,
        cv: collectionVideos,
      })
      .from(collections)
      .innerJoin(
        collectionVideos,
        eq(collections.id, collectionVideos.collectionId)
      )
      .where(eq(collectionVideos.videoId, videoId))
      .all();

    if (rows.length === 0) return [];

    const collectionIds = Array.from(new Set(rows.map((row) => row.c.id)));
    return collectionIds
      .map((collectionId) => getCollectionById(collectionId))
      .filter((collection): collection is Collection => Boolean(collection));
  } catch (error) {
    logger.error(
      "Error getting collections by video id",
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}

/**
 * Find a collection by name or title.
 * Uses indexed name/title lookups instead of hydrating every collection
 * (the previous implementation loaded all collections + their videos). Keep
 * the title fallback for older rows, but split it into a second query so SQLite
 * can use the separate indexes rather than planning an OR table scan.
 */
export function getCollectionByName(name: string): Collection | undefined {
  try {
    const nameMatch = db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.name, name))
      .get();
    if (nameMatch) {
      return getCollectionById(nameMatch.id);
    }

    const titleMatch = db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.title, name))
      .get();
    return titleMatch ? getCollectionById(titleMatch.id) : undefined;
  } catch (error) {
    logger.error(
      "Error getting collection by name",
      error instanceof Error ? error : new Error(String(error))
    );
    return undefined;
  }
}

/**
 * Find a collection by its stable source identity (issue #295).
 * Matching is exact on platform/type/mid/id. Used to reuse the same MyTube
 * collection when a Bilibili collection/series link is re-downloaded for repair,
 * instead of relying on fragile name or membership matching.
 * Backed by idx_collections_source_key.
 */
export function getCollectionBySourceKey(
  platform: string,
  type: string,
  mid: string,
  id: string
): Collection | undefined {
  if (!platform || !type || !mid || !id) {
    return undefined;
  }
  try {
    const match = db
      .select({ id: collections.id })
      .from(collections)
      .where(
        and(
          eq(collections.sourcePlatform, platform),
          eq(collections.sourceType, type),
          eq(collections.sourceMid, mid),
          eq(collections.sourceId, id)
        )
      )
      .get();
    return match ? getCollectionById(match.id) : undefined;
  } catch (error) {
    logger.error(
      "Error getting collection by source key",
      error instanceof Error ? error : new Error(String(error))
    );
    return undefined;
  }
}

export function saveCollection(collection: Collection): Collection {
  try {
    db.transaction(() => {
      // Insert collection
      db.insert(collections)
        .values({
          id: collection.id,
          name: collection.name || collection.title,
          title: collection.title,
          origin: collection.origin ?? null,
          createdAt: collection.createdAt || new Date().toISOString(),
          updatedAt: collection.updatedAt,
          sourcePlatform: collection.sourcePlatform ?? null,
          sourceType: collection.sourceType ?? null,
          sourceMid: collection.sourceMid ?? null,
          sourceId: collection.sourceId ?? null,
        })
        .onConflictDoUpdate({
          target: collections.id,
          set: {
            name: collection.name || collection.title,
            title: collection.title,
            origin: collection.origin ?? null,
            updatedAt: new Date().toISOString(),
            sourcePlatform: collection.sourcePlatform ?? null,
            sourceType: collection.sourceType ?? null,
            sourceMid: collection.sourceMid ?? null,
            sourceId: collection.sourceId ?? null,
          },
        })
        .run();

      // Sync videos
      // First delete existing links
      db.delete(collectionVideos)
        .where(eq(collectionVideos.collectionId, collection.id))
        .run();

      // Then insert new links
      if (collection.videos.length > 0) {
        for (const [index, videoId] of collection.videos.entries()) {
          // Check if video exists to avoid FK error
          const videoExists = db
            .select({ id: videos.id })
            .from(videos)
            .where(eq(videos.id, videoId))
            .get();
          if (videoExists) {
            db.insert(collectionVideos)
              .values({
                collectionId: collection.id,
                videoId: videoId,
                order: index + 1,
              })
              .run();
          }
        }
      }
    });
    return collection;
  } catch (error) {
    logger.error(
      "Error saving collection",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to save collection: ${collection.id}`,
      error instanceof Error ? error : new Error(String(error)),
      "saveCollection"
    );
  }
}

/**
 * Append a single video to the end of a collection without rebuilding the
 * whole link set. Does a single conditional INSERT guarded by an EXISTS check
 * (so it never violates the FK), skipping silently if the video is already a
 * member. Use this instead of saveCollection() when adding one video to a
 * large collection — saveCollection re-inserts every link with a per-row
 * existence check.
 *
 * Returns the updated collection, or null if the collection does not exist.
 */
export function appendVideoToCollection(
  collectionId: string,
  videoId: string
): Collection | null {
  try {
    const collection = getCollectionById(collectionId);
    if (!collection) {
      return null;
    }

    // Already a member? Nothing to do.
    if (collection.videos.includes(videoId)) {
      return collection;
    }

    db.transaction(() => {
      // Single guarded insert: append at the end (order = current size + 1).
      db.run(sql`
        INSERT INTO collection_videos (collection_id, video_id, "order")
        SELECT ${collectionId}, ${videoId}, COALESCE(
          (SELECT MAX("order") FROM collection_videos WHERE collection_id = ${collectionId}),
          0
        ) + 1
        WHERE EXISTS (SELECT 1 FROM collections WHERE id = ${collectionId})
          AND EXISTS (SELECT 1 FROM videos WHERE id = ${videoId})
          AND NOT EXISTS (
            SELECT 1 FROM collection_videos
            WHERE collection_id = ${collectionId} AND video_id = ${videoId}
          )
      `);
    });

    return getCollectionById(collectionId) ?? null;
  } catch (error) {
    logger.error(
      "Error appending video to collection",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to append video ${videoId} to collection ${collectionId}`,
      error instanceof Error ? error : new Error(String(error)),
      "appendVideoToCollection"
    );
  }
}

export function atomicUpdateCollection(
  id: string,
  updateFn: (collection: Collection) => Collection | null
): Collection | null {
  try {
    const collection = getCollectionById(id);
    if (!collection) return null;

    // Deep copy not strictly needed as we reconstruct, but good for safety if updateFn mutates
    const collectionCopy = JSON.parse(JSON.stringify(collection));
    const updatedCollection = updateFn(collectionCopy);

    if (!updatedCollection) return null;

    updatedCollection.updatedAt = new Date().toISOString();
    saveCollection(updatedCollection);
    return updatedCollection;
  } catch (error) {
    logger.error(
      "Error atomic updating collection",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to atomically update collection: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "atomicUpdateCollection"
    );
  }
}

export function deleteCollection(id: string): boolean {
  try {
    const result = db.delete(collections).where(eq(collections.id, id)).run();
    return result.changes > 0;
  } catch (error) {
    logger.error(
      "Error deleting collection",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to delete collection: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "deleteCollection"
    );
  }
}
