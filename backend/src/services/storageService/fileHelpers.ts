import fs from "fs-extra";
import path from "path";
import {
  AVATARS_DIR,
  IMAGES_DIR,
  IMAGES_SMALL_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import { logger } from "../../utils/logger";
import {
  isPathWithinDirectories,
  sanitizePathSegment,
} from "../../utils/security";
import { Collection } from "./types";

const ALLOWED_STORAGE_DIRS = [
  VIDEOS_DIR,
  IMAGES_DIR,
  IMAGES_SMALL_DIR,
  SUBTITLES_DIR,
  AVATARS_DIR,
]
  .filter((dir): dir is string => typeof dir === "string" && dir.length > 0)
  .map((dir) => path.resolve(dir));

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

function splitSafeSegments(segment: string): string[] {
  return segment
    .split(/[\\/]+/)
    .map((part) => sanitizePathSegment(part))
    .filter((part) => part.length > 0);
}

export function buildStoragePath(
  baseDir: string,
  ...segments: Array<string | null | undefined>
): string {
  const safeSegments = segments.flatMap((segment) =>
    typeof segment === "string" ? splitSafeSegments(segment) : []
  );
  const targetPath =
    safeSegments.length > 0 ? path.join(baseDir, ...safeSegments) : baseDir;
  return validateSafePath(targetPath);
}

export function pathExists(targetPath: string): boolean {
  const safePath = validateSafePath(targetPath);
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  return fs.existsSync(safePath);
}

export function listDirectory(targetPath: string): string[] {
  const safePath = validateSafePath(targetPath);
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  return fs.readdirSync(safePath);
}

export function renamePath(sourcePath: string, destPath: string): void {
  const safeSourcePath = validateSafePath(sourcePath);
  const safeDestPath = validateSafePath(destPath);
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  fs.renameSync(safeSourcePath, safeDestPath);
}

export function removeFileIfExists(targetPath: string): void {
  const safePath = validateSafePath(targetPath);
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (fs.existsSync(safePath)) {
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    fs.unlinkSync(safePath);
  }
}

export function removeDirectoryIfEmpty(targetPath: string): boolean {
  const safePath = validateSafePath(targetPath);
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (!fs.existsSync(safePath)) {
    return false;
  }
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (fs.readdirSync(safePath).length > 0) {
    return false;
  }
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  fs.rmdirSync(safePath);
  return true;
}

export function removeDirectoryRecursive(targetPath: string): void {
  const safePath = validateSafePath(targetPath);
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (fs.existsSync(safePath)) {
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    fs.rmSync(safePath, { recursive: true, force: true });
  }
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
