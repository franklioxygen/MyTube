import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import { Collection } from "./types";

export function findVideoFile(
  filename: string,
  collections: Collection[] = []
): string | null {
  const rootPath = path.join(VIDEOS_DIR, filename);
  if (fs.existsSync(rootPath)) return rootPath;

  for (const collection of collections) {
    const collectionName = collection.name || collection.title;
    if (collectionName) {
      const collectionPath = path.join(VIDEOS_DIR, collectionName, filename);
      if (fs.existsSync(collectionPath)) return collectionPath;
    }
  }
  return null;
}

export function findImageFile(
  filename: string,
  collections: Collection[] = []
): string | null {
  const rootPath = path.join(IMAGES_DIR, filename);
  if (fs.existsSync(rootPath)) return rootPath;

  for (const collection of collections) {
    const collectionName = collection.name || collection.title;
    if (collectionName) {
      const collectionPath = path.join(IMAGES_DIR, collectionName, filename);
      if (fs.existsSync(collectionPath)) return collectionPath;
    }
  }
  return null;
}

export function moveFile(sourcePath: string, destPath: string): void {
  try {
    if (fs.existsSync(sourcePath)) {
      fs.ensureDirSync(path.dirname(destPath));
      fs.moveSync(sourcePath, destPath, { overwrite: true });
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
