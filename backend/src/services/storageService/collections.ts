import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import {
    cleanupCollectionDirectories,
    moveAllFilesFromCollection,
    moveAllFilesToCollection,
    renameCollectionDirectories,
    updateVideoPathsForCollectionRename,
} from "./collectionFileManager";
import {
    atomicUpdateCollection as atomicUpdateCollectionRepo,
    deleteCollection as deleteCollectionRepo,
    getCollectionById as getCollectionByIdRepo,
    getCollectionByName as getCollectionByNameRepo,
    getCollectionByVideoId as getCollectionByVideoIdRepo,
    getCollections as getCollectionsRepo,
    saveCollection as saveCollectionRepo,
} from "./collectionRepository";
import { Collection } from "./types";
import { deleteVideo, getVideoById, updateVideo } from "./videos";

export function getCollections(): Collection[] {
  return getCollectionsRepo();
}

export function getCollectionById(id: string): Collection | undefined {
  return getCollectionByIdRepo(id);
}

/**
 * Find a collection that contains a specific video
 */
export function getCollectionByVideoId(
  videoId: string
): Collection | undefined {
  return getCollectionByVideoIdRepo(videoId);
}

/**
 * Find a collection by name or title
 */
export function getCollectionByName(name: string): Collection | undefined {
  return getCollectionByNameRepo(name);
}

/**
 * Generate a unique collection name by appending a number if the name already exists
 * @param baseName - The desired collection name
 * @returns A unique collection name
 */
export function generateUniqueCollectionName(baseName: string): string {
  const existingCollection = getCollectionByNameRepo(baseName);
  if (!existingCollection) {
    return baseName;
  }

  // Try appending numbers: "Name (2)", "Name (3)", etc.
  let counter = 2;
  let uniqueName = `${baseName} (${counter})`;

  while (getCollectionByNameRepo(uniqueName)) {
    counter++;
    uniqueName = `${baseName} (${counter})`;
  }

  logger.info(
    `Collection name "${baseName}" already exists, using "${uniqueName}" instead`
  );
  return uniqueName;
}

export function saveCollection(collection: Collection): Collection {
  return saveCollectionRepo(collection);
}

export function atomicUpdateCollection(
  id: string,
  updateFn: (collection: Collection) => Collection | null
): Collection | null {
  return atomicUpdateCollectionRepo(id, updateFn);
}

export function deleteCollection(id: string): boolean {
  return deleteCollectionRepo(id);
}

export function addVideoToCollection(
  collectionId: string,
  videoId: string
): Collection | null {
  const allCollections = getCollections();

  // First, check if video is already in another collection and remove it
  const currentCollection = allCollections.find(
    (c) => c.videos.includes(videoId) && c.id !== collectionId
  );

  if (currentCollection) {
    // Remove video from current collection (but don't move files yet)
    atomicUpdateCollection(currentCollection.id, (c) => {
      c.videos = c.videos.filter((v) => v !== videoId);
      return c;
    });
  }

  // Now add video to the new collection
  const collection = atomicUpdateCollection(collectionId, (c) => {
    if (!c.videos.includes(videoId)) {
      c.videos.push(videoId);
    }
    return c;
  });

  if (collection) {
    const video = getVideoById(videoId);
    const collectionName = collection.name || collection.title;

    if (video && collectionName) {
      // Use file manager to move all files to the new collection
      // This will handle moving from the old collection directory (if any) to the new one
      const updates = moveAllFilesToCollection(
        video,
        collectionName,
        allCollections
      );

      if (Object.keys(updates).length > 0) {
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
      let targetSubDir = SUBTITLES_DIR;
      let videoPathPrefix = "/videos";
      let imagePathPrefix = "/images";
      let subtitlePathPrefix: string | undefined = undefined;

      if (otherCollection) {
        const otherName = otherCollection.name || otherCollection.title;
        if (otherName) {
          // Sanitize collection name to prevent path traversal
          const sanitizedOtherName = otherName
            .replace(/\.\./g, "")
            .replace(/[\/\\]/g, "")
            .trim();
          if (sanitizedOtherName) {
            targetVideoDir = path.join(VIDEOS_DIR, sanitizedOtherName);
            targetImageDir = path.join(IMAGES_DIR, sanitizedOtherName);
            targetSubDir = path.join(SUBTITLES_DIR, sanitizedOtherName);
            videoPathPrefix = `/videos/${sanitizedOtherName}`;
            imagePathPrefix = `/images/${sanitizedOtherName}`;
            subtitlePathPrefix = `/subtitles/${sanitizedOtherName}`;
          }
        }
      }

      // Use file manager to move all files
      const updates = moveAllFilesFromCollection(
        video,
        targetVideoDir,
        targetImageDir,
        targetSubDir,
        videoPathPrefix,
        imagePathPrefix,
        subtitlePathPrefix,
        allCollections
      );

      if (Object.keys(updates).length > 0) {
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
        // Move files back to root (no collection)
        const updates = moveAllFilesFromCollection(
          video,
          VIDEOS_DIR,
          IMAGES_DIR,
          SUBTITLES_DIR,
          "/videos",
          "/images",
          undefined, // No subtitle prefix for root
          allCollections
        );

        if (Object.keys(updates).length > 0) {
          updateVideo(videoId, updates);
        }
      }
    });
  }

  // Delete collection directory if exists and empty
  if (collectionName) {
    cleanupCollectionDirectories(collectionName);
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
    cleanupCollectionDirectories(collectionName);
  }

  return deleteCollection(collectionId);
}

export function renameCollection(id: string, newName: string): Collection | null {
  const collection = getCollectionById(id);
  if (!collection) return null;

  const oldName = collection.name || collection.title;
  if (!oldName) return null;

  if (oldName === newName) return collection;

  const existing = getCollectionByName(newName);
  if (existing && existing.id !== id) {
     throw new Error(`Collection name "${newName}" already exists`);
  }

  // 1. Rename directories
  const dirRenameSuccess = renameCollectionDirectories(oldName, newName);
  if (!dirRenameSuccess) {
    logger.error(`Failed to rename collection directories from "${oldName}" to "${newName}"`);
    throw new Error(`Failed to rename collection directories. Please check logs for details.`);
  }

  // 2. Update collection name in DB
  const updatedCollection = atomicUpdateCollection(id, (c) => {
    c.name = newName;
    c.title = newName;
    return c;
  });

  // 3. Update video paths
  if (updatedCollection && updatedCollection.videos.length > 0) {
    updatedCollection.videos.forEach(videoId => {
      const video = getVideoById(videoId);
      if (video) {
        const updates = updateVideoPathsForCollectionRename(video, oldName, newName);
        if (Object.keys(updates).length > 0) {
          updateVideo(videoId, updates);
        }
      }
    });
  }

  return updatedCollection;
}
