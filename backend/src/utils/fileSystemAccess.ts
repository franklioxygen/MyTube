import fs from "fs-extra";
import type { Stats } from "fs";
import {
  assertSafePathEntryInAllowedDirs,
  assertSafePathInAllowedDirs,
  isPathInsideAllowedDirs,
} from "./pathSafety";

const resolveSafeFilePath = (
  filePath: string,
  allowedDirs: readonly string[],
): string => assertSafePathInAllowedDirs(filePath, allowedDirs).absolutePath;

const resolveSafeEntryPath = (
  filePath: string,
  allowedDirs: readonly string[],
): string => assertSafePathEntryInAllowedDirs(filePath, allowedDirs).absolutePath;

const lstatEntryIfExists = (targetPath: string): Stats | null => {
  const lstatSync = (fs as typeof fs & {
    lstatSync?: (currentPath: string) => Stats;
  }).lstatSync;

  if (typeof lstatSync !== "function") {
    return fs.existsSync(targetPath) ? ({} as Stats) : null;
  }

  try {
    const stats = lstatSync(targetPath);
    if (stats) {
      return stats;
    }
    return fs.existsSync(targetPath) ? ({} as Stats) : null;
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
): string => resolveSafeFilePath(filePath, allowedDirs);

export const resolveSafePathEntryInAllowedDirs = (
  filePath: string,
  allowedDirs: readonly string[],
): string => resolveSafeEntryPath(filePath, allowedDirs);

export const pathExistsSync = (
  filePath: string,
  allowedDirs: readonly string[],
): boolean => {
  const safePath = resolveSafeFilePath(filePath, allowedDirs);
  return fs.existsSync(safePath);
};

export const pathEntryExistsSync = (
  filePath: string,
  allowedDirs: readonly string[],
): boolean => lstatEntryIfExists(resolveSafeEntryPath(filePath, allowedDirs)) !== null;

export const readUtf8FileSync = (
  filePath: string,
  allowedDirs: readonly string[],
): string => fs.readFileSync(resolveSafeFilePath(filePath, allowedDirs), "utf8");

export const ensureDirSync = (dirPath: string, allowedDir: string): void => {
  fs.mkdirSync(resolveSafeFilePath(dirPath, [allowedDir]), { recursive: true });
};

export const writeUtf8FileSync = (
  filePath: string,
  content: string,
  allowedDirs: readonly string[],
): void => {
  fs.writeFileSync(resolveSafeFilePath(filePath, allowedDirs), content, "utf8");
};

export const writeFileData = async (
  filePath: string,
  data: string | Buffer | Uint8Array,
  allowedDirs: readonly string[],
): Promise<void> => {
  await fs.writeFile(resolveSafeFilePath(filePath, allowedDirs), data);
};

export const removeFileSync = (
  filePath: string,
  allowedDirs: readonly string[],
): void => {
  fs.unlinkSync(resolveSafeEntryPath(filePath, allowedDirs));
};

export const renamePathSync = (
  sourcePath: string,
  destinationPath: string,
  allowedDirs: readonly string[],
): void => {
  fs.renameSync(
    resolveSafeEntryPath(sourcePath, allowedDirs),
    resolveSafeEntryPath(destinationPath, allowedDirs),
  );
};

export const removeDirSync = (
  dirPath: string,
  allowedDirs: readonly string[],
): void => {
  fs.rmdirSync(resolveSafeEntryPath(dirPath, allowedDirs));
};

export const removePathRecursivelySync = (
  targetPath: string,
  allowedDirs: readonly string[],
): void => {
  fs.rmSync(resolveSafeEntryPath(targetPath, allowedDirs), {
    recursive: true,
    force: true,
  });
};

export const readDirSync = (
  dirPath: string,
  allowedDirs: readonly string[],
): string[] => fs.readdirSync(resolveSafeFilePath(dirPath, allowedDirs));

export const statSync = (
  filePath: string,
  allowedDirs: readonly string[],
): Stats => fs.statSync(resolveSafeFilePath(filePath, allowedDirs));

export const resolveRealPath = async (
  filePath: string,
  allowedDirs: readonly string[],
): Promise<string> => {
  const safePath = resolveSafeFilePath(filePath, allowedDirs);
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
): Promise<Stats> => fs.stat(resolveSafeFilePath(filePath, allowedDirs));
