import fs from "fs-extra";
import path from "path";

type PathEntryStats = {
  isSymbolicLink(): boolean;
};

const createPathTraversalError = (targetPath: string): Error =>
  new Error(`Path traversal detected: ${targetPath} is outside allowed directories`);

const existsSyncIfAvailable = (targetPath: string): boolean => {
  const existsSync = (fs as typeof fs & {
    existsSync?: (currentPath: string) => boolean;
  }).existsSync;

  if (typeof existsSync !== "function") {
    return false;
  }

  return existsSync(targetPath);
};

export const isPathInsideDir = (
  candidatePath: string,
  allowedDir: string,
): boolean => {
  const relative = path.relative(allowedDir, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

export const findContainingAllowedDir = (
  candidatePath: string,
  normalizedAllowedDirs: readonly string[],
): string | null => {
  for (const allowedDir of normalizedAllowedDirs) {
    if (isPathInsideDir(candidatePath, allowedDir)) {
      return allowedDir;
    }
  }

  return null;
};

const assertAllowedDirsProvided = (
  normalizedAllowedDirs: readonly string[],
): void => {
  if (normalizedAllowedDirs.length === 0) {
    throw new Error("Path traversal detected: no allowed directories were provided");
  }
};

const lstatIfExists = (
  targetPath: string,
  normalizedAllowedDirs: readonly string[],
): PathEntryStats | null => {
  const absoluteTargetPath = path.resolve(targetPath);
  const matchedAllowedDir = findContainingAllowedDir(
    absoluteTargetPath,
    normalizedAllowedDirs,
  );
  if (!matchedAllowedDir) {
    throw createPathTraversalError(targetPath);
  }

  const relativeTargetPath = path.relative(
    matchedAllowedDir,
    absoluteTargetPath,
  );
  if (
    relativeTargetPath === ".." ||
    relativeTargetPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTargetPath)
  ) {
    throw createPathTraversalError(targetPath);
  }

  const lstatSync = (fs as typeof fs & {
    lstatSync?: (currentPath: string) => PathEntryStats;
  }).lstatSync;

  if (typeof lstatSync !== "function") {
    return null;
  }

  try {
    return lstatSync(absoluteTargetPath);
  } catch (error) {
    const maybeErrno = error as NodeJS.ErrnoException;
    if (maybeErrno.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const resolveExistingRealPathSync = (targetPath: string): string => {
  const realpathSync = (fs as typeof fs & {
    realpathSync?: (currentPath: string) => string;
  }).realpathSync;

  if (typeof realpathSync !== "function") {
    return path.resolve(targetPath);
  }

  const maybeRealPath = realpathSync(targetPath);
  return typeof maybeRealPath === "string" && maybeRealPath.length > 0
    ? maybeRealPath
    : path.resolve(targetPath);
};

const resolveSymlinkEntryPath = (
  entryPath: string,
  normalizedAllowedDirs: readonly string[],
  seen = new Set<string>(),
): string => {
  const absoluteEntryPath = path.resolve(entryPath);
  const matchedAllowedDir = findContainingAllowedDir(
    absoluteEntryPath,
    normalizedAllowedDirs,
  );
  if (!matchedAllowedDir) {
    throw createPathTraversalError(entryPath);
  }

  const relativeEntryPath = path.relative(matchedAllowedDir, absoluteEntryPath);
  if (
    relativeEntryPath === ".." ||
    relativeEntryPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeEntryPath)
  ) {
    throw createPathTraversalError(entryPath);
  }

  if (seen.has(absoluteEntryPath)) {
    throw new Error(`Symlink loop detected: ${absoluteEntryPath}`);
  }

  const stats = lstatIfExists(absoluteEntryPath, normalizedAllowedDirs);
  if (!stats || !stats.isSymbolicLink()) {
    return absoluteEntryPath;
  }

  seen.add(absoluteEntryPath);

  const readlinkSync = (fs as typeof fs & {
    readlinkSync?: (currentPath: string) => string;
  }).readlinkSync;
  if (typeof readlinkSync !== "function") {
    throw new Error(`Symlink inspection is unavailable for: ${absoluteEntryPath}`);
  }

  const linkTarget = readlinkSync(absoluteEntryPath);
  const nextPath = path.resolve(path.dirname(absoluteEntryPath), linkTarget);

  return resolveSymlinkEntryPath(nextPath, normalizedAllowedDirs, seen);
};

export const normalizeAllowedDirs = (
  allowedDirs: readonly string[],
): string[] => {
  const normalizedDirs = new Set<string>();

  for (const allowedDir of allowedDirs) {
    const resolvedAllowedDir = path.resolve(allowedDir);
    normalizedDirs.add(resolvedAllowedDir);

    if (existsSyncIfAvailable(resolvedAllowedDir)) {
      try {
        normalizedDirs.add(resolveExistingRealPathSync(resolvedAllowedDir));
      } catch {
        normalizedDirs.add(resolvedAllowedDir);
      }
    }
  }

  return [...normalizedDirs];
};

export const resolvePathThroughSymlinks = (
  targetPath: string,
  normalizedAllowedDirs: readonly string[],
): string => {
  const absolutePath = path.resolve(targetPath);
  const matchedAllowedDir = normalizedAllowedDirs.find((allowedDir) =>
    isPathInsideDir(absolutePath, allowedDir),
  );
  if (!matchedAllowedDir) {
    throw new Error(
      `Path traversal detected: ${targetPath} is outside allowed directories`,
    );
  }

  const relativePath = path.relative(matchedAllowedDir, absolutePath);
  const segments =
    relativePath.length > 0 ? relativePath.split(path.sep).filter(Boolean) : [];

  let currentPath = matchedAllowedDir;
  for (const segment of segments) {
    currentPath = resolveSymlinkEntryPath(
      path.join(currentPath, segment),
      normalizedAllowedDirs,
    );
  }

  return currentPath;
};

export const resolvePathThroughSymlinkAncestors = (
  targetPath: string,
  normalizedAllowedDirs: readonly string[],
): string => {
  const absolutePath = path.resolve(targetPath);
  const { dir, base } = path.parse(absolutePath);

  if (!base) {
    return absolutePath;
  }

  const resolvedParentPath = resolvePathThroughSymlinks(
    dir,
    normalizedAllowedDirs,
  );
  return path.join(resolvedParentPath, base);
};

export const assertSafePathInAllowedDirs = (
  filePath: string,
  allowedDirs: readonly string[],
): {
  absolutePath: string;
  normalizedAllowedDirs: string[];
  traversedPath: string;
} => {
  const absolutePath = path.resolve(filePath);
  const normalizedAllowedDirs = normalizeAllowedDirs(allowedDirs);

  assertAllowedDirsProvided(normalizedAllowedDirs);
  if (
    findContainingAllowedDir(absolutePath, normalizedAllowedDirs) === null
  ) {
    throw createPathTraversalError(filePath);
  }

  const traversedPath = resolvePathThroughSymlinks(
    absolutePath,
    normalizedAllowedDirs,
  );
  if (
    findContainingAllowedDir(traversedPath, normalizedAllowedDirs) === null
  ) {
    throw createPathTraversalError(filePath);
  }

  return {
    absolutePath,
    normalizedAllowedDirs,
    traversedPath,
  };
};

export const assertSafePathEntryInAllowedDirs = (
  filePath: string,
  allowedDirs: readonly string[],
): {
  absolutePath: string;
  normalizedAllowedDirs: string[];
  traversedEntryPath: string;
} => {
  const absolutePath = path.resolve(filePath);
  const normalizedAllowedDirs = normalizeAllowedDirs(allowedDirs);

  assertAllowedDirsProvided(normalizedAllowedDirs);
  if (
    findContainingAllowedDir(absolutePath, normalizedAllowedDirs) === null
  ) {
    throw createPathTraversalError(filePath);
  }

  const traversedEntryPath = resolvePathThroughSymlinkAncestors(
    absolutePath,
    normalizedAllowedDirs,
  );
  if (
    findContainingAllowedDir(traversedEntryPath, normalizedAllowedDirs) === null
  ) {
    throw createPathTraversalError(filePath);
  }

  return {
    absolutePath,
    normalizedAllowedDirs,
    traversedEntryPath,
  };
};

export const isPathInsideAllowedDirs = (
  filePath: string,
  allowedDirs: readonly string[],
): boolean => {
  try {
    assertSafePathInAllowedDirs(filePath, allowedDirs);
    return true;
  } catch {
    return false;
  }
};

export const resolveSafePathInAllowedDirs = (
  filePath: string,
  allowedDirs: readonly string[],
): string => assertSafePathInAllowedDirs(filePath, allowedDirs).absolutePath;
