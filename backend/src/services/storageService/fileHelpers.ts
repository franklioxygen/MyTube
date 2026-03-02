import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import {
  isPathWithinDirectories,
  sanitizePathSegment,
} from "../../utils/security";
import { Collection } from "./types";

const ALLOWED_STORAGE_DIRS = [VIDEOS_DIR, IMAGES_DIR, SUBTITLES_DIR].map((dir) =>
  path.resolve(dir)
);

/**
 * Validates that a path is within the allowed directories (Videos, Images, Subtitles)
 * @throws Error if path is outside allowed directories
 */
function validateSafePath(targetPath: string): string {
  const resolvedPath = path.resolve(targetPath);
  const isSafe = isPathWithinDirectories(resolvedPath, ALLOWED_STORAGE_DIRS);

  if (!isSafe) {
    throw new Error(
      `Security Error: Path traversal attempted. Access denied to ${targetPath}`
    );
  }

  return resolvedPath;
}

export function findVideoFile(
  filename: string,
  collections: Collection[] = []
): string | null {
  try {
    // Sanitize filename to prevent path traversal
    const sanitizedFilename = sanitizePathSegment(filename);
    if (!sanitizedFilename) {
      logger.warn(`Invalid filename provided: ${filename}`);
      return null;
    }

    // Validate and check root path
    const rootPath = path.join(VIDEOS_DIR, sanitizedFilename);
    try {
      validateSafePath(rootPath);
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (fs.existsSync(rootPath)) return rootPath;
    } catch (e) {
      // Skip unsafe root path
      logger.warn(
        `Unsafe root path detected for video file: ${sanitizedFilename}`
      );
    }

    for (const collection of collections) {
        const collectionName = collection.name || collection.title;
        if (collectionName) {
          // Sanitize collection name to prevent path traversal
          const sanitizedName = sanitizePathSegment(collectionName);
        if (!sanitizedName) {
          // Skip if sanitization removed everything
          continue;
        }

        // Construct path and verify it is safe
        const collectionPath = path.join(
          VIDEOS_DIR,
          sanitizedName,
          sanitizedFilename
        );
        try {
          validateSafePath(collectionPath);
          // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
          if (fs.existsSync(collectionPath)) return collectionPath;
        } catch (e) {
          // Skip unsafe paths
          continue;
        }
      }
    }
  } catch (error) {
    logger.error(
      "Error finding video file",
      error instanceof Error ? error : new Error(String(error))
    );
  }
  return null;
}

export function findImageFile(
  filename: string,
  collections: Collection[] = []
): string | null {
  try {
    // Sanitize filename to prevent path traversal
    const sanitizedFilename = sanitizePathSegment(filename);
    if (!sanitizedFilename) {
      logger.warn(`Invalid filename provided: ${filename}`);
      return null;
    }

    // Validate and check root path
    const rootPath = path.join(IMAGES_DIR, sanitizedFilename);
    try {
      validateSafePath(rootPath);
      if (fs.existsSync(rootPath)) return rootPath;
    } catch (e) {
      // Skip unsafe root path
      logger.warn(
        `Unsafe root path detected for image file: ${sanitizedFilename}`
      );
    }

    for (const collection of collections) {
        const collectionName = collection.name || collection.title;
        if (collectionName) {
          // Sanitize collection name to prevent path traversal
          const sanitizedName = sanitizePathSegment(collectionName);
        if (!sanitizedName) {
          // Skip if sanitization removed everything
          continue;
        }

        const collectionPath = path.join(
          IMAGES_DIR,
          sanitizedName,
          sanitizedFilename
        );
        try {
          validateSafePath(collectionPath);
          if (fs.existsSync(collectionPath)) return collectionPath;
        } catch (e) {
          continue;
        }
      }
    }
  } catch (error) {
    logger.error(
      "Error finding image file",
      error instanceof Error ? error : new Error(String(error))
    );
  }
  return null;
}

export function moveFile(sourcePath: string, destPath: string): void {
  try {
    // Validate strict path security
    validateSafePath(sourcePath);
    validateSafePath(destPath);

    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(sourcePath)) {
      fs.ensureDirSync(path.dirname(destPath));
      fs.moveSync(sourcePath, destPath, { overwrite: true });
      logger.info(`Moved file from ${sourcePath} to ${destPath}`);
    }
  } catch (error) {
    logger.error(
      `Error moving file from ${sourcePath} to ${destPath}`,
      error instanceof Error ? error : new Error(String(error))
    );
    // Re-throw file operation errors as they're critical
    throw error;
  }
}
