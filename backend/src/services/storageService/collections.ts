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
    appendVideoToCollection as appendVideoToCollectionRepo,
    deleteCollection as deleteCollectionRepo,
    getCollectionById as getCollectionByIdRepo,
    getCollectionByName as getCollectionByNameRepo,
    getCollectionBySourceKey as getCollectionBySourceKeyRepo,
    getCollectionByVideoId as getCollectionByVideoIdRepo,
    getCollectionsByVideoId as getCollectionsByVideoIdRepo,
    getCollections as getCollectionsRepo,
    saveCollection as saveCollectionRepo,
} from "./collectionRepository";
import { Collection } from "./types";
import { buildStoragePath } from "./fileHelpers";
import { validateCollectionName } from "./authorCollectionUtils";
import { deleteVideo, getVideoById, updateVideo } from "./videos";
import { getSettings } from "./settings";
import { resolveAuthorOrganizationMode } from "../../types/settings";
import { isLegacyFilenameNaming } from "../filenameTemplate/config";

type CollectionLinkOptions = {
  moveFiles?: boolean;
  order?: number;
};

type CollectionUnlinkOptions = {
  moveFiles?: boolean;
};

function insertVideoAtRequestedOrder(
  collection: Collection,
  videoId: string,
  order?: number,
): void {
  if (typeof order !== "number" || !Number.isFinite(order)) {
    if (!collection.videos.includes(videoId)) {
      collection.videos.push(videoId);
    }
    return;
  }

  const normalizedOrder = Math.max(1, Math.floor(order));
  const existingIndex = collection.videos.indexOf(videoId);
  if (existingIndex >= 0) {
    collection.videos.splice(existingIndex, 1);
  }

  const targetIndex = Math.min(
    Math.max(0, normalizedOrder - 1),
    collection.videos.length,
  );
  collection.videos.splice(targetIndex, 0, videoId);
}

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

export function getCollectionsByVideoId(videoId: string): Collection[] {
  return getCollectionsByVideoIdRepo(videoId);
}

/**
 * Find a collection by name or title
 */
export function getCollectionByName(name: string): Collection | undefined {
  return getCollectionByNameRepo(name);
}

export function getCollectionBySourceKey(
  platform: string,
  type: string,
  mid: string,
  id: string
): Collection | undefined {
  return getCollectionBySourceKeyRepo(platform, type, mid, id);
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

/**
 * Append a single video to the end of a collection via a single guarded INSERT
 * (no full link-set rebuild). Returns the updated collection or null if the
 * collection does not exist.
 */
export function appendVideoToCollection(
  collectionId: string,
  videoId: string
): Collection | null {
  return appendVideoToCollectionRepo(collectionId, videoId);
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

export function linkVideoToCollection(
  collectionId: string,
  videoId: string,
  options?: CollectionLinkOptions
): Collection | null {
  // The full saveCollection rebuild (delete every link + re-insert each with a
  // per-row existence check) is only needed when an insert must shift existing
  // rows — i.e. a mid-list insert. Both a plain append (no order) and an insert
  // *past the current end* land the video last, so they can use the single
  // guarded INSERT fast path. The latter is the common case for ordered
  // backfills (e.g. Bilibili collections append in increasing playlist order),
  // which previously paid an O(n) rebuild on every video.
  const requestedOrder = options?.order;
  const requestsSpecificOrder =
    typeof requestedOrder === "number" && Number.isFinite(requestedOrder);

  let collection: Collection | null;
  if (requestsSpecificOrder) {
    const existing = getCollectionByIdRepo(collectionId);
    const appendsAtEnd =
      !!existing &&
      !existing.videos.includes(videoId) &&
      Math.floor(requestedOrder) > existing.videos.length;
    collection = appendsAtEnd
      ? appendVideoToCollectionRepo(collectionId, videoId)
      : atomicUpdateCollection(collectionId, (c) => {
          insertVideoAtRequestedOrder(c, videoId, requestedOrder);
          return c;
        });
  } else {
    collection = appendVideoToCollectionRepo(collectionId, videoId);
  }

  if (collection) {
    const settings = getSettings();
    const shouldMoveFiles =
      options?.moveFiles ??
      (isLegacyFilenameNaming(settings) &&
        resolveAuthorOrganizationMode(settings) !== "author_folder_only");
    if (shouldMoveFiles) {
      const video = getVideoById(videoId);
      const collectionName = collection.name || collection.title;
      const allCollections = getCollections();

      if (video && collectionName) {
        // Use file manager to move all files to the new collection
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
  }

  return collection;
}

export function moveVideoToExclusiveCollection(
  collectionId: string,
  videoId: string,
  options?: CollectionLinkOptions
): Collection | null {
  const allCollections = getCollections();

  // First, remove the video from every other collection it currently belongs to.
  const currentCollections = allCollections.filter(
    (c) => c.videos.includes(videoId) && c.id !== collectionId
  );

  for (const currentCollection of currentCollections) {
    // Remove video from current collection (but don't move files yet)
    atomicUpdateCollection(currentCollection.id, (c) => {
      c.videos = c.videos.filter((v) => v !== videoId);
      return c;
    });
  }

  return linkVideoToCollection(collectionId, videoId, options);
}

export function addVideoToCollection(
  collectionId: string,
  videoId: string,
  options?: CollectionLinkOptions
): Collection | null {
  return linkVideoToCollection(collectionId, videoId, options);
}

export function removeVideoFromCollection(
  collectionId: string,
  videoId: string,
  options?: CollectionUnlinkOptions
): Collection | null {
  const collection = atomicUpdateCollection(collectionId, (c) => {
    c.videos = c.videos.filter((v) => v !== videoId);
    return c;
  });

  if (collection) {
    const shouldMoveFiles =
      options?.moveFiles ?? isLegacyFilenameNaming(getSettings());
    if (!shouldMoveFiles) {
      return collection;
    }

    const video = getVideoById(videoId);
    const allCollections = getCollections();

    if (video) {
      const organizationMode = resolveAuthorOrganizationMode(getSettings());

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

      // Use the same validation helper as the author-organization path so the
      // unlink target matches the folder a video is actually organized into
      // (validateCollectionName replaces characters like ?, :, trailing dots,
      // and reserved names that the ad-hoc sanitizer left intact).
      const sanitizedAuthor = video.author
        ? validateCollectionName(video.author) ?? ""
        : "";

      if (organizationMode === "author_folder_only" && sanitizedAuthor) {
        // Under author_folder_only the canonical home is always the author folder,
        // even when the video still belongs to another collection. A collection is
        // a logical grouping only, so unlinking must not relocate files into a
        // sibling collection folder or dump them at the storage root
        // (issue #295 1-B follow-on). This takes priority over otherCollection.
        targetVideoDir = buildStoragePath(VIDEOS_DIR, sanitizedAuthor);
        targetImageDir = buildStoragePath(IMAGES_DIR, sanitizedAuthor);
        targetSubDir = buildStoragePath(SUBTITLES_DIR, sanitizedAuthor);
        videoPathPrefix = `/videos/${sanitizedAuthor}`;
        imagePathPrefix = `/images/${sanitizedAuthor}`;
        subtitlePathPrefix = `/subtitles/${sanitizedAuthor}`;
      } else if (otherCollection) {
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

  if (collection.videos && collection.videos.length > 0) {
    const shouldMoveFiles = isLegacyFilenameNaming(getSettings());
    for (const videoId of [...collection.videos]) {
      removeVideoFromCollection(collectionId, videoId, {
        moveFiles: shouldMoveFiles,
      });
    }
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
