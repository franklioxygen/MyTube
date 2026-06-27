import fs from "fs-extra";
import type {
  Dirent,
  Stats,
  WriteFileOptions,
} from "fs";
import path from "path";
import {
  CLOUD_THUMBNAIL_CACHE_DIR,
  IMAGES_DIR,
  VIDEOS_DIR,
} from "../config/paths";

// Web/exec security helpers live in sibling modules; re-exported below so
// existing `../utils/security` imports keep resolving the full surface.
export { execFileSafe } from "./securityExec";
export {
  buildAllowlistedHttpUrl,
  isHostnameAllowed,
  validateUrl,
  validateUrlWithAllowlist,
} from "./securityUrl";
export { getClientIp, sanitizeHtml, validateRedirectUrl } from "./securityHtml";

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

function resolveAndValidatePathInput(filePath: string): string {
  try {
    return sanitizePathWithoutTraversal(filePath);
  } catch {
    throw new Error(
      `Path traversal detected: ${filePath} contains invalid path components`,
    );
  }
}

function resolveAndValidateAllowedDir(allowedDir: string): string {
  try {
    return normalizeSafeAbsolutePath(allowedDir);
  } catch {
    throw new Error(`Invalid allowed directory: ${allowedDir}`);
  }
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

  const sanitizedFilePath = resolveAndValidatePathInput(filePath);
  const resolvedAllowedDir = resolveAndValidateAllowedDir(allowedDir);
  const resolvedPath = path.resolve(resolvedAllowedDir, sanitizedFilePath);

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
  if (!filePath || typeof filePath !== "string") {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    throw new Error("At least one allowed directory is required");
  }

  const sanitizedFilePath = resolveAndValidatePathInput(filePath);
  for (const allowedDir of allowedDirs) {
    const resolvedAllowedDir = resolveAndValidateAllowedDir(allowedDir);
    const resolvedPath = path.resolve(resolvedAllowedDir, sanitizedFilePath);
    if (isResolvedPathInsideDir(resolvedPath, resolvedAllowedDir)) {
      return resolvedPath;
    }
  }

  throw new Error(
    `Path traversal detected: ${filePath} is outside allowed directories`,
  );
}

function resolveSafePathForOperation(
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

function resolveTrustedPathForOperation(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): string {
  return normalizeSafeAbsolutePath(
    resolveSafePathForOperation(filePath, allowedDirOrDirs),
  );
}

export function pathExistsSafeSync(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): boolean {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  for (const allowedDir of normalizeAllowedDirectories(allowedDirOrDirs)) {
    const relative = path.relative(path.resolve(allowedDir), safePath);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return fs.existsSync(safePath);
    }
  }

  throw new Error(
    `Path traversal detected: ${filePath} is outside allowed directories`,
  );
}

export async function pathExistsSafe(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): Promise<boolean> {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  return fs.pathExists(safePath);
}

export function pathExistsTrustedSync(filePath: string): boolean {
  const safePath = normalizeSafeAbsolutePath(filePath);
  return fs.existsSync(safePath);
}

export async function pathExistsTrusted(filePath: string): Promise<boolean> {
  const safePath = normalizeSafeAbsolutePath(filePath);
  return fs.pathExists(safePath);
}

export function statSafeSync(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): Stats {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  return fs.statSync(safePath);
}

export function lstatSafeSync(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): Stats {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  // safePath is constrained by resolveSafePathForOperation before lstat.
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  return fs.lstatSync(safePath);
}

export function statTrustedSync(filePath: string): Stats {
  const safePath = normalizeSafeAbsolutePath(filePath);
  return fs.statSync(safePath);
}

export async function statSafe(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): Promise<Stats> {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  return fs.stat(safePath);
}

export function readdirSafeSync(
  dirPath: string,
  allowedDirOrDirs: string | readonly string[],
): string[] {
  const safePath = resolveTrustedPathForOperation(dirPath, allowedDirOrDirs);
  return fs.readdirSync(safePath);
}

export async function readdirSafe(
  dirPath: string,
  allowedDirOrDirs: string | readonly string[],
): Promise<string[]> {
  const safePath = resolveTrustedPathForOperation(dirPath, allowedDirOrDirs);
  return fs.readdir(safePath);
}

export function ensureDirSafeSync(
  dirPath: string,
  allowedDirOrDirs: string | readonly string[],
): void {
  const safePath = resolveTrustedPathForOperation(dirPath, allowedDirOrDirs);
  fs.ensureDirSync(safePath);
}

export function readFileSafeSync(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
  encoding: BufferEncoding,
): string {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  return fs.readFileSync(safePath, encoding);
}

export function readFileTrustedSync(
  filePath: string,
  encoding: BufferEncoding,
): string {
  const safePath = normalizeSafeAbsolutePath(filePath);
  return fs.readFileSync(safePath, encoding);
}

export async function readdirDirentsSafe(
  dirPath: string,
  allowedDirOrDirs: string | readonly string[],
): Promise<Dirent[]> {
  const safePath = resolveTrustedPathForOperation(dirPath, allowedDirOrDirs);
  return fs.readdir(safePath, { withFileTypes: true }) as Promise<Dirent[]>;
}

export function writeFileSafeSync(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
  data: string | NodeJS.ArrayBufferView,
  options?: WriteFileOptions,
): void {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  fs.writeFileSync(safePath, data, options);
}

