import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { ValidationError } from "../errors/DownloadErrors";
import {
  clearThumbnailCache,
  downloadAndCacheThumbnail,
  getCachedThumbnail,
} from "../services/cloudStorage/cloudThumbnailCache";
import { CloudStorageService } from "../services/CloudStorageService";
import { getVideos } from "../services/storageService";
import { logger } from "../utils/logger";

/**
 * Get signed URL for a cloud storage file
 * GET /api/cloud/signed-url?filename=xxx&type=video|thumbnail
 * For thumbnails, checks local cache first before fetching from cloud
 */
export const getSignedUrl = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { filename, type } = req.query;

  if (!filename || typeof filename !== "string") {
    throw new ValidationError("filename is required", "filename");
  }

  if (type && type !== "video" && type !== "thumbnail") {
    throw new ValidationError("type must be 'video' or 'thumbnail'", "type");
  }

  const fileType = (type as "video" | "thumbnail") || "video";

  // For thumbnails, check local cache first
  if (fileType === "thumbnail") {
    const cloudPath = `cloud:${filename}`;
    const cachedPath = getCachedThumbnail(cloudPath);

    if (cachedPath) {
      // Return local cache URL
      const cacheUrl = `/api/cloud/thumbnail-cache/${path.basename(
        cachedPath
      )}`;
      res.status(200).json({
        success: true,
        url: cacheUrl,
        cached: true,
      });
      return;
    }

    // Cache miss, get signed URL from cloud and download/cache it
    const signedUrl = await CloudStorageService.getSignedUrl(
      filename,
      fileType
    );

    if (!signedUrl) {
      res.status(404).json({
        success: false,
        message:
          "File not found in cloud storage or cloud storage not configured",
      });
      return;
    }

    // Download and cache the thumbnail
    const cachedFilePath = await downloadAndCacheThumbnail(
      cloudPath,
      signedUrl
    );

    if (cachedFilePath) {
      // Return local cache URL
      const cacheUrl = `/api/cloud/thumbnail-cache/${path.basename(
        cachedFilePath
      )}`;
      res.status(200).json({
        success: true,
        url: cacheUrl,
        cached: true,
      });
      return;
    }

    // If caching failed, fall back to cloud URL
    res.status(200).json({
      success: true,
      url: signedUrl,
      cached: false,
    });
    return;
  }

  // For videos, use original logic
  const signedUrl = await CloudStorageService.getSignedUrl(filename, fileType);

  if (!signedUrl) {
    res.status(404).json({
      success: false,
      message:
        "File not found in cloud storage or cloud storage not configured",
    });
    return;
  }

  res.status(200).json({
    success: true,
    url: signedUrl,
  });
};

/**
 * Clear local thumbnail cache for cloud storage videos
 * DELETE /api/cloud/thumbnail-cache
 */
export const clearThumbnailCacheEndpoint = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    clearThumbnailCache(); // Clear all cache
    logger.info("[CloudStorage] Cleared all thumbnail cache");
    res.status(200).json({
      success: true,
      message: "Thumbnail cache cleared successfully",
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("[CloudStorage] Failed to clear thumbnail cache:", error);
    res.status(500).json({
      success: false,
      message: `Failed to clear cache: ${errorMessage}`,
    });
  }
};

interface SyncProgress {
  type: "progress" | "complete" | "error";
  current?: number;
  total?: number;
  currentFile?: string;
  message?: string;
  report?: {
    total: number;
    uploaded: number;
    skipped: number;
    failed: number;
    cloudScanAdded?: number;
    errors: string[];
  };
}

/**
 * Sync all local videos to cloud storage
 * POST /api/cloud/sync
 * Streams progress updates as JSON lines
 */
