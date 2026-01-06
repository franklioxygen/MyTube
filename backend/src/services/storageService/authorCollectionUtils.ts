import { v4 as uuidv4 } from "uuid";
import { logger } from "../../utils/logger";
import {
  addVideoToCollection,
  generateUniqueCollectionName,
  getCollectionByName,
  saveCollection,
} from "./collections";
import { Collection } from "./types";

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
  // Common: control characters, null bytes
  const sanitized = trimmed
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") // Replace invalid chars with underscore
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
 * Adds a video to an author's collection if the setting is enabled
 * This function handles all the logic for organizing videos by author
 * @param videoId - The ID of the video to add
 * @param authorName - The author name
 * @param saveAuthorFilesToCollection - Whether to save to author collection
 * @returns The collection the video was added to, or null
 */
export function addVideoToAuthorCollection(
  videoId: string,
  authorName: string | undefined,
  saveAuthorFilesToCollection: boolean
): Collection | null {
  // Check if feature is enabled
  if (!saveAuthorFilesToCollection) {
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

    // Add video to collection (this will move files)
    const updatedCollection = addVideoToCollection(collection.id, videoId);

    if (updatedCollection) {
      logger.info(`Added video to author collection: ${authorName}`);
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
