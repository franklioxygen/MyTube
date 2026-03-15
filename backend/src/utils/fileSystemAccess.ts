import fs from "fs-extra";
import type { Stats } from "fs";
import {
  assertSafePathEntryInAllowedDirs,
  assertSafePathInAllowedDirs,
  isPathInsideDir,
  isPathInsideAllowedDirs,
} from "./pathSafety";

const resolveSafeFilePath = (
  filePath: string,
  allowedDirs: readonly string[],
): ReturnType<typeof assertSafePathInAllowedDirs> =>
  assertSafePathInAllowedDirs(filePath, allowedDirs);

const resolveSafeEntryPath = (
  filePath: string,
  allowedDirs: readonly string[],
): ReturnType<typeof assertSafePathEntryInAllowedDirs> =>
  assertSafePathEntryInAllowedDirs(filePath, allowedDirs);

const assertPathWithinNormalizedAllowedDirs = (
  safePath: string,
  normalizedAllowedDirs: readonly string[],
  originalPath: string,
): void => {
  if (
    !normalizedAllowedDirs.some((allowedDir) =>
      isPathInsideDir(safePath, allowedDir),
    )
  ) {
    throw new Error(
      `Path traversal detected: ${originalPath} is outside allowed directories`,
    );
  }
};

const lstatEntryIfExists = (
  safePath: string,
  normalizedAllowedDirs: readonly string[],
  originalPath: string,
): Stats | null => {
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    originalPath,
  );

  const lstatSync = (fs as typeof fs & {
    lstatSync?: (currentPath: string) => Stats;
  }).lstatSync;

  if (typeof lstatSync !== "function") {
    return fs.existsSync(safePath) ? ({} as Stats) : null;
  }

  try {
    const stats = lstatSync(safePath);
    if (stats) {
      return stats;
    }
    return fs.existsSync(safePath) ? ({} as Stats) : null;
  } catch (error) {
    const maybeErrno = error as NodeJS.ErrnoException;
    if (maybeErrno.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const resolveSafePathInAllowedDirs = (
  filePath: string,
  allowedDirs: readonly string[],
): string => resolveSafeFilePath(filePath, allowedDirs).absolutePath;

export const resolveSafePathEntryInAllowedDirs = (
  filePath: string,
  allowedDirs: readonly string[],
): string => resolveSafeEntryPath(filePath, allowedDirs).absolutePath;

export const pathExistsSync = (
  filePath: string,
  allowedDirs: readonly string[],
): boolean => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeFilePath(
    filePath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    filePath,
  );
  return fs.existsSync(safePath);
};

export const pathEntryExistsSync = (
  filePath: string,
  allowedDirs: readonly string[],
): boolean => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeEntryPath(
    filePath,
    allowedDirs,
  );
  return (
    lstatEntryIfExists(safePath, normalizedAllowedDirs, filePath) !== null
  );
};

export const readUtf8FileSync = (
  filePath: string,
  allowedDirs: readonly string[],
): string => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeFilePath(
    filePath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    filePath,
  );
  return fs.readFileSync(safePath, "utf8");
};

export const ensureDirSync = (dirPath: string, allowedDir: string): void => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeFilePath(
    dirPath,
    [allowedDir],
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    dirPath,
  );
  fs.mkdirSync(safePath, { recursive: true });
};

export const writeUtf8FileSync = (
  filePath: string,
  content: string,
  allowedDirs: readonly string[],
): void => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeFilePath(
    filePath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    filePath,
  );
  fs.writeFileSync(safePath, content, "utf8");
};

export const writeFileData = async (
  filePath: string,
  data: string | Buffer | Uint8Array,
  allowedDirs: readonly string[],
): Promise<void> => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeFilePath(
    filePath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    filePath,
  );
  await fs.writeFile(safePath, data);
};

export const removeFileSync = (
  filePath: string,
  allowedDirs: readonly string[],
): void => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeEntryPath(
    filePath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    filePath,
  );
  fs.unlinkSync(safePath);
};

export const renamePathSync = (
  sourcePath: string,
  destinationPath: string,
  allowedDirs: readonly string[],
): void => {
  const {
    absolutePath: safeSourcePath,
    normalizedAllowedDirs: normalizedSourceDirs,
  } = resolveSafeEntryPath(sourcePath, allowedDirs);
  assertPathWithinNormalizedAllowedDirs(
    safeSourcePath,
    normalizedSourceDirs,
    sourcePath,
  );

  const {
    absolutePath: safeDestinationPath,
    normalizedAllowedDirs: normalizedDestinationDirs,
  } = resolveSafeEntryPath(destinationPath, allowedDirs);
  assertPathWithinNormalizedAllowedDirs(
    safeDestinationPath,
    normalizedDestinationDirs,
    destinationPath,
  );

  fs.renameSync(safeSourcePath, safeDestinationPath);
};

export const removeDirSync = (
  dirPath: string,
  allowedDirs: readonly string[],
): void => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeEntryPath(
    dirPath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    dirPath,
  );
  fs.rmdirSync(safePath);
};

export const removePathRecursivelySync = (
  targetPath: string,
  allowedDirs: readonly string[],
): void => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeEntryPath(
    targetPath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    targetPath,
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
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeFilePath(
    dirPath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    dirPath,
  );
  return fs.readdirSync(safePath);
};

export const statSync = (
  filePath: string,
  allowedDirs: readonly string[],
): Stats => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeFilePath(
    filePath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    filePath,
  );
  return fs.statSync(safePath);
};

export const resolveRealPath = async (
  filePath: string,
  allowedDirs: readonly string[],
): Promise<string> => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeFilePath(
    filePath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    filePath,
  );
  const realPath = await fs.realpath(safePath);

  if (!isPathInsideAllowedDirs(realPath, allowedDirs)) {
    throw new Error(
      `Path traversal detected: ${filePath} is outside allowed directories`,
    );
  }

  return realPath;
};

export const statPath = async (
  filePath: string,
  allowedDirs: readonly string[],
): Promise<Stats> => {
  const { absolutePath: safePath, normalizedAllowedDirs } = resolveSafeFilePath(
    filePath,
    allowedDirs,
  );
  assertPathWithinNormalizedAllowedDirs(
    safePath,
    normalizedAllowedDirs,
    filePath,
  );
  return fs.stat(safePath);
};