export async function writeFileSafe(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
  data: string | NodeJS.ArrayBufferView,
  options?: WriteFileOptions,
): Promise<void> {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  await fs.writeFile(safePath, data, options);
}

export function unlinkSafeSync(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): void {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  fs.unlinkSync(safePath);
}

export function unlinkTrustedSync(filePath: string): void {
  const safePath = normalizeSafeAbsolutePath(filePath);
  fs.unlinkSync(safePath);
}

export function accessTrustedSync(filePath: string, mode: number): void {
  const safePath = normalizeSafeAbsolutePath(filePath);
  fs.accessSync(safePath, mode);
}

export function removeEmptyDirSafeSync(
  dirPath: string,
  allowedDirOrDirs: string | readonly string[],
): void {
  const safePath = resolveTrustedPathForOperation(dirPath, allowedDirOrDirs);
  fs.rmdirSync(safePath);
}

export async function removeSafe(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): Promise<void> {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  await fs.remove(safePath);
}

export function copyFileSafeSync(
  sourcePath: string,
  sourceAllowedDirOrDirs: string | readonly string[],
  destinationPath: string,
  destinationAllowedDirOrDirs: string | readonly string[],
): void {
  const safeSourcePath = resolveTrustedPathForOperation(
    sourcePath,
    sourceAllowedDirOrDirs,
  );
  const safeDestinationPath = resolveTrustedPathForOperation(
    destinationPath,
    destinationAllowedDirOrDirs,
  );

  for (const sourceAllowedDir of normalizeAllowedDirectories(
    sourceAllowedDirOrDirs,
  )) {
    const sourceRelative = path.relative(
      path.resolve(sourceAllowedDir),
      safeSourcePath,
    );
    if (sourceRelative.startsWith("..") || path.isAbsolute(sourceRelative)) {
      continue;
    }

    for (const destinationAllowedDir of normalizeAllowedDirectories(
      destinationAllowedDirOrDirs,
    )) {
      const destinationRelative = path.relative(
        path.resolve(destinationAllowedDir),
        safeDestinationPath,
      );
      if (
        !destinationRelative.startsWith("..") &&
        !path.isAbsolute(destinationRelative)
      ) {
        fs.copyFileSync(safeSourcePath, safeDestinationPath);
        return;
      }
    }
  }

  throw new Error(
    `Path traversal detected: copy operation is outside allowed directories`,
  );
}

export async function copySafe(
  sourcePath: string,
  sourceAllowedDirOrDirs: string | readonly string[],
  destinationPath: string,
  destinationAllowedDirOrDirs: string | readonly string[],
): Promise<void> {
  const safeSourcePath = resolveTrustedPathForOperation(
    sourcePath,
    sourceAllowedDirOrDirs,
  );
  const safeDestinationPath = resolveTrustedPathForOperation(
    destinationPath,
    destinationAllowedDirOrDirs,
  );
  await fs.copy(safeSourcePath, safeDestinationPath);
}

export function renameSafeSync(
  sourcePath: string,
  sourceAllowedDirOrDirs: string | readonly string[],
  destinationPath: string,
  destinationAllowedDirOrDirs: string | readonly string[],
): void {
  const safeSourcePath = resolveTrustedPathForOperation(
    sourcePath,
    sourceAllowedDirOrDirs,
  );
  const safeDestinationPath = resolveTrustedPathForOperation(
    destinationPath,
    destinationAllowedDirOrDirs,
  );
  fs.renameSync(safeSourcePath, safeDestinationPath);
}

export function moveSafeSync(
  sourcePath: string,
  sourceAllowedDirOrDirs: string | readonly string[],
  destinationPath: string,
  destinationAllowedDirOrDirs: string | readonly string[],
  options?: MoveSyncOptions,
): void {
  const safeSourcePath = resolveTrustedPathForOperation(
    sourcePath,
    sourceAllowedDirOrDirs,
  );
  const safeDestinationPath = resolveTrustedPathForOperation(
    destinationPath,
    destinationAllowedDirOrDirs,
  );
  fs.moveSync(safeSourcePath, safeDestinationPath, options);
}

export function createReadStreamSafe(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
  options?: ReadStreamOptions,
): fs.ReadStream {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  return fs.createReadStream(safePath, options);
}

export function createReadStreamTrusted(
  filePath: string,
  options?: ReadStreamOptions,
): fs.ReadStream {
  const safePath = normalizeSafeAbsolutePath(filePath);
  return fs.createReadStream(safePath, options);
}

export function createWriteStreamSafe(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
  options?: WriteStreamOptions,
): fs.WriteStream {
  const safePath = resolveTrustedPathForOperation(filePath, allowedDirOrDirs);
  return fs.createWriteStream(safePath, options);
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

type ReadStreamOptions = Parameters<typeof fs.createReadStream>[1];
type WriteStreamOptions = Parameters<typeof fs.createWriteStream>[1];
type MoveSyncOptions = Parameters<typeof fs.moveSync>[2];

function normalizeAllowedDirectories(
  allowedDirOrDirs: string | readonly string[],
): string[] {
  return Array.isArray(allowedDirOrDirs)
    ? [...allowedDirOrDirs]
    : [allowedDirOrDirs as string];
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

export async function imagePathExists(filePath: string): Promise<boolean> {
  return fs.pathExists(validateImagePath(filePath));
}

export async function removeImagePath(filePath: string): Promise<void> {
  await fs.remove(validateImagePath(filePath));
}

/**
 * Resolves a child path inside an allowed directory.
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
