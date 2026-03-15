import fs from "fs-extra";
import path from "path";

type PathEntryStats = {
  isSymbolicLink(): boolean;
};

const existsSyncIfAvailable = (targetPath: string): boolean => {
  const existsSync = (fs as typeof fs & {
    existsSync?: (currentPath: string) => boolean;
  }).existsSync;

  if (typeof existsSync !== "function") {
    return false;
  }

  return existsSync(targetPath);
};

const isPathInsideDir = (
  candidatePath: string,
  allowedDir: string,
): boolean => {
  const relative = path.relative(allowedDir, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const lstatIfExists = (targetPath: string): PathEntryStats | null => {
  const lstatSync = (fs as typeof fs & {
    lstatSync?: (currentPath: string) => PathEntryStats;
  }).lstatSync;

  if (typeof lstatSync !== "function") {
    return fs.existsSync(targetPath)
      ? { isSymbolicLink: () => false }
      : null;
  }

  try {
    return lstatSync(targetPath);
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
  seen = new Set<string>(),
): string => {
  const absoluteEntryPath = path.resolve(entryPath);
  if (seen.has(absoluteEntryPath)) {
    throw new Error(`Symlink loop detected: ${absoluteEntryPath}`);
  }

  const stats = lstatIfExists(absoluteEntryPath);
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

  return resolveSymlinkEntryPath(nextPath, seen);
};

export const normalizeAllowedDirs = (
  allowedDirs: readonly string[],
): string[] => {
  const normalizedDirs = new Set<string>();

  allowedDirs.forEach((allowedDir) => {
    const resolvedAllowedDir = path.resolve(allowedDir);
    normalizedDirs.add(resolvedAllowedDir);

    if (existsSyncIfAvailable(resolvedAllowedDir)) {
      try {
        normalizedDirs.add(resolveExistingRealPathSync(resolvedAllowedDir));
      } catch {
        normalizedDirs.add(resolvedAllowedDir);
      }
    }
  });

  return [...normalizedDirs];
};

export const resolvePathThroughSymlinks = (targetPath: string): string => {
  const absolutePath = path.resolve(targetPath);
  const { root } = path.parse(absolutePath);
  const relativePath = path.relative(root, absolutePath);
  const segments =
    relativePath.length > 0 ? relativePath.split(path.sep).filter(Boolean) : [];

  let currentPath = root;
  for (const segment of segments) {
    currentPath = resolveSymlinkEntryPath(path.join(currentPath, segment));
  }

  return currentPath;
};

export const resolvePathThroughSymlinkAncestors = (
  targetPath: string,
): string => {
  const absolutePath = path.resolve(targetPath);
  const { dir, base } = path.parse(absolutePath);

  if (!base) {
    return absolutePath;
  }

  const resolvedParentPath = resolvePathThroughSymlinks(dir);
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

  if (normalizedAllowedDirs.length === 0) {
    throw new Error("Path traversal detected: no allowed directories were provided");
  }

  if (
    !normalizedAllowedDirs.some((allowedDir) =>
      isPathInsideDir(absolutePath, allowedDir)
    )
  ) {
    throw new Error(
      `Path traversal detected: ${filePath} is outside allowed directories`,
    );
  }

  const traversedPath = resolvePathThroughSymlinks(absolutePath);
  if (
    !normalizedAllowedDirs.some((allowedDir) =>
      isPathInsideDir(traversedPath, allowedDir)
    )
  ) {
    throw new Error(
      `Path traversal detected: ${filePath} is outside allowed directories`,
    );
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

  if (normalizedAllowedDirs.length === 0) {
    throw new Error("Path traversal detected: no allowed directories were provided");
  }

  if (
    !normalizedAllowedDirs.some((allowedDir) =>
      isPathInsideDir(absolutePath, allowedDir)
    )
  ) {
    throw new Error(
      `Path traversal detected: ${filePath} is outside allowed directories`,
    );
  }

  const traversedEntryPath = resolvePathThroughSymlinkAncestors(absolutePath);
  if (
    !normalizedAllowedDirs.some((allowedDir) =>
      isPathInsideDir(traversedEntryPath, allowedDir)
    )
  ) {
    throw new Error(
      `Path traversal detected: ${filePath} is outside allowed directories`,
    );
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
