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

  if (video.videoFilename) {
    const currentVideoPath = findVideoFile(video.videoFilename, allCollections);
    const targetVideoPath = path.join(
      VIDEOS_DIR,
      collectionName,
      video.videoFilename
    );

    if (currentVideoPath && currentVideoPath !== targetVideoPath) {
      moveFile(currentVideoPath, targetVideoPath);
      updates.videoPath = `/videos/${collectionName}/${video.videoFilename}`;
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
        collectionName,
        video.thumbnailFilename
      );
      newWebPath = `/videos/${collectionName}/${video.thumbnailFilename}`;
    } else {
      targetImagePath = path.join(
        IMAGES_DIR,
        collectionName,
        video.thumbnailFilename
      );
      newWebPath = `/images/${collectionName}/${video.thumbnailFilename}`;
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
        absoluteSourcePath = path.join(UPLOADS_DIR, sub.path.replace(/^\//, ""));
      }

      let targetSubDir = "";
      let newWebPath = "";

      // Determine target based on moveSubtitlesToVideoFolder setting
      if (moveWithVideo) {
        // Always move to video folder
        targetSubDir = path.join(VIDEOS_DIR, collectionName);
        newWebPath = `/videos/${collectionName}/${path.basename(sub.path)}`;
      } else {
        // Move to central subtitles folder (mirror collection structure)
        targetSubDir = path.join(SUBTITLES_DIR, collectionName);
        newWebPath = `/subtitles/${collectionName}/${path.basename(sub.path)}`;
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
  const collectionVideoDir = path.join(VIDEOS_DIR, collectionName);
  const collectionImageDir = path.join(IMAGES_DIR, collectionName);

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
  } catch (e) {
    logger.error(
      "Error removing collection directories",
      e instanceof Error ? e : new Error(String(e))
    );
  }
}
