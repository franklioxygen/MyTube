import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { safeRemove } from "../../../utils/downloadUtils";
import { formatVideoFilename } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import {
  resolveSafePath,
  resolveSafePathInDirectories,
  sanitizePathSegment,
} from "../../../utils/security";

export interface FilePaths {
  videoPath: string;
  thumbnailPath: string;
  videoDir: string;
  imageDir: string;
}

export interface RenamedPaths {
  newVideoPath: string;
  newThumbnailPath: string;
  finalVideoFilename: string;
  finalThumbnailFilename: string;
}

/**
 * Create a temporary directory for download
 */
export function createTempDir(): string {
  const tempDir = path.join(
    VIDEOS_DIR,
    `temp_${Date.now()}_${Math.floor(Math.random() * 10000)}`
  );
  fs.ensureDirSync(tempDir);
  logger.info("Created temp directory:", tempDir);
  return tempDir;
}

/**
 * Clean up temporary directory
 */
export async function cleanupTempDir(tempDir: string): Promise<void> {
  if (fs.existsSync(tempDir)) {
    await safeRemove(tempDir);
    logger.info("Deleted temp directory:", tempDir);
  }
}

/**
 * Prepare file paths for video and thumbnail
 */
export function prepareFilePaths(
  mergeOutputFormat: string,
  collectionName?: string,
  moveThumbnailsToVideoFolder: boolean = false
): FilePaths {
  // Create a safe base filename (without extension)
  const timestamp = Date.now();
  const safeBaseFilename = `video_${timestamp}`;

  // Add extensions for video and thumbnail (use user's format preference)
  const videoFilename = `${safeBaseFilename}.${mergeOutputFormat}`;
  const thumbnailFilename = `${safeBaseFilename}.jpg`;

  const safeCollectionName = collectionName
    ? sanitizePathSegment(collectionName)
    : "";

  // Determine directories based on collection name
  const videoDir = safeCollectionName
    ? resolveSafePath(path.join(VIDEOS_DIR, safeCollectionName), VIDEOS_DIR)
    : VIDEOS_DIR;
  const imageDir = moveThumbnailsToVideoFolder
    ? safeCollectionName
      ? resolveSafePath(path.join(VIDEOS_DIR, safeCollectionName), VIDEOS_DIR)
      : VIDEOS_DIR
    : safeCollectionName
      ? resolveSafePath(path.join(IMAGES_DIR, safeCollectionName), IMAGES_DIR)
      : IMAGES_DIR;

  // Ensure directories exist
  fs.ensureDirSync(videoDir);
  fs.ensureDirSync(imageDir);

  // Set full paths for video and thumbnail
  const videoPath = resolveSafePath(path.join(videoDir, videoFilename), videoDir);
  const thumbnailPath = resolveSafePath(
    path.join(imageDir, thumbnailFilename),
    imageDir
  );

  return {
    videoPath,
    thumbnailPath,
    videoDir,
    imageDir,
  };
}

/**
 * Find video file in temp directory
 */
export function findVideoFileInTemp(tempDir: string): string | null {
  if (!fs.existsSync(tempDir)) {
    return null;
  }

  const files = fs.readdirSync(tempDir);
  const videoFile =
    files.find((file: string) => file.endsWith(".mp4")) ||
    files.find((file: string) => file.endsWith(".mkv")) ||
    files.find((file: string) => file.endsWith(".webm")) ||
    files.find((file: string) => file.endsWith(".flv"));

  return videoFile || null;
}

/**
 * Move video file from temp directory to final location
 */
export function moveVideoFile(
  tempDir: string,
  videoFile: string,
  videoPath: string
): void {
  const safeTempDir = resolveSafePathInDirectories(tempDir, [VIDEOS_DIR]);
  const safeVideoFilename = path.basename(videoFile);
  const tempVideoPath = resolveSafePath(
    path.join(safeTempDir, safeVideoFilename),
    safeTempDir
  );
  const safeVideoPath = resolveSafePathInDirectories(videoPath, [VIDEOS_DIR]);
  fs.moveSync(tempVideoPath, safeVideoPath, { overwrite: true });
  logger.info("Moved video file to:", safeVideoPath);
}

/**
 * Rename files based on video metadata
 */
export function renameFilesWithMetadata(
  videoTitle: string,
  videoAuthor: string,
  videoDate: string,
  mergeOutputFormat: string,
  videoPath: string,
  thumbnailPath: string,
  thumbnailSaved: boolean,
  videoDir: string,
  imageDir: string
): RenamedPaths {
  // Update the safe base filename with the actual title
  const newSafeBaseFilename = formatVideoFilename(
    videoTitle,
    videoAuthor,
    videoDate
  );
  const newVideoFilename = `${newSafeBaseFilename}.${mergeOutputFormat}`;
  const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

  // Rename the files (use same directories as before)
  const safeVideoDir = resolveSafePathInDirectories(videoDir, [VIDEOS_DIR]);
  const safeImageDir = resolveSafePathInDirectories(imageDir, [
    IMAGES_DIR,
    VIDEOS_DIR,
  ]);
  const safeVideoPath = resolveSafePathInDirectories(videoPath, [VIDEOS_DIR]);
  const safeThumbnailPath = resolveSafePathInDirectories(thumbnailPath, [
    IMAGES_DIR,
    VIDEOS_DIR,
  ]);

  const newVideoPath = resolveSafePath(
    path.join(safeVideoDir, newVideoFilename),
    safeVideoDir
  );
  const newThumbnailPath = resolveSafePath(
    path.join(safeImageDir, newThumbnailFilename),
    safeImageDir
  );

  if (fs.existsSync(safeVideoPath)) {
    fs.renameSync(safeVideoPath, newVideoPath);
    logger.info("Renamed video file to:", newVideoFilename);
  } else {
    logger.info("Video file not found at:", safeVideoPath);
    throw new Error("Video file not found after download");
  }

  let finalThumbnailFilename = newThumbnailFilename;
  if (thumbnailSaved && fs.existsSync(safeThumbnailPath)) {
    fs.renameSync(safeThumbnailPath, newThumbnailPath);
    logger.info("Renamed thumbnail file to:", newThumbnailFilename);
  } else {
    // If thumbnail wasn't saved or doesn't exist, use original filename
    finalThumbnailFilename = path.basename(safeThumbnailPath);
  }

  return {
    newVideoPath,
    newThumbnailPath,
    finalVideoFilename: newVideoFilename,
    finalThumbnailFilename,
  };
}

/**
 * Clean up files on cancellation
 */
export async function cleanupFilesOnCancellation(
  videoPath: string,
  thumbnailPath: string,
  tempDir?: string
): Promise<void> {
  try {
    if (tempDir && fs.existsSync(tempDir)) {
      await safeRemove(tempDir);
      logger.info("Deleted temp directory:", tempDir);
    }
    if (fs.existsSync(videoPath)) {
      await safeRemove(videoPath);
      logger.info("Deleted partial video file:", videoPath);
    }
    if (fs.existsSync(thumbnailPath)) {
      await safeRemove(thumbnailPath);
      logger.info("Deleted partial thumbnail file:", thumbnailPath);
    }
  } catch (cleanupError) {
    logger.error("Error cleaning up files:", cleanupError);
  }
}
