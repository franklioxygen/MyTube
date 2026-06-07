import { v4 as uuidv4 } from "uuid";
import {
  AuthorOrganizationMode,
  resolveAuthorOrganizationMode,
  usesAuthorCollectionLinking,
} from "../../types/settings";
import { logger } from "../../utils/logger";
import { moveAllFilesToCollection } from "./collectionFileManager";
import {
  deleteCollection,
  generateUniqueCollectionName,
  getCollectionById,
  getCollections,
  getCollectionByName,
  getCollectionsByVideoId,
  linkVideoToCollection,
  removeVideoFromCollection,
  saveCollection,
} from "./collections";
import { Collection } from "./types";
import { getVideoById, updateVideo } from "./videos";

const replaceInvalidFilesystemCharacters = (value: string): string => {
  let sanitized = "";

  for (const char of value) {
    const code = char.charCodeAt(0);
    const isControlCharacter = code >= 0 && code <= 31;
    sanitized += isControlCharacter || /[<>:"/\\|?*]/.test(char) ? "_" : char;
  }

  return sanitized;
};

/**
 * Validates a collection name to ensure it's safe for filesystem use
 * @param name - The collection name to validate
 * @returns The sanitized name or null if invalid
 */
export function validateCollectionName(name: string): string | null {
  if (!name || typeof name !== "string") {
    return null;
  }

  // Remove leading/trailing whitespace
  const trimmed = name.trim();

  // Check minimum length
  if (trimmed.length === 0) {
    return null;
  }

  // Check maximum length (filesystem limits, typically 255 chars)
  if (trimmed.length > 200) {
    logger.warn(
      `Collection name too long (${trimmed.length} chars), truncating to 200 chars`
    );
    return trimmed.substring(0, 200).trim();
  }

  // Remove or replace invalid filesystem characters
  // Windows: < > : " / \ | ? *
  // Unix: / (forward slash)
  const sanitized = replaceInvalidFilesystemCharacters(trimmed)
    .replace(/\.+$/, "") // Remove trailing dots (Windows restriction)
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();

  // Ensure we still have a valid name after sanitization
  if (sanitized.length === 0) {
    return null;
  }

  // Check for reserved names (Windows)
  const reservedNames = [
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
  ];
  const upperName = sanitized.toUpperCase();
  if (reservedNames.includes(upperName)) {
    logger.warn(
      `Collection name "${sanitized}" is a reserved name, appending underscore`
    );
    return `${sanitized}_`;
  }

  return sanitized;
}

/**
 * Finds or creates a collection by author name with race condition handling
 * Uses atomic operations to prevent duplicate collections from concurrent requests
 * @param authorName - The author name to use for the collection
 * @returns The collection or null if creation failed
 */
export function findOrCreateAuthorCollection(
  authorName: string
): Collection | null {
  if (!authorName || authorName === "Unknown") {
    return null;
  }

  // Validate and sanitize the author name
  const validatedName = validateCollectionName(authorName);
  if (!validatedName) {
    logger.warn(
      `Invalid author name for collection: "${authorName}", skipping collection creation`
    );
    return null;
  }

  // First, try to find existing collection
  let collection = getCollectionByName(validatedName);

  if (collection) {
    return collection;
  }

  // Collection doesn't exist, create it
  // Use generateUniqueCollectionName to handle potential race conditions
  // where another process might have created a collection with the same name
  const uniqueName = generateUniqueCollectionName(validatedName);

  // Double-check that the collection still doesn't exist (race condition check)
  collection = getCollectionByName(uniqueName);
  if (collection) {
    return collection;
  }

  // Create new collection with UUID
  try {
    const newCollection: Collection = {
      id: uuidv4(),
      name: uniqueName,
      title: uniqueName,
      videos: [],
      createdAt: new Date().toISOString(),
    };

    saveCollection(newCollection);
    logger.info(`Created new collection for author: ${uniqueName}`);
    return newCollection;
  } catch (error) {
    // If save fails, it might be due to a race condition
    // Try to get the collection one more time
    collection = getCollectionByName(uniqueName);
    if (collection) {
      logger.info(
        `Collection "${uniqueName}" was created by another process, using existing collection`
      );
      return collection;
    }

    logger.error(
      `Error creating collection for author "${uniqueName}":`,
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }
}

/**
 * Adds a video to an author's collection if the setting is enabled.
 * When downloadFilenamePresetId is not 'legacy', the file is NOT moved —
 * only the collection membership record is created, because the template
 * already owns the directory structure.
 *
 * @param videoId - The ID of the video to add
 * @param authorName - The author name
 * @param saveAuthorFilesToCollection - Whether to save to author collection
 * @param downloadFilenamePresetId - Current naming preset; non-legacy skips file moves
 * @returns The collection the video was added to, or null
 */
export function addVideoToAuthorCollection(
  videoId: string,
  authorName: string | undefined,
  authorOrganizationMode: AuthorOrganizationMode | boolean | undefined,
  downloadFilenamePresetId?: string,
  options?: { moveFiles?: boolean }
): Collection | null {
  const normalizedMode = resolveAuthorOrganizationMode({
    authorOrganizationMode:
      typeof authorOrganizationMode === "string"
        ? authorOrganizationMode
        : undefined,
    saveAuthorFilesToCollection:
      typeof authorOrganizationMode === "boolean"
        ? authorOrganizationMode
        : undefined,
  });

  // Check if feature is enabled
  if (!usesAuthorCollectionLinking(normalizedMode)) {
    return null;
  }

  // Validate author name
  if (!authorName || authorName === "Unknown") {
    return null;
  }

  try {
    // Find or create the collection
    const collection = findOrCreateAuthorCollection(authorName);

    if (!collection) {
      logger.warn(
        `Failed to find or create collection for author: ${authorName}`
      );
      return null;
    }

    // For non-legacy naming modes the template already owns the directory structure.
    // Only add the membership record; do not move files.
    const isLegacy = !downloadFilenamePresetId || downloadFilenamePresetId === "legacy";
    const updatedCollection = linkVideoToCollection(collection.id, videoId, {
      moveFiles: options?.moveFiles ?? isLegacy,
    });

    if (updatedCollection) {
      logger.info(
        `Added video to author collection: ${authorName}${
          (options?.moveFiles ?? isLegacy) ? " (with file move)" : " (membership only)"
        }`
      );
      return updatedCollection;
    } else {
      logger.warn(
        `Failed to add video ${videoId} to collection for author: ${authorName}`
      );
      return null;
    }
  } catch (error) {
    logger.error(
      "Error adding video to author collection:",
      error instanceof Error ? error : new Error(String(error))
    );
    // Don't fail the download if collection add fails
    return null;
  }
}

function moveVideoFilesToAuthorFolder(
  videoId: string,
  authorName: string
): boolean {
  const validatedAuthorName = validateCollectionName(authorName);
  if (!validatedAuthorName) {
    return false;
  }

  const video = getVideoById(videoId);
  if (!video) {
    return false;
  }

  const updates = moveAllFilesToCollection(
    video,
    validatedAuthorName,
    getCollections()
  );

  if (Object.keys(updates).length === 0) {
    return false;
  }

  updateVideo(videoId, updates);
  logger.info(`Moved video files into author folder: ${validatedAuthorName}`);
  return true;
}

export interface AuthorOrganizationResult {
  collection: Collection | null;
  filesMoved: boolean;
}

export interface AuthorCollectionCleanupResult {
  scannedCollections: number;
  matchedAuthorCollections: number;
  removedMemberships: number;
  affectedVideos: number;
  deletedCollections: string[];
  skippedCollections: string[];
  details: string[];
}

function getCollectionDisplayName(collection: Collection): string {
  return collection.name || collection.title || collection.id;
}

function isAuthorCollectionCandidate(collection: Collection): {
  collectionName: string;
  videoIds: string[];
} | null {
  const collectionName = getCollectionDisplayName(collection);
  if (!collectionName || collection.videos.length === 0) {
    return null;
  }

  for (const videoId of collection.videos) {
    const video = getVideoById(videoId);
    if (!video?.author) {
      return null;
    }

    const sanitizedAuthorName = validateCollectionName(video.author);
    if (!sanitizedAuthorName || sanitizedAuthorName !== collectionName) {
      return null;
    }
  }

  return {
    collectionName,
    videoIds: [...collection.videos],
  };
}

export function cleanupRedundantAuthorCollectionLinks(): AuthorCollectionCleanupResult {
  const results: AuthorCollectionCleanupResult = {
    scannedCollections: 0,
    matchedAuthorCollections: 0,
    removedMemberships: 0,
    affectedVideos: 0,
    deletedCollections: [],
    skippedCollections: [],
    details: [],
  };
  const affectedVideoIds = new Set<string>();

  for (const collection of getCollections()) {
    results.scannedCollections += 1;

    const candidate = isAuthorCollectionCandidate(collection);
    if (!candidate) {
      continue;
    }

    results.matchedAuthorCollections += 1;
    let removedFromThisCollection = 0;

    for (const videoId of candidate.videoIds) {
      const memberships = getCollectionsByVideoId(videoId);
      const nonAuthorMemberships = memberships.filter(
        (membership) => membership.id !== collection.id
      );

      if (nonAuthorMemberships.length === 0) {
        continue;
      }

      const updatedCollection = removeVideoFromCollection(collection.id, videoId, {
        moveFiles: false,
      });

      if (updatedCollection) {
        removedFromThisCollection += 1;
        results.removedMemberships += 1;
        affectedVideoIds.add(videoId);
      }
    }

    if (removedFromThisCollection === 0) {
      results.skippedCollections.push(candidate.collectionName);
      continue;
    }

    results.details.push(
      `Removed ${removedFromThisCollection} redundant author link${
        removedFromThisCollection === 1 ? "" : "s"
      } from "${candidate.collectionName}".`
    );

    const updatedCollection = getCollectionById(collection.id);
    if (updatedCollection && updatedCollection.videos.length === 0) {
      deleteCollection(collection.id);
      results.deletedCollections.push(candidate.collectionName);
      results.details.push(`Deleted empty author collection "${candidate.collectionName}".`);
    }
  }

  results.affectedVideos = affectedVideoIds.size;
  return results;
}

export function organizeVideoByAuthor(
  videoId: string,
  authorName: string | undefined,
  authorOrganizationMode: AuthorOrganizationMode | undefined,
  downloadFilenamePresetId?: string,
  options?: { moveFiles?: boolean }
): AuthorOrganizationResult | null {
  const normalizedMode = resolveAuthorOrganizationMode({
    authorOrganizationMode,
  });

  if (normalizedMode === "root") {
    return null;
  }

  if (!authorName || authorName === "Unknown") {
    return null;
  }

  const isLegacy =
    !downloadFilenamePresetId || downloadFilenamePresetId === "legacy";
  const shouldMoveFiles = options?.moveFiles ?? isLegacy;

  if (usesAuthorCollectionLinking(normalizedMode)) {
    const collection = addVideoToAuthorCollection(
      videoId,
      authorName,
      normalizedMode,
      downloadFilenamePresetId,
      { moveFiles: shouldMoveFiles }
    );

    return collection
      ? {
          collection,
          filesMoved: shouldMoveFiles,
        }
      : null;
  }

  if (!shouldMoveFiles) {
    return null;
  }

  const filesMoved = moveVideoFilesToAuthorFolder(videoId, authorName);
  return filesMoved ? { collection: null, filesMoved: true } : null;
}
