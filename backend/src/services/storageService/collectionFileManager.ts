import fs from "fs-extra";
import path from "path";
import {
  IMAGES_DIR,
  SUBTITLES_DIR,
  UPLOADS_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import { logger } from "../../utils/logger";
import { findImageFile, findVideoFile, moveFile } from "./fileHelpers";
import { getSettings } from "./settings";
import { Collection, Video } from "./types";

/**
 * Sanitizes a collection name to prevent path traversal attacks
 * Removes path separators and dangerous sequences
 */
function sanitizeCollectionName(collectionName: string): string {
  // Remove path traversal sequences and path separators
  return collectionName
    .replace(/\.\./g, "") // Remove parent directory references
    .replace(/[\/\\]/g, "") // Remove path separators
    .trim();
}

/**
 * File manager layer for collection-related file operations
 * This module handles all file system operations when videos are added/removed from collections
 */

export interface FileMoveResult {
  updated: boolean;
  updates: Partial<Video>;
}

/**
 * Move video files to a collection directory
 */
export function moveVideoToCollection(
  video: Video,
  collectionName: string,
  allCollections: Collection[]
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  // Sanitize collection name to prevent path traversal
  const sanitizedCollectionName = sanitizeCollectionName(collectionName);
  if (!sanitizedCollectionName) {
    logger.warn(`Invalid collection name provided: ${collectionName}`);
    return { updated: false, updates: {} };
  }

  if (video.videoFilename) {
    const currentVideoPath = findVideoFile(video.videoFilename, allCollections);
    const targetVideoPath = path.join(
      VIDEOS_DIR,
      sanitizedCollectionName,
      video.videoFilename
    );

    if (currentVideoPath && currentVideoPath !== targetVideoPath) {
      moveFile(currentVideoPath, targetVideoPath);
      updates.videoPath = `/videos/${sanitizedCollectionName}/${video.videoFilename}`;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move video files from a collection directory (to root or another collection)
 */
export function moveVideoFromCollection(
  video: Video,
  targetVideoDir: string,
  videoPathPrefix: string,
  allCollections: Collection[]
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  if (video.videoFilename) {
    const currentVideoPath = findVideoFile(video.videoFilename, allCollections);
    const targetVideoPath = path.join(targetVideoDir, video.videoFilename);

    if (currentVideoPath && currentVideoPath !== targetVideoPath) {
      moveFile(currentVideoPath, targetVideoPath);
      updates.videoPath = `${videoPathPrefix}/${video.videoFilename}`;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move thumbnail files to a collection directory
 */
export function moveThumbnailToCollection(
  video: Video,
  collectionName: string,
  allCollections: Collection[]
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  // Sanitize collection name to prevent path traversal
  const sanitizedCollectionName = sanitizeCollectionName(collectionName);
  if (!sanitizedCollectionName) {
    logger.warn(`Invalid collection name provided: ${collectionName}`);
    return { updated: false, updates: {} };
  }

  if (video.thumbnailFilename) {
    // Find existing file using path from DB if possible, or fallback to search
    let currentImagePath = "";
    if (video.thumbnailPath) {
      if (video.thumbnailPath.startsWith("/videos/")) {
        currentImagePath = path.join(
          VIDEOS_DIR,
          video.thumbnailPath.replace(/^\/videos\//, "")
        );
      } else if (video.thumbnailPath.startsWith("/images/")) {
        currentImagePath = path.join(
          IMAGES_DIR,
          video.thumbnailPath.replace(/^\/images\//, "")
        );
      }
    }

    if (!currentImagePath || !fs.existsSync(currentImagePath)) {
      currentImagePath =
        findImageFile(video.thumbnailFilename, allCollections) || "";
    }

    // Determine target
    const settings = getSettings();
    const moveWithVideo = settings.moveThumbnailsToVideoFolder;

    let targetImagePath = "";
    let newWebPath = "";

    if (moveWithVideo) {
      targetImagePath = path.join(
        VIDEOS_DIR,
        sanitizedCollectionName,
        video.thumbnailFilename
      );
      newWebPath = `/videos/${sanitizedCollectionName}/${video.thumbnailFilename}`;
    } else {
      targetImagePath = path.join(
        IMAGES_DIR,
        sanitizedCollectionName,
        video.thumbnailFilename
      );
      newWebPath = `/images/${sanitizedCollectionName}/${video.thumbnailFilename}`;
    }

    if (currentImagePath && currentImagePath !== targetImagePath) {
      moveFile(currentImagePath, targetImagePath);
      updates.thumbnailPath = newWebPath;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move thumbnail files from a collection directory (to root or another collection)
 */
export function moveThumbnailFromCollection(
  video: Video,
  targetVideoDir: string,
  targetImageDir: string,
  videoPathPrefix: string,
  imagePathPrefix: string,
  allCollections: Collection[]
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  if (video.thumbnailFilename) {
    // Find existing file using path from DB if possible
    let currentImagePath = "";
    if (video.thumbnailPath) {
      if (video.thumbnailPath.startsWith("/videos/")) {
        currentImagePath = path.join(
          VIDEOS_DIR,
          video.thumbnailPath.replace(/^\/videos\//, "")
        );
      } else if (video.thumbnailPath.startsWith("/images/")) {
        currentImagePath = path.join(
          IMAGES_DIR,
          video.thumbnailPath.replace(/^\/images\//, "")
        );
      }
    }

    if (!currentImagePath || !fs.existsSync(currentImagePath)) {
      currentImagePath =
        findImageFile(video.thumbnailFilename, allCollections) || "";
    }

    // Determine target
    const settings = getSettings();
    const moveWithVideo = settings.moveThumbnailsToVideoFolder;

    let targetImagePath = "";
    let newWebPath = "";

    if (moveWithVideo) {
      // Target is same as video target
      targetImagePath = path.join(targetVideoDir, video.thumbnailFilename);
      newWebPath = `${videoPathPrefix}/${video.thumbnailFilename}`;
    } else {
      // Target is image dir (root or other collection)
      targetImagePath = path.join(targetImageDir, video.thumbnailFilename);
      newWebPath = `${imagePathPrefix}/${video.thumbnailFilename}`;
    }

    if (currentImagePath && currentImagePath !== targetImagePath) {
      moveFile(currentImagePath, targetImagePath);
      updates.thumbnailPath = newWebPath;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move subtitle files to a collection directory
 */
export function moveSubtitlesToCollection(
  video: Video,
  collectionName: string
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  // Sanitize collection name to prevent path traversal
  const sanitizedCollectionName = sanitizeCollectionName(collectionName);
  if (!sanitizedCollectionName) {
    logger.warn(`Invalid collection name provided: ${collectionName}`);
    return { updated: false, updates: {} };
  }

  if (video.subtitles && video.subtitles.length > 0) {
    const newSubtitles = [...video.subtitles];
    let subtitlesUpdated = false;

    // Get settings to respect moveSubtitlesToVideoFolder
    const settings = getSettings();
    const moveWithVideo = settings.moveSubtitlesToVideoFolder;

    newSubtitles.forEach((sub, index) => {
      let currentSubPath = sub.path;
      // Determine existing absolute path
      let absoluteSourcePath = "";
      if (sub.path.startsWith("/videos/")) {
        absoluteSourcePath = path.join(
          VIDEOS_DIR,
          sub.path.replace("/videos/", "")
        );
      } else if (sub.path.startsWith("/subtitles/")) {
        absoluteSourcePath = path.join(
          UPLOADS_DIR,
          sub.path.replace(/^\//, "")
        );
      }

      let targetSubDir = "";
      let newWebPath = "";

      // Determine target based on moveSubtitlesToVideoFolder setting
      if (moveWithVideo) {
        // Always move to video folder
        targetSubDir = path.join(VIDEOS_DIR, sanitizedCollectionName);
        newWebPath = `/videos/${sanitizedCollectionName}/${path.basename(sub.path)}`;
      } else {
        // Move to central subtitles folder (mirror collection structure)
        targetSubDir = path.join(SUBTITLES_DIR, sanitizedCollectionName);
        newWebPath = `/subtitles/${sanitizedCollectionName}/${path.basename(sub.path)}`;
      }

      if (absoluteSourcePath && targetSubDir && newWebPath) {
        const targetSubPath = path.join(targetSubDir, path.basename(sub.path));
        if (
          fs.existsSync(absoluteSourcePath) &&
          absoluteSourcePath !== targetSubPath
        ) {
          moveFile(absoluteSourcePath, targetSubPath);
          newSubtitles[index] = {
            ...sub,
            path: newWebPath,
          };
          subtitlesUpdated = true;
        }
      }
    });

    if (subtitlesUpdated) {
      updates.subtitles = newSubtitles;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move subtitle files from a collection directory (to root or another collection)
 */
export function moveSubtitlesFromCollection(
  video: Video,
  targetVideoDir: string,
  targetSubDir: string,
  videoPathPrefix: string,
  subtitlePathPrefix?: string
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  if (video.subtitles && video.subtitles.length > 0) {
    const newSubtitles = [...video.subtitles];
    let subtitlesUpdated = false;

    newSubtitles.forEach((sub, index) => {
      let absoluteSourcePath = "";
      // Construct absolute source path based on DB path
      if (sub.path.startsWith("/videos/")) {
        absoluteSourcePath = path.join(
          VIDEOS_DIR,
          sub.path.replace("/videos/", "")
        );
      } else if (sub.path.startsWith("/subtitles/")) {
        // sub.path is like /subtitles/Collection/file.vtt
        // SUBTITLES_DIR is uploads/subtitles
        absoluteSourcePath = path.join(
          UPLOADS_DIR,
          sub.path.replace(/^\//, "")
        ); // path.join(headers...) -> uploads/subtitles/...
      }

      let targetSubDirPath = "";
      let newWebPath = "";

      if (sub.path.startsWith("/videos/")) {
        targetSubDirPath = targetVideoDir; // Calculated above (root or other collection)
        newWebPath = `${videoPathPrefix}/${path.basename(sub.path)}`;
      } else if (sub.path.startsWith("/subtitles/")) {
        // Should move to root subtitles or other collection subtitles
        targetSubDirPath = targetSubDir;
        newWebPath = subtitlePathPrefix
          ? `${subtitlePathPrefix}/${path.basename(sub.path)}`
          : `/subtitles/${path.basename(sub.path)}`;
      }

      if (absoluteSourcePath && targetSubDirPath && newWebPath) {
        const targetSubPath = path.join(
          targetSubDirPath,
          path.basename(sub.path)
        );

        // Ensure correct paths for move
        // Need to handle potential double slashes or construction issues if any
        if (
          fs.existsSync(absoluteSourcePath) &&
          absoluteSourcePath !== targetSubPath
        ) {
          moveFile(absoluteSourcePath, targetSubPath);
          newSubtitles[index] = {
            ...sub,
            path: newWebPath,
          };
          subtitlesUpdated = true;
        }
      }
    });

    if (subtitlesUpdated) {
      updates.subtitles = newSubtitles;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move all video files (video, thumbnail, subtitles) to a collection
 */
export function moveAllFilesToCollection(
  video: Video,
  collectionName: string,
  allCollections: Collection[]
): Partial<Video> {
  const allUpdates: Partial<Video> = {};

  // Move video file
  const videoResult = moveVideoToCollection(
    video,
    collectionName,
    allCollections
  );
  if (videoResult.updated) {
    Object.assign(allUpdates, videoResult.updates);
  }

  // Move thumbnail
  const thumbnailResult = moveThumbnailToCollection(
    video,
    collectionName,
    allCollections
  );
  if (thumbnailResult.updated) {
    Object.assign(allUpdates, thumbnailResult.updates);
  }

  // Move subtitles
  const subtitlesResult = moveSubtitlesToCollection(video, collectionName);
  if (subtitlesResult.updated) {
    Object.assign(allUpdates, subtitlesResult.updates);
  }

  return allUpdates;
}

/**
 * Move all video files (video, thumbnail, subtitles) from a collection
 */
export function moveAllFilesFromCollection(
  video: Video,
  targetVideoDir: string,
  targetImageDir: string,
  targetSubDir: string,
  videoPathPrefix: string,
  imagePathPrefix: string,
  subtitlePathPrefix: string | undefined,
  allCollections: Collection[]
): Partial<Video> {
  const allUpdates: Partial<Video> = {};

  // Move video file
  const videoResult = moveVideoFromCollection(
    video,
    targetVideoDir,
    videoPathPrefix,
    allCollections
  );
  if (videoResult.updated) {
    Object.assign(allUpdates, videoResult.updates);
  }

  // Move thumbnail
  const thumbnailResult = moveThumbnailFromCollection(
    video,
    targetVideoDir,
    targetImageDir,
    videoPathPrefix,
    imagePathPrefix,
    allCollections
  );
  if (thumbnailResult.updated) {
    Object.assign(allUpdates, thumbnailResult.updates);
  }

  // Move subtitles
  const subtitlesResult = moveSubtitlesFromCollection(
    video,
    targetVideoDir,
    targetSubDir,
    videoPathPrefix,
    subtitlePathPrefix
  );
  if (subtitlesResult.updated) {
    Object.assign(allUpdates, subtitlesResult.updates);
  }

  return allUpdates;
}

/**
 * Clean up empty collection directories
 */
export function cleanupCollectionDirectories(collectionName: string): void {
  // Sanitize collection name to prevent path traversal
  const sanitizedCollectionName = sanitizeCollectionName(collectionName);
  if (!sanitizedCollectionName) {
    logger.warn(`Invalid collection name provided: ${collectionName}`);
    return;
  }
  
  const collectionVideoDir = path.join(VIDEOS_DIR, sanitizedCollectionName);
  const collectionImageDir = path.join(IMAGES_DIR, sanitizedCollectionName);
  const collectionSubtitleDir = path.join(SUBTITLES_DIR, sanitizedCollectionName);

  try {
    if (
      fs.existsSync(collectionVideoDir) &&
      fs.readdirSync(collectionVideoDir).length === 0
    ) {
      fs.rmdirSync(collectionVideoDir);
    }
    if (
      fs.existsSync(collectionImageDir) &&
      fs.readdirSync(collectionImageDir).length === 0
    ) {
      fs.rmdirSync(collectionImageDir);
    }
    if (
      fs.existsSync(collectionSubtitleDir) &&
      fs.readdirSync(collectionSubtitleDir).length === 0
    ) {
      fs.rmdirSync(collectionSubtitleDir);
    }
  } catch (e) {
    logger.error(
      "Error removing collection directories",
      e instanceof Error ? e : new Error(String(e))
    );
  }
}

/**
 * Rename collection directories (video, image, subtitle)
 */
export function renameCollectionDirectories(
  oldName: string,
  newName: string
): boolean {
  // Sanitize both names
  const sanitizedOldName = sanitizeCollectionName(oldName);
  const sanitizedNewName = sanitizeCollectionName(newName);

  if (!sanitizedOldName || !sanitizedNewName || sanitizedOldName === sanitizedNewName) {
    return false;
  }

  let success = true;

  // Function to rename a specific type of directory
  const renameDir = (baseDir: string): void => {
    const oldDir = path.join(baseDir, sanitizedOldName);
    const newDir = path.join(baseDir, sanitizedNewName);

    // Validate paths to prevent path traversal
    const normalizedOldDir = path.normalize(oldDir);
    const normalizedNewDir = path.normalize(newDir);
    const normalizedBaseDir = path.normalize(baseDir);

    // Ensure paths are within base directory
    if (!normalizedOldDir.startsWith(normalizedBaseDir) || !normalizedNewDir.startsWith(normalizedBaseDir)) {
      logger.error(`Path traversal detected: oldDir=${oldDir}, newDir=${newDir}, baseDir=${baseDir}`);
      success = false;
      return;
    }

    try {
      if (fs.existsSync(oldDir)) {
        if (fs.existsSync(newDir)) {
          // If target directory already exists, we fail for now or merge.
          // Let's assume name collision check is done before.
          // But if it exists, merging is safer than overwriting.
          logger.warn(`Target directory ${newDir} already exists. Merging content.`);
          
          // Move all files from old to new
          const files = fs.readdirSync(oldDir);
          files.forEach(file => {
             const oldFile = path.join(oldDir, file);
             const newFile = path.join(newDir, file);
             try {
                moveFile(oldFile, newFile);
             } catch (e) {
                logger.error(`Error moving file ${oldFile} to ${newFile}: ${e}`);
                success = false;
             }
          });
          // Remove old directory (use recursive to handle non-empty dirs)
          try {
            if (fs.existsSync(oldDir)) {
              fs.rmSync(oldDir, { recursive: true, force: true });
            }
          } catch (e) {
            logger.error(`Error removing old directory ${oldDir}: ${e}`);
            success = false;
          }
        } else {
          // Simple rename
          fs.renameSync(oldDir, newDir);
        }
      }
    } catch (e) {
      logger.error(
        `Error renaming directory from ${oldDir} to ${newDir}`,
        e instanceof Error ? e : new Error(String(e))
      );
      success = false;
    }
  };

  renameDir(VIDEOS_DIR);
  renameDir(IMAGES_DIR);
  renameDir(SUBTITLES_DIR);

  return success;
}

/**
 * Update video paths in memory after a collection rename
 */
export function updateVideoPathsForCollectionRename(
  video: Video,
  oldName: string,
  newName: string
): Partial<Video> {
  const updates: Partial<Video> = {};
  const sanitizedOldName = sanitizeCollectionName(oldName);
  const sanitizedNewName = sanitizeCollectionName(newName);

  if (!sanitizedOldName || !sanitizedNewName) return updates;

  // Helper to replace path part
  const replacePath = (currentPath: string, prefix: string): string => {
    // path is web access path, usually /videos/CollectionName/file.mp4
    const oldPrefix = `${prefix}/${sanitizedOldName}/`;
    const newPrefix = `${prefix}/${sanitizedNewName}/`;
    
    if (currentPath.startsWith(oldPrefix)) {
      return currentPath.replace(oldPrefix, newPrefix);
    }
    return currentPath;
  };

  if (video.videoPath) {
    // Assume paths start with /videos for collection items
    const newPath = replacePath(video.videoPath, '/videos');
    if (newPath !== video.videoPath) updates.videoPath = newPath;
  }

  if (video.thumbnailPath) {
    let newPath = video.thumbnailPath;
    if (video.thumbnailPath.startsWith('/videos/')) {
       newPath = replacePath(video.thumbnailPath, '/videos');
    } else if (video.thumbnailPath.startsWith('/images/')) {
       newPath = replacePath(video.thumbnailPath, '/images');
    }
    
    if (newPath !== video.thumbnailPath) updates.thumbnailPath = newPath;
  }

  if (video.subtitles) {
    const newSubtitles = video.subtitles.map(sub => {
      let newPath = sub.path;
      if (sub.path.startsWith('/videos/')) {
         newPath = replacePath(sub.path, '/videos');
      } else if (sub.path.startsWith('/subtitles/')) {
         newPath = replacePath(sub.path, '/subtitles');
      }
      return { ...sub, path: newPath };
    });

    // Check if any subtitle changed
    const changed = newSubtitles.some((sub, i) => sub.path !== video.subtitles![i].path);
    if (changed) updates.subtitles = newSubtitles;
  }

  return updates;
}
