import { eq } from "drizzle-orm";
import fs from "fs-extra";
import path from "path";
import {
  IMAGES_DIR,
  SUBTITLES_DIR,
  UPLOADS_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import { db } from "../../db";
import { collections, collectionVideos, videos } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { logger } from "../../utils/logger";
import { findImageFile, findVideoFile, moveFile } from "./fileHelpers";
import { getSettings } from "./settings";
import { Collection, Video } from "./types";
import { deleteVideo, getVideoById, updateVideo } from "./videos";

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
export function getCollectionByVideoId(videoId: string): Collection | undefined {
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
    return allCollections.find(
      (c) => c.name === name || c.title === name
    );
  } catch (error) {
    logger.error(
      "Error getting collection by name",
      error instanceof Error ? error : new Error(String(error))
    );
    return undefined;
  }
}

/**
 * Generate a unique collection name by appending a number if the name already exists
 * @param baseName - The desired collection name
 * @returns A unique collection name
 */
export function generateUniqueCollectionName(baseName: string): string {
  const existingCollection = getCollectionByName(baseName);
  if (!existingCollection) {
    return baseName;
  }

  // Try appending numbers: "Name (2)", "Name (3)", etc.
  let counter = 2;
  let uniqueName = `${baseName} (${counter})`;
  
  while (getCollectionByName(uniqueName)) {
    counter++;
    uniqueName = `${baseName} (${counter})`;
  }

  logger.info(
    `Collection name "${baseName}" already exists, using "${uniqueName}" instead`
  );
  return uniqueName;
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

export function addVideoToCollection(
  collectionId: string,
  videoId: string
): Collection | null {
  // Use atomicUpdateCollection to handle DB update
  const collection = atomicUpdateCollection(collectionId, (c) => {
    if (!c.videos.includes(videoId)) {
      c.videos.push(videoId);
    }
    return c;
  });

  if (collection) {
    const video = getVideoById(videoId);
    const collectionName = collection.name || collection.title;
    const allCollections = getCollections();

    if (video && collectionName) {
      const updates: Partial<Video> = {};
      let updated = false;

      if (video.videoFilename) {
        const currentVideoPath = findVideoFile(
          video.videoFilename,
          allCollections
        );
        const targetVideoPath = path.join(
          VIDEOS_DIR,
          collectionName,
          video.videoFilename
        );

        if (currentVideoPath && currentVideoPath !== targetVideoPath) {
          moveFile(currentVideoPath, targetVideoPath);
          updates.videoPath = `/videos/${collectionName}/${video.videoFilename}`;
          updated = true;
        }
      }

      if (video.thumbnailFilename) {
        // Find existing file using path from DB if possible, or fallback to search
        let currentImagePath = "";
        if (video.thumbnailPath) {
          if (video.thumbnailPath.startsWith("/videos/")) {
            currentImagePath = path.join(
              VIDEOS_DIR,
              video.thumbnailPath.replace(/^\/videos\//, "")
            );
          } else if (video.thumbnailPath.startsWith("/images/")) {
            currentImagePath = path.join(
              IMAGES_DIR,
              video.thumbnailPath.replace(/^\/images\//, "")
            );
          }
        }

        if (!currentImagePath || !fs.existsSync(currentImagePath)) {
          currentImagePath =
            findImageFile(video.thumbnailFilename, allCollections) || "";
        }

        // Determine target
        const settings = getSettings();
        const moveWithVideo = settings.moveThumbnailsToVideoFolder;

        let targetImagePath = "";
        let newWebPath = "";

        if (moveWithVideo) {
          targetImagePath = path.join(
            VIDEOS_DIR,
            collectionName,
            video.thumbnailFilename
          );
          newWebPath = `/videos/${collectionName}/${video.thumbnailFilename}`;
        } else {
          targetImagePath = path.join(
            IMAGES_DIR,
            collectionName,
            video.thumbnailFilename
          );
          newWebPath = `/images/${collectionName}/${video.thumbnailFilename}`;
        }

        if (currentImagePath && currentImagePath !== targetImagePath) {
          moveFile(currentImagePath, targetImagePath);
          updates.thumbnailPath = newWebPath;
          updated = true;
        }
      }

      // Handle subtitles
      if (video.subtitles && video.subtitles.length > 0) {
        const newSubtitles = [...video.subtitles];
        let subtitlesUpdated = false;

        newSubtitles.forEach((sub, index) => {
          let currentSubPath = sub.path;
          // Determine existing absolute path
          let absoluteSourcePath = "";
          if (sub.path.startsWith("/videos/")) {
            absoluteSourcePath = path.join(
              VIDEOS_DIR,
              sub.path.replace("/videos/", "")
            );
          } else if (sub.path.startsWith("/subtitles/")) {
            absoluteSourcePath = path.join(
              path.dirname(SUBTITLES_DIR),
              sub.path
            ); // SUBTITLES_DIR is uploads/subtitles
          }

          // If we can't determine source path easily from DB, try to find it
          if (!fs.existsSync(absoluteSourcePath)) {
            // Fallback: try finding in root or collection folders
            // But simpler to rely on path stored in DB if valid
          }

          let targetSubDir = "";
          let newWebPath = "";

          // Logic:
          // If it's currently in VIDEOS_DIR (starts with /videos/), it should stay with video -> move to new video folder
          // If it's currently in SUBTITLES_DIR (starts with /subtitles/), it should move to new mirror folder in SUBTITLES_DIR

          if (sub.path.startsWith("/videos/")) {
            targetSubDir = path.join(VIDEOS_DIR, collectionName);
            newWebPath = `/videos/${collectionName}/${path.basename(sub.path)}`;
          } else if (sub.path.startsWith("/subtitles/")) {
            targetSubDir = path.join(SUBTITLES_DIR, collectionName);
            newWebPath = `/subtitles/${collectionName}/${path.basename(
              sub.path
            )}`;
          }

          if (absoluteSourcePath && targetSubDir && newWebPath) {
            const targetSubPath = path.join(
              targetSubDir,
              path.basename(sub.path)
            );
            if (
              fs.existsSync(absoluteSourcePath) &&
              absoluteSourcePath !== targetSubPath
            ) {
              moveFile(absoluteSourcePath, targetSubPath);
              newSubtitles[index] = {
                ...sub,
                path: newWebPath,
              };
              subtitlesUpdated = true;
            }
          }
        });

        if (subtitlesUpdated) {
          updates.subtitles = newSubtitles;
          updated = true;
        }
      }

      if (updated) {
        updateVideo(videoId, updates);
      }
    }
  }

  return collection;
}

export function removeVideoFromCollection(
  collectionId: string,
  videoId: string
): Collection | null {
  const collection = atomicUpdateCollection(collectionId, (c) => {
    c.videos = c.videos.filter((v) => v !== videoId);
    return c;
  });

  if (collection) {
    const video = getVideoById(videoId);
    const allCollections = getCollections();

    if (video) {
      // Check if video is in any other collection
      const otherCollection = allCollections.find(
        (c) => c.videos.includes(videoId) && c.id !== collectionId
      );

      let targetVideoDir = VIDEOS_DIR;
      let targetImageDir = IMAGES_DIR;
      let videoPathPrefix = "/videos";
      let imagePathPrefix = "/images";

      if (otherCollection) {
        const otherName = otherCollection.name || otherCollection.title;
        if (otherName) {
          targetVideoDir = path.join(VIDEOS_DIR, otherName);
          targetImageDir = path.join(IMAGES_DIR, otherName);
          videoPathPrefix = `/videos/${otherName}`;
          imagePathPrefix = `/images/${otherName}`;
        }
      }

      const updates: Partial<Video> = {};
      let updated = false;

      if (video.videoFilename) {
        const currentVideoPath = findVideoFile(
          video.videoFilename,
          allCollections
        );
        const targetVideoPath = path.join(targetVideoDir, video.videoFilename);

        if (currentVideoPath && currentVideoPath !== targetVideoPath) {
          moveFile(currentVideoPath, targetVideoPath);
          updates.videoPath = `${videoPathPrefix}/${video.videoFilename}`;
          updated = true;
        }
      }

      if (video.thumbnailFilename) {
        // Find existing file using path from DB if possible
        let currentImagePath = "";
        if (video.thumbnailPath) {
          if (video.thumbnailPath.startsWith("/videos/")) {
            currentImagePath = path.join(
              VIDEOS_DIR,
              video.thumbnailPath.replace(/^\/videos\//, "")
            );
          } else if (video.thumbnailPath.startsWith("/images/")) {
            currentImagePath = path.join(
              IMAGES_DIR,
              video.thumbnailPath.replace(/^\/images\//, "")
            );
          }
        }

        if (!currentImagePath || !fs.existsSync(currentImagePath)) {
          currentImagePath =
            findImageFile(video.thumbnailFilename, allCollections) || "";
        }

        // Determine target
        const settings = getSettings();
        const moveWithVideo = settings.moveThumbnailsToVideoFolder;

        let targetImagePath = "";
        let newWebPath = "";

        if (moveWithVideo) {
          // Target is same as video target
          targetImagePath = path.join(targetVideoDir, video.thumbnailFilename);
          newWebPath = `${videoPathPrefix}/${video.thumbnailFilename}`;
        } else {
          // Target is image dir (root or other collection)
          targetImagePath = path.join(targetImageDir, video.thumbnailFilename);
          newWebPath = `${imagePathPrefix}/${video.thumbnailFilename}`;
        }

        if (currentImagePath && currentImagePath !== targetImagePath) {
          moveFile(currentImagePath, targetImagePath);
          updates.thumbnailPath = newWebPath;
          updated = true;
        }
      }

      // Handle subtitles
      if (video.subtitles && video.subtitles.length > 0) {
        const newSubtitles = [...video.subtitles];
        let subtitlesUpdated = false;

        newSubtitles.forEach((sub, index) => {
          let absoluteSourcePath = "";
          // Construct absolute source path based on DB path
          if (sub.path.startsWith("/videos/")) {
            absoluteSourcePath = path.join(
              VIDEOS_DIR,
              sub.path.replace("/videos/", "")
            );
          } else if (sub.path.startsWith("/subtitles/")) {
            // sub.path is like /subtitles/Collection/file.vtt
            // SUBTITLES_DIR is uploads/subtitles
            absoluteSourcePath = path.join(
              UPLOADS_DIR,
              sub.path.replace(/^\//, "")
            ); // path.join(headers...) -> uploads/subtitles/...
          }

          let targetSubDir = "";
          let newWebPath = "";

          if (sub.path.startsWith("/videos/")) {
            targetSubDir = targetVideoDir; // Calculated above (root or other collection)
            newWebPath = `${videoPathPrefix}/${path.basename(sub.path)}`;
          } else if (sub.path.startsWith("/subtitles/")) {
            // Should move to root subtitles or other collection subtitles
            if (otherCollection) {
              const otherName = otherCollection.name || otherCollection.title;
              if (otherName) {
                targetSubDir = path.join(SUBTITLES_DIR, otherName);
                newWebPath = `/subtitles/${otherName}/${path.basename(
                  sub.path
                )}`;
              }
            } else {
              // Move to root subtitles dir
              targetSubDir = SUBTITLES_DIR;
              newWebPath = `/subtitles/${path.basename(sub.path)}`;
            }
          }

          if (absoluteSourcePath && targetSubDir && newWebPath) {
            const targetSubPath = path.join(
              targetSubDir,
              path.basename(sub.path)
            );

            // Ensure correct paths for move
            // Need to handle potential double slashes or construction issues if any
            if (
              fs.existsSync(absoluteSourcePath) &&
              absoluteSourcePath !== targetSubPath
            ) {
              moveFile(absoluteSourcePath, targetSubPath);
              newSubtitles[index] = {
                ...sub,
                path: newWebPath,
              };
              subtitlesUpdated = true;
            }
          }
        });

        if (subtitlesUpdated) {
          updates.subtitles = newSubtitles;
          updated = true;
        }
      }

      if (updated) {
        updateVideo(videoId, updates);
      }
    }
  }

  return collection;
}

export function deleteCollectionWithFiles(collectionId: string): boolean {
  const collection = getCollectionById(collectionId);
  if (!collection) return false;

  const collectionName = collection.name || collection.title;
  const allCollections = getCollections();

  if (collection.videos && collection.videos.length > 0) {
    collection.videos.forEach((videoId) => {
      const video = getVideoById(videoId);
      if (video) {
        // Move files back to root
        const updates: Partial<Video> = {};
        let updated = false;

        if (video.videoFilename) {
          const currentVideoPath = findVideoFile(
            video.videoFilename,
            allCollections
          );
          const targetVideoPath = path.join(VIDEOS_DIR, video.videoFilename);

          if (currentVideoPath && currentVideoPath !== targetVideoPath) {
            moveFile(currentVideoPath, targetVideoPath);
            updates.videoPath = `/videos/${video.videoFilename}`;
            updated = true;
          }
        }

        if (video.thumbnailFilename) {
          const currentImagePath = findImageFile(
            video.thumbnailFilename,
            allCollections
          );
          const targetImagePath = path.join(
            IMAGES_DIR,
            video.thumbnailFilename
          );

          if (currentImagePath && currentImagePath !== targetImagePath) {
            moveFile(currentImagePath, targetImagePath);
            updates.thumbnailPath = `/images/${video.thumbnailFilename}`;
            updated = true;
          }
        }

        // Handle subtitles
        if (video.subtitles && video.subtitles.length > 0) {
          const newSubtitles = [...video.subtitles];
          let subtitlesUpdated = false;

          newSubtitles.forEach((sub, index) => {
            let absoluteSourcePath = "";
            // Construct absolute source path based on DB path
            if (sub.path.startsWith("/videos/")) {
              absoluteSourcePath = path.join(
                VIDEOS_DIR,
                sub.path.replace("/videos/", "")
              );
            } else if (sub.path.startsWith("/subtitles/")) {
              absoluteSourcePath = path.join(
                UPLOADS_DIR,
                sub.path.replace(/^\//, "")
              );
            }

            let targetSubDir = "";
            let newWebPath = "";

            if (sub.path.startsWith("/videos/")) {
              targetSubDir = VIDEOS_DIR;
              newWebPath = `/videos/${path.basename(sub.path)}`;
            } else if (sub.path.startsWith("/subtitles/")) {
              // Move to root subtitles dir
              targetSubDir = SUBTITLES_DIR;
              newWebPath = `/subtitles/${path.basename(sub.path)}`;
            }

            if (absoluteSourcePath && targetSubDir && newWebPath) {
              const targetSubPath = path.join(
                targetSubDir,
                path.basename(sub.path)
              );

              if (
                fs.existsSync(absoluteSourcePath) &&
                absoluteSourcePath !== targetSubPath
              ) {
                moveFile(absoluteSourcePath, targetSubPath);
                newSubtitles[index] = {
                  ...sub,
                  path: newWebPath,
                };
                subtitlesUpdated = true;
              }
            }
          });

          if (subtitlesUpdated) {
            updates.subtitles = newSubtitles;
            updated = true;
          }
        }

        if (updated) {
          updateVideo(videoId, updates);
        }
      }
    });
  }

  // Delete collection directory if exists and empty
  if (collectionName) {
    const collectionVideoDir = path.join(VIDEOS_DIR, collectionName);
    const collectionImageDir = path.join(IMAGES_DIR, collectionName);

    try {
      if (
        fs.existsSync(collectionVideoDir) &&
        fs.readdirSync(collectionVideoDir).length === 0
      ) {
        fs.rmdirSync(collectionVideoDir);
      }
      if (
        fs.existsSync(collectionImageDir) &&
        fs.readdirSync(collectionImageDir).length === 0
      ) {
        fs.rmdirSync(collectionImageDir);
      }
    } catch (e) {
      logger.error(
        "Error removing collection directories",
        e instanceof Error ? e : new Error(String(e))
      );
    }
  }

  return deleteCollection(collectionId);
}

export function deleteCollectionAndVideos(collectionId: string): boolean {
  const collection = getCollectionById(collectionId);
  if (!collection) return false;

  const collectionName = collection.name || collection.title;

  // Delete all videos in the collection
  if (collection.videos && collection.videos.length > 0) {
    collection.videos.forEach((videoId) => {
      deleteVideo(videoId);
    });
  }

  // Delete collection directory if exists
  if (collectionName) {
    const collectionVideoDir = path.join(VIDEOS_DIR, collectionName);
    const collectionImageDir = path.join(IMAGES_DIR, collectionName);

    try {
      if (fs.existsSync(collectionVideoDir)) {
        fs.rmdirSync(collectionVideoDir);
      }
      if (fs.existsSync(collectionImageDir)) {
        fs.rmdirSync(collectionImageDir);
      }
    } catch (e) {
      logger.error(
        "Error removing collection directories",
        e instanceof Error ? e : new Error(String(e))
      );
    }
  }

  return deleteCollection(collectionId);
}
