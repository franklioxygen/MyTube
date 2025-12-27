import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
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
    // Split by / to handle the web path separators and join with system separator
    videoFilePath = path.join(VIDEOS_DIR, ...relativePath.split("/"));
  } else if (video.videoFilename) {
    videoFilePath = path.join(VIDEOS_DIR, video.videoFilename);
  } else {
    throw new ValidationError("Video file path not found in record", "video");
  }

  // Validate paths to prevent path traversal
  const validatedVideoPath = validateVideoPath(videoFilePath);

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
    thumbnailAbsolutePath = path.join(IMAGES_DIR, ...relativePath.split("/"));
  } else {
    // Remote URL or missing - create a new local file in the root images directory
    if (!newThumbnailFilename) {
      const videoName = path.parse(path.basename(videoFilePath)).name;
      newThumbnailFilename = `${videoName}.jpg`;
    }
    thumbnailAbsolutePath = path.join(IMAGES_DIR, newThumbnailFilename);
    newThumbnailPath = `/images/${newThumbnailFilename}`;
    needsDbUpdate = true;
  }

  // Ensure directory exists
  const validatedThumbnailPath = validateImagePath(thumbnailAbsolutePath);
  fs.ensureDirSync(path.dirname(validatedThumbnailPath));

  // Generate thumbnail using execFileSafe to prevent command injection
  try {
    await execFileSafe("ffmpeg", [
      "-i", validatedVideoPath,
      "-ss", "00:00:00",
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
