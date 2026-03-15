import fs from "fs-extra";
import type { Stats } from "fs";
import path from "path";
import {
  assertSafePathEntryInAllowedDirs,
  assertSafePathInAllowedDirs,
  findContainingAllowedDir,
  isPathInsideAllowedDirs,
} from "./pathSafety";

type SafePathResolution = {
  absolutePath: string;
  normalizedAllowedDirs: string[];
};

type LstatSyncAccessor = typeof fs & {
  lstatSync?: (currentPath: string) => Stats;
};

const createPathTraversalError = (originalPath: string): Error =>
  new Error(`Path traversal detected: ${originalPath} is outside allowed directories`);

const assertPathWithinNormalizedAllowedDirs = (
  safePath: string,
  normalizedAllowedDirs: readonly string[],
  originalPath: string,
): void => {
  if (findContainingAllowedDir(safePath, normalizedAllowedDirs) !== null) {
    return;
  }

  throw createPathTraversalError(originalPath);
};

const assertCodeQlSafePath = (
  safePath: string,
  normalizedAllowedDirs: readonly string[],
  originalPath: string,
): void => {
  const matchedAllowedDir = findContainingAllowedDir(
    safePath,
    normalizedAllowedDirs,
  );
  if (!matchedAllowedDir) {
    throw createPathTraversalError(originalPath);
  }

  const relativeSafePath = path.relative(matchedAllowedDir, safePath);
  if (
    relativeSafePath === ".." ||
    relativeSafePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeSafePath)
  ) {
    throw createPathTraversalError(originalPath);
  }
};

const resolveCheckedSafeFilePath = (
  filePath: string,
  allowedDirs: readonly string[],
): SafePathResolution => {
  const resolvedPath = assertSafePathInAllowedDirs(filePath, allowedDirs);
  assertPathWithinNormalizedAllowedDirs(
    resolvedPath.absolutePath,
    resolvedPath.normalizedAllowedDirs,
    filePath,
  );
  return resolvedPath;
};

const resolveCheckedSafeEntryPath = (
  filePath: string,
  allowedDirs: readonly string[],
): SafePathResolution => {
  const resolvedPath = assertSafePathEntryInAllowedDirs(filePath, allowedDirs);
  assertPathWithinNormalizedAllowedDirs(
    resolvedPath.absolutePath,
    resolvedPath.normalizedAllowedDirs,
    filePath,
  );
  return resolvedPath;
};

