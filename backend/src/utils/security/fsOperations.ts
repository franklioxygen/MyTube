import fs from "fs-extra";
import type {
  Dirent,
  Stats,
  WriteFileOptions,
} from "fs";
import {
  normalizeSafeAbsolutePath,
  resolveSafePathForOperation,
  validateImagePath,
} from "./pathGuards";

type ReadStreamOptions = Parameters<typeof fs.createReadStream>[1];
type WriteStreamOptions = Parameters<typeof fs.createWriteStream>[1];
type MoveSyncOptions = Parameters<typeof fs.moveSync>[2];

export function pathExistsSafeSync(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): boolean {
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
  return fs.existsSync(safePath);
}

export async function pathExistsSafe(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): Promise<boolean> {
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
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
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
  return fs.statSync(safePath);
}

export function statTrustedSync(filePath: string): Stats {
  const safePath = normalizeSafeAbsolutePath(filePath);
  return fs.statSync(safePath);
}

export async function statSafe(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): Promise<Stats> {
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
  return fs.stat(safePath);
}

export function readdirSafeSync(
  dirPath: string,
  allowedDirOrDirs: string | readonly string[],
): string[] {
  const safePath = resolveSafePathForOperation(dirPath, allowedDirOrDirs);
  return fs.readdirSync(safePath);
}

export async function readdirSafe(
  dirPath: string,
  allowedDirOrDirs: string | readonly string[],
): Promise<string[]> {
  const safePath = resolveSafePathForOperation(dirPath, allowedDirOrDirs);
  return fs.readdir(safePath);
}

export function ensureDirSafeSync(
  dirPath: string,
  allowedDirOrDirs: string | readonly string[],
): void {
  const safePath = resolveSafePathForOperation(dirPath, allowedDirOrDirs);
  fs.ensureDirSync(safePath);
}

export function readFileSafeSync(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
  encoding: BufferEncoding,
): string {
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
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
  const safePath = resolveSafePathForOperation(dirPath, allowedDirOrDirs);
  return fs.readdir(safePath, { withFileTypes: true }) as Promise<Dirent[]>;
}

export function writeFileSafeSync(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
  data: string | NodeJS.ArrayBufferView,
  options?: WriteFileOptions,
): void {
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
  fs.writeFileSync(safePath, data, options);
}

export async function writeFileSafe(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
  data: string | NodeJS.ArrayBufferView,
  options?: WriteFileOptions,
): Promise<void> {
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
  await fs.writeFile(safePath, data, options);
}

export function unlinkSafeSync(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): void {
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
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
  const safePath = resolveSafePathForOperation(dirPath, allowedDirOrDirs);
  fs.rmdirSync(safePath);
}

export async function removeSafe(
  filePath: string,
  allowedDirOrDirs: string | readonly string[],
): Promise<void> {
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
  await fs.remove(safePath);
}

export function copyFileSafeSync(
  sourcePath: string,
  sourceAllowedDirOrDirs: string | readonly string[],
  destinationPath: string,
  destinationAllowedDirOrDirs: string | readonly string[],
): void {
  const safeSourcePath = resolveSafePathForOperation(
    sourcePath,
    sourceAllowedDirOrDirs,
  );
  const safeDestinationPath = resolveSafePathForOperation(
    destinationPath,
    destinationAllowedDirOrDirs,
  );
  fs.copyFileSync(safeSourcePath, safeDestinationPath);
}

export async function copySafe(
  sourcePath: string,
  sourceAllowedDirOrDirs: string | readonly string[],
  destinationPath: string,
  destinationAllowedDirOrDirs: string | readonly string[],
): Promise<void> {
  const safeSourcePath = resolveSafePathForOperation(
    sourcePath,
    sourceAllowedDirOrDirs,
  );
  const safeDestinationPath = resolveSafePathForOperation(
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
  const safeSourcePath = resolveSafePathForOperation(
    sourcePath,
    sourceAllowedDirOrDirs,
  );
  const safeDestinationPath = resolveSafePathForOperation(
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
  const safeSourcePath = resolveSafePathForOperation(
    sourcePath,
    sourceAllowedDirOrDirs,
  );
  const safeDestinationPath = resolveSafePathForOperation(
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
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
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
  const safePath = resolveSafePathForOperation(filePath, allowedDirOrDirs);
  return fs.createWriteStream(safePath, options);
}

export async function imagePathExists(filePath: string): Promise<boolean> {
  return fs.pathExists(validateImagePath(filePath));
}

export async function removeImagePath(filePath: string): Promise<void> {
  await fs.remove(validateImagePath(filePath));
}