export const syncToCloud = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Set headers for streaming response
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Transfer-Encoding", "chunked");

  const sendProgress = (progress: SyncProgress) => {
    res.write(JSON.stringify(progress) + "\n");
  };

  try {
    // Get all videos
    const allVideos = getVideos();

    // Helper function to resolve absolute path (similar to CloudStorageService.resolveAbsolutePath)
    const resolveAbsolutePath = (relativePath: string): string | null => {
      if (!relativePath || relativePath.startsWith("cloud:")) {
        return null;
      }

      const cleanRelative = relativePath.startsWith("/")
        ? relativePath.slice(1)
        : relativePath;

      // Check uploads directory first
      const uploadsBase = path.join(process.cwd(), "uploads");
      if (
        cleanRelative.startsWith("videos/") ||
        cleanRelative.startsWith("images/") ||
        cleanRelative.startsWith("subtitles/")
      ) {
        const fullPath = path.join(uploadsBase, cleanRelative);
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      }

      // Check data directory (backward compatibility)
      const possibleRoots = [
        path.join(process.cwd(), "data"),
        path.join(process.cwd(), "..", "data"),
      ];
      for (const root of possibleRoots) {
        if (fs.existsSync(root)) {
          const fullPath = path.join(root, cleanRelative);
          if (fs.existsSync(fullPath)) {
            return fullPath;
          }
        }
      }

      return null;
    };

    // Filter videos that have local files (not already in cloud)
    const localVideos = allVideos.filter((video) => {
      const videoPath = video.videoPath;
      const thumbnailPath = video.thumbnailPath;

      // Check if files actually exist locally (not in cloud)
      const hasLocalVideo =
        videoPath &&
        !videoPath.startsWith("cloud:") &&
        resolveAbsolutePath(videoPath) !== null;
      const hasLocalThumbnail =
        thumbnailPath &&
        !thumbnailPath.startsWith("cloud:") &&
        resolveAbsolutePath(thumbnailPath) !== null;

      // Include if at least one file is local
      return hasLocalVideo || hasLocalThumbnail;
    });

    const total = localVideos.length;
    let uploaded = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    sendProgress({
      type: "progress",
      current: 0,
      total,
      message: `Found ${total} videos with local files to sync`,
    });

    // Process each video
    for (let i = 0; i < localVideos.length; i++) {
      const video = localVideos[i];

      sendProgress({
        type: "progress",
        current: i + 1,
        total,
        currentFile: video.title || video.id,
        message: `Uploading: ${video.title || video.id}`,
      });

      try {
        // Prepare video data for upload
        const videoData = {
          ...video,
          videoPath: video.videoPath,
          thumbnailPath: video.thumbnailPath,
          videoFilename: video.videoFilename,
          thumbnailFilename: video.thumbnailFilename,
        };

        // Upload using CloudStorageService
        await CloudStorageService.uploadVideo(videoData);

        uploaded++;

        logger.info(
          `[CloudSync] Successfully synced video: ${video.title || video.id}`
        );
      } catch (error: any) {
        failed++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        errors.push(`${video.title || video.id}: ${errorMessage}`);
        logger.error(
          `[CloudSync] Failed to sync video ${video.title || video.id}:`,
          error instanceof Error ? error : new Error(errorMessage)
        );
      }
    }

    // Send completion report for upload sync
    sendProgress({
      type: "progress",
      message: `Upload sync completed: ${uploaded} uploaded, ${failed} failed. Starting cloud scan...`,
    });

    // Now scan cloud storage for videos not in database (Two-way Sync)
    let cloudScanAdded = 0;
    const cloudScanErrors: string[] = [];

    try {
      const scanResult = await CloudStorageService.scanCloudFiles(
        (message, current, total) => {
          sendProgress({
            type: "progress",
            message: `Cloud scan: ${message}`,
            current: current,
            total: total,
          });
        }
      );

      cloudScanAdded = scanResult.added;
      cloudScanErrors.push(...scanResult.errors);
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      cloudScanErrors.push(`Cloud scan failed: ${errorMessage}`);
      logger.error(
        "[CloudSync] Cloud scan error:",
        error instanceof Error ? error : new Error(errorMessage)
      );
    }

    // Send final completion report
    sendProgress({
      type: "complete",
      report: {
        total,
        uploaded,
        skipped,
        failed,
        cloudScanAdded, // Add count of videos added from cloud scan
        errors: [...errors, ...cloudScanErrors],
      },
      message: `Two-way sync completed: ${uploaded} uploaded, ${cloudScanAdded} added from cloud, ${failed} failed`,
    });

    res.end();
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      "[CloudSync] Sync failed:",
      error instanceof Error ? error : new Error(errorMessage)
    );

    sendProgress({
      type: "error",
      message: `Sync failed: ${errorMessage}`,
    });

    res.end();
  }
};
