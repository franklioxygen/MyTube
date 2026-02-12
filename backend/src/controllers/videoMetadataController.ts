import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { getVideoDuration } from "../services/metadataService";
import * as storageService from "../services/storageService";
import { logger } from "../utils/logger";
import { successResponse } from "../utils/response";
import { execFileSafe, validateImagePath, validateVideoPath } from "../utils/security";

/**
 * Rate video
 * Errors are automatically handled by asyncHandler middleware
 */
export const rateVideo = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { rating } = req.body;

  if (typeof rating !== "number" || rating < 1 || rating > 5) {
    throw new ValidationError(
      "Rating must be a number between 1 and 5",
      "rating"
    );
  }

  const updatedVideo = storageService.updateVideo(id, { rating });

  if (!updatedVideo) {
    throw new NotFoundError("Video", id);
  }

  // Return format expected by frontend: { success: true, video: ... }
  res.status(200).json({
    success: true,
    video: updatedVideo,
  });
};

/**
 * Refresh video thumbnail
 * Errors are automatically handled by asyncHandler middleware
 */
export const refreshThumbnail = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const video = storageService.getVideoById(id);

  if (!video) {
    throw new NotFoundError("Video", id);
  }

  // Construct paths
  let videoFilePath: string;
  if (video.videoPath && video.videoPath.startsWith("/videos/")) {
    const relativePath = video.videoPath.replace(/^\/videos\//, "");
    videoFilePath = validateVideoPath(`${VIDEOS_DIR}/${relativePath}`);
  } else if (video.videoFilename) {
    const safeVideoFilename = path.basename(video.videoFilename);
    videoFilePath = validateVideoPath(`${VIDEOS_DIR}/${safeVideoFilename}`);
  } else {
    throw new ValidationError("Video file path not found in record", "video");
  }

  // Path has already been validated above.
  const validatedVideoPath = videoFilePath;

  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (!fs.existsSync(validatedVideoPath)) {
    throw new NotFoundError("Video file", validatedVideoPath);
  }

  // Determine thumbnail path on disk
  let thumbnailAbsolutePath: string;
  let needsDbUpdate = false;
  let newThumbnailFilename = video.thumbnailFilename;
  let newThumbnailPath = video.thumbnailPath;

  if (video.thumbnailPath && video.thumbnailPath.startsWith("/images/")) {
    // Local file exists (or should exist) - preserve the existing path (e.g. inside a collection folder)
    const relativePath = video.thumbnailPath.replace(/^\/images\//, "");
    thumbnailAbsolutePath = validateImagePath(`${IMAGES_DIR}/${relativePath}`);
  } else {
    // Remote URL or missing - create a new local file in the root images directory
    if (!newThumbnailFilename) {
      const videoName = path.parse(path.basename(videoFilePath)).name;
      newThumbnailFilename = `${videoName}.jpg`;
    }
    const safeThumbnailFilename = path.basename(newThumbnailFilename);
    newThumbnailFilename = safeThumbnailFilename;
    thumbnailAbsolutePath = validateImagePath(
      `${IMAGES_DIR}/${safeThumbnailFilename}`
    );
    newThumbnailPath = `/images/${safeThumbnailFilename}`;
    needsDbUpdate = true;
  }

  // Ensure directory exists
  const validatedThumbnailPath = thumbnailAbsolutePath;
  fs.ensureDirSync(path.dirname(validatedThumbnailPath));

  // Calculate random timestamp
  let timestamp = "00:00:00";
  try {
    const duration = await getVideoDuration(validatedVideoPath);
    if (duration && duration > 0) {
      // Pick a random second, avoiding the very beginning and very end if possible
      // But for simplicity and to match request "random frame", valid random second is fine.
      // Let's ensure we don't go past the end.
      const randomSecond = Math.floor(Math.random() * duration);
      const hours = Math.floor(randomSecond / 3600);
      const minutes = Math.floor((randomSecond % 3600) / 60);
      const seconds = randomSecond % 60;
      timestamp = `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
  } catch (err) {
    logger.warn("Failed to get video duration for random thumbnail, using default 00:00:00", err);
  }

  // Generate thumbnail using execFileSafe to prevent command injection
  try {
    await execFileSafe("ffmpeg", [
      "-i", validatedVideoPath,
      "-ss", timestamp,
      "-vframes", "1",
      validatedThumbnailPath,
      "-y"
    ]);
  } catch (error) {
    logger.error("Error generating thumbnail:", error);
    throw error;
  }

  // Update video record if needed (switching from remote to local, or creating new)
  if (needsDbUpdate) {
    const updates: any = {
      thumbnailFilename: newThumbnailFilename,
      thumbnailPath: newThumbnailPath,
      thumbnailUrl: newThumbnailPath,
    };
    storageService.updateVideo(id, updates);
  }

  // Return success with timestamp to bust cache
  const thumbnailUrl = `${newThumbnailPath}?t=${Date.now()}`;

  // Return format expected by frontend: { success: true, thumbnailUrl: ... }
  res.status(200).json({
    success: true,
    thumbnailUrl,
  });
};

const resolveMountVideoPathForFileSize = (
  videoPath: string
): string | null => {
  const rawPath = videoPath.substring(6);
  if (
    !rawPath ||
    !path.isAbsolute(rawPath) ||
    rawPath.includes("..") ||
    rawPath.includes("\0")
  ) {
    return null;
  }

  return path.resolve(path.normalize(rawPath));
};

const resolveLocalVideoPathForFileSize = (
  videoPath: string
): string => {
  const relativePath = videoPath.replace(/^\/videos\//, "");
  const localPath = path.join(VIDEOS_DIR, ...relativePath.split("/"));
  return validateVideoPath(localPath);
};

const resolveFilenamePathForFileSize = (
  videoFilename?: string
): string | null => {
  if (!videoFilename) {
    return null;
  }

  return validateVideoPath(path.join(VIDEOS_DIR, videoFilename));
};

const resolveVideoPathForFileSize = (
  video: storageService.Video
): string | null => {
  const { videoPath } = video;
  if (videoPath?.startsWith("cloud:")) {
    return null;
  }

  if (videoPath?.startsWith("mount:")) {
    return resolveMountVideoPathForFileSize(videoPath);
  }

  if (videoPath?.startsWith("/videos/")) {
    return resolveLocalVideoPathForFileSize(videoPath);
  }

  return resolveFilenamePathForFileSize(video.videoFilename);
};

/**
 * Refresh all video file sizes from disk
 * Errors are automatically handled by asyncHandler middleware
 */
export const refreshAllFileSizes = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const videos = storageService.getVideos();
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const video of videos) {
    let resolvedPath: string | null = null;

    try {
      resolvedPath = resolveVideoPathForFileSize(video);
    } catch (error) {
      logger.warn(`Skipping invalid video path for ${video.id}`, error);
      skippedCount += 1;
      continue;
    }

    if (!resolvedPath) {
      skippedCount += 1;
      continue;
    }

    try {
      const exists = await fs.pathExists(resolvedPath);
      if (!exists) {
        skippedCount += 1;
        continue;
      }

      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        skippedCount += 1;
        continue;
      }

      const latestFileSize = stats.size.toString();
      if (video.fileSize !== latestFileSize) {
        storageService.updateVideo(video.id, { fileSize: latestFileSize });
        updatedCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      logger.warn(`Failed to refresh file size for video ${video.id}`, error);
    }
  }

  res.status(200).json({
    success: true,
    totalCount: videos.length,
    updatedCount,
    skippedCount,
    failedCount,
  });
};

/**
 * Increment view count
 * Errors are automatically handled by asyncHandler middleware
 */
export const incrementViewCount = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const video = storageService.getVideoById(id);

  if (!video) {
    throw new NotFoundError("Video", id);
  }

  const currentViews = video.viewCount || 0;
  const updatedVideo = storageService.updateVideo(id, {
    viewCount: currentViews + 1,
    lastPlayedAt: Date.now(),
  });

  // Return format expected by frontend: { success: true, viewCount: ... }
  res.status(200).json({
    success: true,
    viewCount: updatedVideo?.viewCount,
  });
};

/**
 * Update progress
 * Errors are automatically handled by asyncHandler middleware
 */
export const updateProgress = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { progress } = req.body;

  if (typeof progress !== "number") {
    throw new ValidationError("Progress must be a number", "progress");
  }

  const updatedVideo = storageService.updateVideo(id, {
    progress,
    lastPlayedAt: Date.now(),
  });

  if (!updatedVideo) {
    throw new NotFoundError("Video", id);
  }

  res.status(200).json(
    successResponse({
      progress: updatedVideo.progress,
    })
  );
};
