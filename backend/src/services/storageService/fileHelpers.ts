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
  ensureDirSafeSync,
  isPathWithinDirectories,
  moveSafeSync,
  normalizeSafeAbsolutePath,
  pathExistsTrustedSync,
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
  .filter((dir): dir is string => typeof dir === "string" && dir.length > 0);

class SafePathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafePathValidationError";
  }
}

/**
 * Validates that a path is within the allowed directories (Videos, Images, Subtitles)
 * @throws Error if path is outside allowed directories
 */
function validateSafePath(targetPath: string): string {
  let resolvedPath: string;
  try {
    resolvedPath = normalizeSafeAbsolutePath(targetPath);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Invalid path: ${targetPath}`;
    throw new SafePathValidationError(message);
  }
  const isSafe = isPathWithinDirectories(resolvedPath, ALLOWED_STORAGE_DIRS);

  if (!isSafe) {
    throw new SafePathValidationError(
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

function tryBuildStoragePath(
  baseDir: string,
  ...segments: Array<string | null | undefined>
): string | null {
  try {
    return buildStoragePath(baseDir, ...segments);
  } catch (error) {
    if (error instanceof SafePathValidationError) {
      return null;
    }
    throw error;
  }
}

export function buildStoragePath(
  baseDir: string,
  ...segments: Array<string | null | undefined>
): string {
  const safeSegments = segments.flatMap((segment) =>
    typeof segment === "string" ? splitSafeSegments(segment) : []
  );
  const targetPath = safeSegments.reduce(
    (currentPath, segment) => `${currentPath}${path.sep}${segment}`,
    baseDir
  );
  return validateSafePath(targetPath);
}

function readDirectoryEntries(targetPath: string): string[] {
  const safePath = validateSafePath(targetPath);
  const directory = fs.opendirSync(safePath);
  try {
    const entries: string[] = [];
    let entry = directory.readSync();
    while (entry) {
      entries.push(entry.name);
      entry = directory.readSync();
    }
    return entries;
  } finally {
    directory.closeSync();
  }
}

export function pathExists(targetPath: string): boolean {
  const safePath = validateSafePath(targetPath);
  return pathExistsTrustedSync(safePath);
}

export function listDirectory(targetPath: string): string[] {
  return readDirectoryEntries(targetPath);
}

export function renamePath(sourcePath: string, destPath: string): void {
  const safeSourcePath = validateSafePath(sourcePath);
  const safeDestPath = validateSafePath(destPath);
  moveSafeSync(
    safeSourcePath,
    ALLOWED_STORAGE_DIRS,
    safeDestPath,
    ALLOWED_STORAGE_DIRS,
    { overwrite: true }
  );
}

export function removeFileIfExists(targetPath: string): void {
  const safePath = validateSafePath(targetPath);
  if (fs.pathExistsSync(safePath)) {
    fs.removeSync(safePath);
  }
}

export function removeDirectoryIfEmpty(targetPath: string): boolean {
  const safePath = validateSafePath(targetPath);
  if (!fs.pathExistsSync(safePath)) {
    return false;
  }
  if (readDirectoryEntries(safePath).length > 0) {
    return false;
  }
  fs.removeSync(safePath);
  return true;
}

export function removeDirectoryRecursive(targetPath: string): void {
  const safePath = validateSafePath(targetPath);
  if (fs.pathExistsSync(safePath)) {
    fs.removeSync(safePath);
  }
}

function findFileInStorage(
  baseDir: string,
  fileLabel: "video" | "image",
  filename: string,
  collections: Collection[] = []
): string | null {
  try {
    const sanitizedFilename = sanitizePathSegment(filename);
    if (!sanitizedFilename) {
      logger.warn(`Invalid filename provided: ${filename}`);
      return null;
    }

    const rootPath = tryBuildStoragePath(baseDir, sanitizedFilename);
    if (rootPath) {
      if (pathExistsTrustedSync(rootPath)) return rootPath;
    } else {
      logger.warn(
        `Unsafe root path detected for ${fileLabel} file: ${sanitizedFilename}`
      );
    }

    for (const collection of collections) {
      const collectionName = collection.name || collection.title;
      if (!collectionName) {
        continue;
      }

      const sanitizedName = sanitizePathSegment(collectionName);
      if (!sanitizedName) {
        continue;
      }

      const collectionPath = tryBuildStoragePath(
        baseDir,
        sanitizedName,
        sanitizedFilename
      );
      if (collectionPath && pathExistsTrustedSync(collectionPath)) {
        return collectionPath;
      }
    }
  } catch (error) {
    logger.error(
      `Error finding ${fileLabel} file`,
      error instanceof Error ? error : new Error(String(error))
    );
  }
  return null;
}

export function findVideoFile(
  filename: string,
  collections: Collection[] = []
): string | null {
  return findFileInStorage(VIDEOS_DIR, "video", filename, collections);
}

export function findImageFile(
  filename: string,
  collections: Collection[] = []
): string | null {
  return findFileInStorage(IMAGES_DIR, "image", filename, collections);
}

export function moveFile(sourcePath: string, destPath: string): void {
  try {
    // Validate strict path security
    validateSafePath(sourcePath);
    validateSafePath(destPath);

    if (pathExistsTrustedSync(sourcePath)) {
      ensureDirSafeSync(path.dirname(destPath), ALLOWED_STORAGE_DIRS);
      moveSafeSync(
        sourcePath,
        ALLOWED_STORAGE_DIRS,
        destPath,
        ALLOWED_STORAGE_DIRS,
        { overwrite: true }
      );
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
