import path from "path";
import {
  CLOUD_THUMBNAIL_CACHE_DIR,
  IMAGES_DIR,
  VIDEOS_DIR,
} from "../../config/paths";

/**
 * Safely rebuild a path from validated components while preserving absolute roots
 * (e.g. "/" on POSIX, "D:\\" on Windows).
 */
function sanitizePathWithoutTraversal(pathValue: string): string {
  const normalizedPath = path.normalize(pathValue);
  const isAbsolutePath = path.isAbsolute(normalizedPath);

  let root = "";
  let relativePath = normalizedPath;

  if (isAbsolutePath) {
    root = path.parse(normalizedPath).root;
    relativePath = path.relative(root, normalizedPath);
  }

  const pathParts = relativePath
    .split(path.sep)
    .filter((part) => part !== "" && part !== ".");

  // Only reject if a path component is exactly "..";
  // filenames containing ".." are still valid.
  if (pathParts.some((part) => part === "..")) {
    throw new Error("Path traversal component detected");
  }

  const rebuiltRelative = pathParts.length > 0 ? path.join(...pathParts) : "";
  const sanitizedPath = isAbsolutePath
    ? rebuiltRelative
      ? path.join(root, rebuiltRelative)
      : root
    : rebuiltRelative;

  const finalParts = sanitizedPath
    .split(path.sep)
    .filter((part) => part !== "");

  if (finalParts.some((part) => part === "..")) {
    throw new Error("Path traversal component detected");
  }

  return sanitizedPath;
}

function isResolvedPathInsideDir(
  resolvedPath: string,
  resolvedAllowedDir: string,
): boolean {
  const relative = path.relative(resolvedAllowedDir, resolvedPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Checks if a path is inside (or equal to) an allowed directory.
 * Both inputs are resolved before comparison.
 */
export function isPathWithinDirectory(
  pathToCheck: string,
  allowedDir: string,
): boolean {
  if (
    !pathToCheck ||
    typeof pathToCheck !== "string" ||
    !allowedDir ||
    typeof allowedDir !== "string"
  ) {
    return false;
  }

  const resolvedPath = path.resolve(pathToCheck);
  const resolvedAllowedDir = path.resolve(allowedDir);
  return isResolvedPathInsideDir(resolvedPath, resolvedAllowedDir);
}

/**
 * Checks if a path is inside at least one allowed directory.
 */
export function isPathWithinDirectories(
  pathToCheck: string,
  allowedDirs: readonly string[],
): boolean {
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    return false;
  }

  const resolvedPath = path.resolve(pathToCheck);
  return allowedDirs.some((allowedDir) =>
    isPathWithinDirectory(resolvedPath, allowedDir),
  );
}

/**
 * Validates that a file path is within an allowed directory
 * Prevents path traversal attacks
 */
export function validatePathWithinDirectory(
  filePath: string,
  allowedDir: string,
): boolean {
  // Sanitize and validate input before resolving to prevent path traversal
  if (
    !filePath ||
    typeof filePath !== "string" ||
    !allowedDir ||
    typeof allowedDir !== "string"
  ) {
    return false;
  }

  let sanitizedFilePath: string;
  let sanitizedAllowedDir: string;
  try {
    sanitizedFilePath = sanitizePathWithoutTraversal(filePath);
    sanitizedAllowedDir = sanitizePathWithoutTraversal(allowedDir);
  } catch {
    return false;
  }

  // Now safe to resolve - paths are constructed from validated components only
  const resolvedPath = path.resolve(sanitizedFilePath);
  const resolvedAllowedDir = path.resolve(sanitizedAllowedDir);

  return isResolvedPathInsideDir(resolvedPath, resolvedAllowedDir);
}

/**
 * Safely resolves a file path within an allowed directory
 * Throws an error if the path is outside the allowed directory
 */
export function resolveSafePath(filePath: string, allowedDir: string): string {
  // Sanitize and validate input before resolving to prevent path traversal
  if (
    !filePath ||
    typeof filePath !== "string" ||
    !allowedDir ||
    typeof allowedDir !== "string"
  ) {
    throw new Error(`Invalid file path: ${filePath}`);
  }

  let sanitizedFilePath: string;
  let sanitizedAllowedDir: string;
  try {
    sanitizedFilePath = sanitizePathWithoutTraversal(filePath);
  } catch {
    throw new Error(
      `Path traversal detected: ${filePath} contains invalid path components`,
    );
  }
  try {
    sanitizedAllowedDir = sanitizePathWithoutTraversal(allowedDir);
  } catch {
    throw new Error(`Invalid allowed directory: ${allowedDir}`);
  }

  // Now safe to resolve - paths are constructed from validated components only
  const resolvedPath = path.resolve(sanitizedFilePath);
  const resolvedAllowedDir = path.resolve(sanitizedAllowedDir);

  if (!isResolvedPathInsideDir(resolvedPath, resolvedAllowedDir)) {
    throw new Error(
      `Path traversal detected: ${filePath} is outside ${allowedDir}`,
    );
  }

  return resolvedPath;
}

/**
 * Validates that a file path is within at least one allowed directory
 */
export function validatePathWithinDirectories(
  filePath: string,
  allowedDirs: string[],
): boolean {
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    return false;
  }
  return allowedDirs.some((allowedDir) =>
    validatePathWithinDirectory(filePath, allowedDir),
  );
}

