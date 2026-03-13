import { Request, Response } from "express";
import axios from "axios";
import fs from "fs-extra";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { fromBuffer } from "file-type";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { getVideoDuration } from "../services/metadataService";
import * as storageService from "../services/storageService";
import { logger } from "../utils/logger";
import { successResponse } from "../utils/response";
import { execFileSafe, validateImagePath, validateUrl, validateVideoPath } from "../utils/security";

// Strict whitelist: only known-safe MIME types, extension derived from MIME (never from originalname)
const ALLOWED_IMAGE_MIMES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};
const ALLOWED_IMAGE_MIME_SET = new Set(Object.keys(ALLOWED_IMAGE_MIMES));

const IMAGE_ROOT_PATH = path.resolve(IMAGES_DIR);
const IMAGE_ROOT_PREFIX = `${IMAGE_ROOT_PATH}${path.sep}`;

const normalizeImageRelativePath = (imagePath: string): string | null => {
  const rawPath = imagePath.split("?")[0].trim();
  if (!rawPath) {
    return null;
  }

  let relativePath = rawPath;
  if (rawPath.startsWith("/images/")) {
    relativePath = rawPath.replace(/^\/images\//, "");
  } else if (path.isAbsolute(rawPath)) {
    const resolvedPath = path.resolve(rawPath);
    if (resolvedPath !== IMAGE_ROOT_PATH && !resolvedPath.startsWith(IMAGE_ROOT_PREFIX)) {
      return null;
    }
    relativePath = path.relative(IMAGE_ROOT_PATH, resolvedPath);
  }

  const safeSegments = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment: string) => path.basename(segment).trim())
    .filter((segment: string) => segment.length > 0 && segment !== "." && segment !== "..");

  if (safeSegments.length === 0) {
    return null;
  }

  return path.join(...safeSegments);
};

const resolveImageAbsolutePath = (imagePath: string): string | null => {
  const safeRelativePath = normalizeImageRelativePath(imagePath);
  if (!safeRelativePath) {
    return null;
  }

  const resolvedPath = path.resolve(IMAGE_ROOT_PATH, safeRelativePath);
  if (resolvedPath === IMAGE_ROOT_PATH || !resolvedPath.startsWith(IMAGE_ROOT_PREFIX)) {
    return null;
  }

  return resolvedPath;
};

const resolveStoredThumbnailPath = (thumbnailPath: string): string | null => {
  return normalizeImageRelativePath(thumbnailPath);
};

const removeImageFileSafely = async (imagePath: string): Promise<void> => {
  const safeResolvedPath = resolveImageAbsolutePath(imagePath);
  if (!safeResolvedPath) {
    return;
  }

  const exists = await fs.pathExists(safeResolvedPath);
  if (!exists) {
    return;
  }

  const stats = await fs.stat(safeResolvedPath);
  if (!stats.isFile()) {
    logger.warn("Skip deleting thumbnail path because it is not a file", {
      path: safeResolvedPath,
    });
    return;
  }

  await fs.remove(safeResolvedPath);
};

const validateUploadedImageContent = async (
  uploadedFile: Buffer
): Promise<string> => {
  try {
    const type = await fromBuffer(uploadedFile);
    if (!type?.mime || !ALLOWED_IMAGE_MIME_SET.has(type.mime)) {
      throw new ValidationError(
        "Uploaded file is not a valid supported image",
        "file"
      );
    }

    return type.mime;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(
      "Uploaded file is not a valid supported image",
      "file"
    );
  }
};

const createThumbnailFilename = (mimeType: string): string => {
  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const ext = ALLOWED_IMAGE_MIMES[mimeType] ?? ".jpg";
  return `${uniqueSuffix}${ext}`;
};

