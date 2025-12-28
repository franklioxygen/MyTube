import { eq } from "drizzle-orm";
import { db } from "../../db";
import { collections, collectionVideos, videos } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { logger } from "../../utils/logger";
import { Collection } from "./types";

/**
 * Repository layer for collection database operations
 * This module handles all direct database interactions for collections
 */

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

    const map = new Map<string, Collection>();
    for (const row of rows) {
      if (!map.has(row.c.id)) {
        map.set(row.c.id, {
          ...row.c,
          title: row.c.title || row.c.name,
          updatedAt: row.c.updatedAt || undefined,
          videos: [],
        });
      }
      if (row.cv) {
        map.get(row.c.id)!.videos.push(row.cv.videoId);
      }
    }
    return Array.from(map.values());
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

    if (rows.length === 0) return undefined;

    const collection: Collection = {
      ...rows[0].c,
      title: rows[0].c.title || rows[0].c.name,
      updatedAt: rows[0].c.updatedAt || undefined,
      videos: [],
    };

    for (const row of rows) {
      if (row.cv) {
        collection.videos.push(row.cv.videoId);
      }
    }

    return collection;
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

    if (rows.length === 0) return undefined;

    // Get the first collection that contains this video
    const collectionId = rows[0].c.id;
    return getCollectionById(collectionId);
  } catch (error) {
    logger.error(
      "Error getting collection by video id",
      error instanceof Error ? error : new Error(String(error))
    );
    return undefined;
  }
}

/**
 * Find a collection by name or title
 */
export function getCollectionByName(name: string): Collection | undefined {
  try {
    const allCollections = getCollections();
    return allCollections.find((c) => c.name === name || c.title === name);
  } catch (error) {
    logger.error(
      "Error getting collection by name",
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
          createdAt: collection.createdAt || new Date().toISOString(),
          updatedAt: collection.updatedAt,
        })
        .onConflictDoUpdate({
          target: collections.id,
          set: {
            name: collection.name || collection.title,
            title: collection.title,
            updatedAt: new Date().toISOString(),
          },
        })
        .run();

      // Sync videos
      // First delete existing links
      db.delete(collectionVideos)
        .where(eq(collectionVideos.collectionId, collection.id))
        .run();

      // Then insert new links
      if (collection.videos && collection.videos.length > 0) {
        for (const videoId of collection.videos) {
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