const lstatEntryIfExists = (
  safePath: string,
  normalizedAllowedDirs: readonly string[],
  originalPath: string,
): Stats | null => {
  assertCodeQlSafePath(safePath, normalizedAllowedDirs, originalPath);

  const lstatSync = (fs as LstatSyncAccessor).lstatSync;
  if (typeof lstatSync !== "function") {
    return fs.existsSync(safePath) ? ({} as Stats) : null;
  }

  try {
    return lstatSync(safePath) ?? (fs.existsSync(safePath) ? ({} as Stats) : null);
  } catch (error) {
    const maybeErrno = error as NodeJS.ErrnoException;
    if (maybeErrno.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const readDirectory = (safePath: string): string[] => fs.readdirSync(safePath);

export const resolveSafePathInAllowedDirs = (
  filePath: string,
  allowedDirs: readonly string[],
): string => assertSafePathInAllowedDirs(filePath, allowedDirs).absolutePath;

export const resolveSafePathEntryInAllowedDirs = (
  filePath: string,
  allowedDirs: readonly string[],
): string => assertSafePathEntryInAllowedDirs(filePath, allowedDirs).absolutePath;

export const pathExistsSync = (
  filePath: string,
  allowedDirs: readonly string[],
): boolean => {
  const { absolutePath: safePath, normalizedAllowedDirs } =
    resolveCheckedSafeFilePath(filePath, allowedDirs);
  const matchedAllowedDir = findContainingAllowedDir(
    safePath,
    normalizedAllowedDirs,
  );
  if (!matchedAllowedDir) {
    throw createPathTraversalError(filePath);
  }

  const relativeSafePath = path.relative(matchedAllowedDir, safePath);
  if (
    relativeSafePath === ".." ||
    relativeSafePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeSafePath)
  ) {
    throw createPathTraversalError(filePath);
  }

  return fs.existsSync(safePath);
};

export const pathEntryExistsSync = (
  filePath: string,
  allowedDirs: readonly string[],
): boolean => {
  const { absolutePath: safePath, normalizedAllowedDirs } =
    resolveCheckedSafeEntryPath(filePath, allowedDirs);
  return lstatEntryIfExists(safePath, normalizedAllowedDirs, filePath) !== null;
};

export const readUtf8FileSync = (
  filePath: string,
  allowedDirs: readonly string[],
): string => {
  const { absolutePath: safePath } = resolveCheckedSafeFilePath(
    filePath,
    allowedDirs,
  );
  return fs.readFileSync(safePath, "utf8");
};

export const ensureDirSync = (dirPath: string, allowedDir: string): void => {
  const { absolutePath: safePath } = resolveCheckedSafeFilePath(dirPath, [
    allowedDir,
  ]);
  fs.mkdirSync(safePath, { recursive: true });
};

export const writeUtf8FileSync = (
  filePath: string,
  content: string,
  allowedDirs: readonly string[],
): void => {
  const { absolutePath: safePath } = resolveCheckedSafeFilePath(
    filePath,
    allowedDirs,
  );
  fs.writeFileSync(safePath, content, "utf8");
};

export const writeFileData = async (
  filePath: string,
  data: string | Buffer | Uint8Array,
  allowedDirs: readonly string[],
): Promise<void> => {
  const { absolutePath: safePath } = resolveCheckedSafeFilePath(
    filePath,
    allowedDirs,
  );
  await fs.writeFile(safePath, data);
};

export const removeFileSync = (
  filePath: string,
  allowedDirs: readonly string[],
): void => {
  const { absolutePath: safePath } = resolveCheckedSafeEntryPath(
    filePath,
    allowedDirs,
  );
  fs.unlinkSync(safePath);
};

export const renamePathSync = (
  sourcePath: string,
  destinationPath: string,
  allowedDirs: readonly string[],
): void => {
  const { absolutePath: safeSourcePath } = resolveCheckedSafeEntryPath(
    sourcePath,
    allowedDirs,
  );
  const { absolutePath: safeDestinationPath } = resolveCheckedSafeEntryPath(
    destinationPath,
    allowedDirs,
  );
  fs.renameSync(safeSourcePath, safeDestinationPath);
};

export const removeDirSync = (
  dirPath: string,
  allowedDirs: readonly string[],
): void => {
  const { absolutePath: safePath } = resolveCheckedSafeEntryPath(
    dirPath,
    allowedDirs,
  );
  fs.rmdirSync(safePath);
};

export const removePathRecursivelySync = (
  targetPath: string,
  allowedDirs: readonly string[],
): void => {
  const { absolutePath: safePath } = resolveCheckedSafeEntryPath(
    targetPath,
    allowedDirs,
  );
  fs.rmSync(safePath, {
    recursive: true,
    force: true,
  });
};

export const readDirSync = (
  dirPath: string,
  allowedDirs: readonly string[],
): string[] => {
  const { absolutePath: safePath } = resolveCheckedSafeFilePath(
    dirPath,
    allowedDirs,
  );
  return readDirectory(safePath);
};

export const statSync = (
  filePath: string,
  allowedDirs: readonly string[],
): Stats => {
  const { absolutePath: safePath, normalizedAllowedDirs } =
    resolveCheckedSafeFilePath(filePath, allowedDirs);
  const matchedAllowedDir = findContainingAllowedDir(
    safePath,
    normalizedAllowedDirs,
  );
  if (!matchedAllowedDir) {
    throw createPathTraversalError(filePath);
  }

  const relativeSafePath = path.relative(matchedAllowedDir, safePath);
  if (
    relativeSafePath === ".." ||
    relativeSafePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeSafePath)
  ) {
    throw createPathTraversalError(filePath);
  }

  return fs.statSync(safePath);
};

export const resolveRealPath = async (
  filePath: string,
  allowedDirs: readonly string[],
): Promise<string> => {
  const { absolutePath: safePath } = resolveCheckedSafeFilePath(
    filePath,
    allowedDirs,
  );
  const realPath = await fs.realpath(safePath);

  if (!isPathInsideAllowedDirs(realPath, allowedDirs)) {
    throw createPathTraversalError(filePath);
  }

  return realPath;
};

export const statPath = async (
  filePath: string,
  allowedDirs: readonly string[],
): Promise<Stats> => {
  const { absolutePath: safePath } = resolveCheckedSafeFilePath(
    filePath,
    allowedDirs,
  );
  return fs.stat(safePath);
};