const refreshThumbnailFromSource = async (
  id: string,
  video: storageService.Video
): Promise<string> => {
  if (!video.sourceUrl) {
    throw new ValidationError("Video source URL not found in record", "video");
  }

  const { getVideoInfo } = await import("../services/downloadService");
  const videoInfo = await getVideoInfo(video.sourceUrl);
  const remoteThumbnailUrl = videoInfo.thumbnailUrl;

  if (!remoteThumbnailUrl) {
    throw new NotFoundError("Thumbnail source", video.sourceUrl);
  }

  let newThumbnailPath: string;
  let newThumbnailFilename: string;
  let thumbnailAbsolutePath: string;

  if (video.thumbnailPath && video.thumbnailPath.startsWith("/images/")) {
    const relativePath = video.thumbnailPath.replace(/^\/images\//, "");
    const safeRelativePath = relativePath
      .split("/")
      .filter(Boolean)
      .map((segment: string) => path.basename(segment))
      .join("/");

    thumbnailAbsolutePath = validateImagePath(
      path.join(IMAGES_DIR, ...safeRelativePath.split("/").filter(Boolean))
    );
    newThumbnailPath = `/images/${safeRelativePath}`;
    newThumbnailFilename = path.basename(safeRelativePath);
  } else {
    const fallbackBaseName = video.videoFilename
      ? path.parse(path.basename(video.videoFilename)).name
      : video.id;
    newThumbnailFilename = `${fallbackBaseName}.jpg`;
    const safeThumbnailFilename = path.basename(newThumbnailFilename);
    newThumbnailFilename = safeThumbnailFilename;
    thumbnailAbsolutePath = validateImagePath(
      path.join(IMAGES_DIR, safeThumbnailFilename)
    );
    newThumbnailPath = `/images/${safeThumbnailFilename}`;
  }

  fs.ensureDirSync(path.dirname(thumbnailAbsolutePath));

  const safeRemoteThumbnailUrl = validateUrl(remoteThumbnailUrl);
  const response = await axios.get<ArrayBuffer>(safeRemoteThumbnailUrl, {
    responseType: "arraybuffer",
    timeout: 15000,
  });

  await fs.writeFile(thumbnailAbsolutePath, Buffer.from(response.data));

  storageService.updateVideo(id, {
    thumbnailFilename: newThumbnailFilename,
    thumbnailPath: newThumbnailPath,
    thumbnailUrl: newThumbnailPath,
  });

  return `${newThumbnailPath}?t=${Date.now()}`;
};

export const thumbnailUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_MIMES, file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError("Only JPEG, PNG, WebP, GIF or AVIF images are allowed", "file"));
    }
  },
});

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

  // Resolve video path robustly: prefer stored videoPath, then root filename, then collection lookup.
  let validatedVideoPath: string | null = null;
  const attemptedPaths: string[] = [];

  if (video.videoPath && video.videoPath.startsWith("/videos/")) {
    const relativePath = video.videoPath.replace(/^\/videos\//, "");
    const candidatePath = validateVideoPath(`${VIDEOS_DIR}/${relativePath}`);
    attemptedPaths.push(candidatePath);
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(candidatePath)) {
      validatedVideoPath = candidatePath;
    }
  }

  if (!validatedVideoPath && video.videoFilename) {
    const safeVideoFilename = path.basename(video.videoFilename);
    const rootPath = validateVideoPath(`${VIDEOS_DIR}/${safeVideoFilename}`);
    attemptedPaths.push(rootPath);
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(rootPath)) {
      validatedVideoPath = rootPath;
    } else {
      const fallbackPath = storageService.findVideoFile(
        safeVideoFilename,
        storageService.getCollections()
      );
      if (fallbackPath) {
        const safeFallbackPath = validateVideoPath(fallbackPath);
        attemptedPaths.push(safeFallbackPath);
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        if (fs.existsSync(safeFallbackPath)) {
          validatedVideoPath = safeFallbackPath;
        }
      }
    }
  }

  if (!validatedVideoPath) {
    if (video.sourceUrl) {
      const thumbnailUrl = await refreshThumbnailFromSource(id, video);
      res.status(200).json({
        success: true,
        thumbnailUrl,
      });
      return;
    }

    if (attemptedPaths.length === 0) {
      throw new ValidationError("Video file path not found in record", "video");
    }
    throw new NotFoundError("Video file", attemptedPaths[0]);
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
      const videoName = path.parse(path.basename(validatedVideoPath)).name;
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

/**
 * Upload a custom thumbnail image for a video
 * Errors are automatically handled by asyncHandler middleware
 */
export const uploadThumbnail = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const video = storageService.getVideoById(id);

  if (!video) {
    throw new NotFoundError("Video", id);
  }

  if (!req.file) {
    throw new ValidationError("No image file provided", "file");
  }

  const uploadedThumbnailBuffer = req.file.buffer;
  if (!Buffer.isBuffer(uploadedThumbnailBuffer) || uploadedThumbnailBuffer.length === 0) {
    throw new ValidationError("No image file provided", "file");
  }

  const detectedMimeType = await validateUploadedImageContent(uploadedThumbnailBuffer);
  const newThumbnailFilename = createThumbnailFilename(detectedMimeType);
  const newThumbnailRelativePath =
    normalizeImageRelativePath(newThumbnailFilename) ?? newThumbnailFilename;
  const uploadedThumbnailAbsPath = validateImagePath(
    path.join(IMAGES_DIR, newThumbnailFilename)
  );
  fs.ensureDirSync(IMAGES_DIR);
  try {
    await fs.writeFile(uploadedThumbnailAbsPath, uploadedThumbnailBuffer);
  } catch (error) {
    try {
      await removeImageFileSafely(newThumbnailRelativePath);
    } catch {
      // best effort
    }
    throw error;
  }

  const newThumbnailPath = `/images/${newThumbnailFilename}`;
  let oldThumbnailRelativePath: string | null = null;
  if (video.thumbnailPath && video.thumbnailPath.startsWith("/images/")) {
    try {
      oldThumbnailRelativePath = resolveStoredThumbnailPath(video.thumbnailPath);
    } catch (err) {
      logger.warn("Failed to resolve old thumbnail path", err);
    }
  }

  let updatedVideo: storageService.Video | null;
  try {
    updatedVideo = storageService.updateVideo(id, {
      thumbnailFilename: newThumbnailFilename,
      thumbnailPath: newThumbnailPath,
      thumbnailUrl: newThumbnailPath,
    });
  } catch (error) {
    try {
      await removeImageFileSafely(newThumbnailRelativePath);
    } catch {
      // best effort
    }
    throw error;
  }

  if (!updatedVideo) {
    try {
      await removeImageFileSafely(newThumbnailRelativePath);
    } catch {
      // best effort
    }
    throw new NotFoundError("Video", id);
  }

  if (
    oldThumbnailRelativePath &&
    oldThumbnailRelativePath !== newThumbnailRelativePath
  ) {
    try {
      await removeImageFileSafely(oldThumbnailRelativePath);
    } catch (err) {
      logger.warn("Failed to delete old thumbnail file", err);
    }
  }

  res.status(200).json({
    success: true,
    thumbnailUrl: `${newThumbnailPath}?t=${Date.now()}`,
  });
};
