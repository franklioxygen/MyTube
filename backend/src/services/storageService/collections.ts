import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import {
  cleanupCollectionDirectories,
  moveAllFilesFromCollection,
  moveAllFilesToCollection,
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
      // Use file manager to move all files
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
          targetVideoDir = path.join(VIDEOS_DIR, otherName);
          targetImageDir = path.join(IMAGES_DIR, otherName);
          targetSubDir = path.join(SUBTITLES_DIR, otherName);
          videoPathPrefix = `/videos/${otherName}`;
          imagePathPrefix = `/images/${otherName}`;
          subtitlePathPrefix = `/subtitles/${otherName}`;
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
