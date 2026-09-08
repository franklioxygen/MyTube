import { Request, Response } from "express";
import { VIDEOS_DIR } from "../config/paths";
import { ValidationError } from "../errors/DownloadErrors";
import * as storageService from "../services/storageService";
import { createArtifactReferenceGuard } from "../services/storageService/artifactReferences";
import { DOWNLOAD_TEMP_MARKER, isActiveDownloadTempDir, isOwnedInactiveDownloadTempDir } from "../services/downloadTempDirectories";
import { logger } from "../utils/logger";
import { readdirDirentsSafe, removeEmptyDirSafeSync, resolveSafeChildPath, unlinkSafeSync } from "../utils/security";

interface DirectorySnapshot {
  path: string;
  files: string[];
  directories: DirectorySnapshot[];
  hasSpecialEntries: boolean;
}

function requireIdleDownloads(): void {
  if (storageService.getDownloadStatus().activeDownloads.length > 0) {
    throw new ValidationError("Cannot clean up while downloads are active", "activeDownloads");
  }
}

async function collectDirectory(directory: string): Promise<DirectorySnapshot> {
  const snapshot: DirectorySnapshot = { path: directory, files: [], directories: [], hasSpecialEntries: false };
  for (const entry of await readdirDirentsSafe(directory, VIDEOS_DIR)) {
    const child = resolveSafeChildPath(directory, entry.name);
    if (entry.isDirectory()) snapshot.directories.push(await collectDirectory(child));
    else if (entry.isFile()) snapshot.files.push(child);
    else snapshot.hasSpecialEntries = true;
  }
  return snapshot;
}

/** Collect asynchronously, then validate ownership and delete without yielding. */
export const cleanupTempFiles = async (_req: Request, res: Response): Promise<void> => {
  requireIdleDownloads();
  const snapshot = await collectDirectory(VIDEOS_DIR);
  requireIdleDownloads();
  // A read failure aborts once, before any unlink. No reference snapshot is
  // held across the asynchronous directory walk.
  const isReferenced = createArtifactReferenceGuard(storageService.getArtifactOwners());
  let deletedCount = 0;
  const errors: string[] = [];
  const safely = (operation: () => void) => {
    try { operation(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      logger.warn("Temporary-file cleanup failed", { message });
    }
  };
  const protectedTree = (node: DirectorySnapshot): boolean => node.hasSpecialEntries ||
    node.files.some(isReferenced) || node.directories.some(protectedTree);
  const removeOwnedTree = (node: DirectorySnapshot) => {
    for (const child of node.directories) removeOwnedTree(child);
    // Keep the marker until the other files have been removed so an interrupted
    // cleanup remains identifiable. Never recursively remove unknown entries.
    const marker = resolveSafeChildPath(node.path, DOWNLOAD_TEMP_MARKER);
    for (const file of node.files.filter((file) => file !== marker)) {
      unlinkSafeSync(file, VIDEOS_DIR);
      deletedCount++;
    }
    if (node.files.includes(marker)) unlinkSafeSync(marker, VIDEOS_DIR);
    removeEmptyDirSafeSync(node.path, VIDEOS_DIR);
  };
  const clean = (node: DirectorySnapshot) => {
    if (isActiveDownloadTempDir(node.path)) return;
    if (isOwnedInactiveDownloadTempDir(node.path)) {
      if (!protectedTree(node)) safely(() => removeOwnedTree(node));
      return;
    }
    for (const file of node.files) {
      if ((file.endsWith(".part") || file.endsWith(".ytdl")) && !isReferenced(file)) {
        safely(() => { unlinkSafeSync(file, VIDEOS_DIR); deletedCount++; });
      }
    }
    for (const child of node.directories) clean(child);
  };
  clean(snapshot);
  res.status(200).json({ deletedCount, ...(errors.length ? { errors } : {}) });
};