/**
 * Safely resolves a file path within one of the allowed directories
 * Throws an error if the path is outside all allowed directories
 */
export function resolveSafePathInDirectories(
  filePath: string,
  allowedDirs: string[],
): string {
  const resolvedPath = path.resolve(filePath);
  if (!validatePathWithinDirectories(resolvedPath, allowedDirs)) {
    throw new Error(
      `Path traversal detected: ${filePath} is outside allowed directories`,
    );
  }
  return resolvedPath;
}

function normalizeAllowedDirectories(
  allowedDirOrDirs: string | readonly string[],
): string[] {
  return Array.isArray(allowedDirOrDirs)
    ? [...allowedDirOrDirs]
    : [allowedDirOrDirs as string];
}

export function resolveSafePathForOperation(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): string {
  const allowedDirs = normalizeAllowedDirectories(allowedDirOrDirs);
  if (allowedDirs.length === 0) {
    throw new Error("At least one allowed directory is required");
  }

  return allowedDirs.length === 1
    ? resolveSafePath(filePath, allowedDirs[0])
    : resolveSafePathInDirectories(filePath, allowedDirs);
}

/**
 * Sanitizes a single path segment (e.g. filename, collection name)
 * by removing traversal sequences and separators.
 */
export function sanitizePathSegment(segment: string): string {
  if (typeof segment !== "string") {
    return "";
  }
  return segment
    .replace(/\0/g, "")
    .replace(/\.\./g, "")
    .replace(/[\/\\]/g, "")
    .trim();
}

/**
 * Validates that a file path is within the videos directory
 */
export function validateVideoPath(filePath: string): string {
  return resolveSafePath(filePath, VIDEOS_DIR);
}

/**
 * Validates that a file path is within the images directory
 */
export function validateImagePath(filePath: string): string {
  return resolveSafePath(filePath, IMAGES_DIR);
}

/**
 * Resolves a child path inside an allowed directory.
 * Accepts relative path fragments and ensures the final path remains inside allowedDir.
 */
export function resolveSafeChildPath(
  allowedDir: string,
  childPath: string,
): string {
  if (
    !allowedDir ||
    typeof allowedDir !== "string" ||
    !childPath ||
    typeof childPath !== "string"
  ) {
    throw new Error(`Invalid child path: ${childPath}`);
  }

  return resolveSafePath(`${allowedDir}${path.sep}${childPath}`, allowedDir);
}

export function normalizeSafeAbsolutePath(filePath: string): string {
  if (!filePath || typeof filePath !== "string") {
    throw new Error(`Invalid absolute path: ${filePath}`);
  }

  let sanitizedPath: string;
  try {
    sanitizedPath = sanitizePathWithoutTraversal(filePath);
  } catch {
    throw new Error(`Path traversal detected: ${filePath}`);
  }

  const resolvedPath = path.resolve(sanitizedPath);
  if (!path.isAbsolute(resolvedPath)) {
    throw new Error(`Path must resolve to an absolute path: ${filePath}`);
  }

  return resolvedPath;
}

/**
 * Validates that a file path is within the cloud thumbnail cache directory
 */
export function validateCloudThumbnailCachePath(filePath: string): string {
  return resolveSafePath(filePath, CLOUD_THUMBNAIL_CACHE_DIR);
}
