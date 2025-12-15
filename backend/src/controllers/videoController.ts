import { exec } from "child_process";
import { Request, Response } from "express";
import fs from "fs-extra";
import multer from "multer";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import downloadManager from "../services/downloadManager";
import * as downloadService from "../services/downloadService";
import { getVideoDuration } from "../services/metadataService";
import * as storageService from "../services/storageService";
import {
  extractBilibiliVideoId,
  extractSourceVideoId,
  extractUrlFromText,
  isBilibiliUrl,
  isValidUrl,
  resolveShortUrl,
  trimBilibiliUrl,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import { successResponse } from "../utils/response";

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.ensureDirSync(VIDEOS_DIR);
    cb(null, VIDEOS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

export const upload = multer({ storage: storage });

/**
 * Search for videos
 * Errors are automatically handled by asyncHandler middleware
 */
export const searchVideos = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { query } = req.query;

  if (!query) {
    throw new ValidationError("Search query is required", "query");
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string) : 8;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : 1;

  const results = await downloadService.searchYouTube(
    query as string,
    limit,
    offset
  );
  res.status(200).json(successResponse({ results }));
};

/**
 * Check video download status
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkVideoDownloadStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    throw new ValidationError("URL is required", "url");
  }

  let videoUrl = extractUrlFromText(url);

  // Resolve shortened URLs
  if (videoUrl.includes("b23.tv")) {
    videoUrl = await resolveShortUrl(videoUrl);
  }

  // Extract source video ID
  const { id: sourceVideoId, platform } = extractSourceVideoId(videoUrl);

  if (!sourceVideoId) {
    res.status(200).json(successResponse({ found: false }));
    return;
  }

  // Check if video was previously downloaded
  const downloadCheck =
    storageService.checkVideoDownloadBySourceId(sourceVideoId);

  if (downloadCheck.found) {
    // If status is "exists", verify the video still exists in the database
    if (downloadCheck.status === "exists" && downloadCheck.videoId) {
      const existingVideo = storageService.getVideoById(downloadCheck.videoId);
      if (!existingVideo) {
        // Video was deleted but not marked in download history, update it
        storageService.markVideoDownloadDeleted(downloadCheck.videoId);
        res.status(200).json(
          successResponse({
            found: true,
            status: "deleted",
            title: downloadCheck.title,
            author: downloadCheck.author,
            downloadedAt: downloadCheck.downloadedAt,
          })
        );
        return;
      }

      res.status(200).json(
        successResponse({
          found: true,
          status: "exists",
          videoId: downloadCheck.videoId,
          title: downloadCheck.title || existingVideo.title,
          author: downloadCheck.author || existingVideo.author,
          downloadedAt: downloadCheck.downloadedAt,
          videoPath: existingVideo.videoPath,
          thumbnailPath: existingVideo.thumbnailPath,
        })
      );
      return;
    }

    res.status(200).json(
      successResponse({
        found: true,
        status: downloadCheck.status,
        title: downloadCheck.title,
        author: downloadCheck.author,
        downloadedAt: downloadCheck.downloadedAt,
        deletedAt: downloadCheck.deletedAt,
      })
    );
    return;
  }

  res.status(200).json(successResponse({ found: false }));
};

// Download video
export const downloadVideo = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const {
      youtubeUrl,
      downloadAllParts,
      collectionName,
      downloadCollection,
      collectionInfo,
      forceDownload, // Allow re-download of deleted videos
    } = req.body;
    let videoUrl = youtubeUrl;

    if (!videoUrl) {
      return res.status(400).json({ error: "Video URL is required" });
    }

    logger.info("Processing download request for input:", videoUrl);

    // Extract URL if the input contains text with a URL
    videoUrl = extractUrlFromText(videoUrl);
    logger.info("Extracted URL:", videoUrl);

    // Check if the input is a valid URL
    if (!isValidUrl(videoUrl)) {
      // If not a valid URL, treat it as a search term
      return res.status(400).json({
        error: "Not a valid URL",
        isSearchTerm: true,
        searchTerm: videoUrl,
      });
    }

    // Resolve shortened URLs first to get the real URL for checking
    let resolvedUrl = videoUrl;
    if (videoUrl.includes("b23.tv")) {
      resolvedUrl = await resolveShortUrl(videoUrl);
      logger.info("Resolved shortened URL to:", resolvedUrl);
    }

    // Extract source video ID for checking download history
    const { id: sourceVideoId, platform } = extractSourceVideoId(resolvedUrl);

    // Check if video was previously downloaded (skip for collections/multi-part)
    if (sourceVideoId && !downloadAllParts && !downloadCollection) {
      const downloadCheck =
        storageService.checkVideoDownloadBySourceId(sourceVideoId);

      if (downloadCheck.found) {
        if (downloadCheck.status === "exists" && downloadCheck.videoId) {
          // Verify the video still exists
          const existingVideo = storageService.getVideoById(
            downloadCheck.videoId
          );
          if (existingVideo) {
            // Video exists, add to download history as "skipped" and return success
            storageService.addDownloadHistoryItem({
              id: Date.now().toString(),
              title: downloadCheck.title || existingVideo.title,
              author: downloadCheck.author || existingVideo.author,
              sourceUrl: resolvedUrl,
              finishedAt: Date.now(),
              status: "skipped",
              videoPath: existingVideo.videoPath,
              thumbnailPath: existingVideo.thumbnailPath,
              videoId: existingVideo.id,
            });

            return res.status(200).json({
              success: true,
              skipped: true,
              videoId: downloadCheck.videoId,
              title: downloadCheck.title || existingVideo.title,
              author: downloadCheck.author || existingVideo.author,
              videoPath: existingVideo.videoPath,
              message: "Video already exists, skipped download",
            });
          }
          // Video was deleted but not marked, update the record
          storageService.markVideoDownloadDeleted(downloadCheck.videoId);
        }

        if (downloadCheck.status === "deleted" && !forceDownload) {
          // Video was previously downloaded but deleted - add to history and skip
          storageService.addDownloadHistoryItem({
            id: Date.now().toString(),
            title: downloadCheck.title || "Unknown Title",
            author: downloadCheck.author,
            sourceUrl: resolvedUrl,
            finishedAt: Date.now(),
            status: "deleted",
            downloadedAt: downloadCheck.downloadedAt,
            deletedAt: downloadCheck.deletedAt,
          });

          return res.status(200).json({
            success: true,
            skipped: true,
            previouslyDeleted: true,
            title: downloadCheck.title,
            author: downloadCheck.author,
            downloadedAt: downloadCheck.downloadedAt,
            deletedAt: downloadCheck.deletedAt,
            message:
              "Video was previously downloaded but deleted, skipped download",
          });
        }
      }
    }

    // Determine initial title for the download task
    let initialTitle = "Video";
    try {
      // Resolve shortened URLs (like b23.tv) first to get correct info
      if (videoUrl.includes("b23.tv")) {
        videoUrl = await resolveShortUrl(videoUrl);
        logger.info("Resolved shortened URL to:", videoUrl);
      }

      // Try to fetch video info for all URLs
      logger.info("Fetching video info for title...");
      const info = await downloadService.getVideoInfo(videoUrl);
      if (info && info.title) {
        initialTitle = info.title;
        logger.info("Fetched initial title:", initialTitle);
      }
    } catch (err) {
      logger.warn("Failed to fetch video info for title, using default:", err);
      if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
        initialTitle = "YouTube Video";
      } else if (isBilibiliUrl(videoUrl)) {
        initialTitle = "Bilibili Video";
      }
    }

    // Generate a unique ID for this download task
    const downloadId = Date.now().toString();

    // Define the download task function
    const downloadTask = async (
      registerCancel: (cancel: () => void) => void
    ) => {
      // Trim Bilibili URL if needed
      if (isBilibiliUrl(videoUrl)) {
        videoUrl = trimBilibiliUrl(videoUrl);
        logger.info("Using trimmed Bilibili URL:", videoUrl);

        // If downloadCollection is true, handle collection/series download
        if (downloadCollection && collectionInfo) {
          logger.info("Downloading Bilibili collection/series");

          const result = await downloadService.downloadBilibiliCollection(
            collectionInfo,
            collectionName,
            downloadId
          );

          if (result.success) {
            return {
              success: true,
              collectionId: result.collectionId,
              videosDownloaded: result.videosDownloaded,
              isCollection: true,
            };
          } else {
            throw new Error(
              result.error || "Failed to download collection/series"
            );
          }
        }

        // If downloadAllParts is true, handle multi-part download
        if (downloadAllParts) {
          const videoId = extractBilibiliVideoId(videoUrl);
          if (!videoId) {
            throw new Error("Could not extract Bilibili video ID");
          }

          // Get video info to determine number of parts
          const partsInfo = await downloadService.checkBilibiliVideoParts(
            videoId
          );

          if (!partsInfo.success) {
            throw new Error("Failed to get video parts information");
          }

          const { videosNumber, title } = partsInfo;

          // Update title in storage
          storageService.addActiveDownload(
            downloadId,
            title || "Bilibili Video"
          );

          // Create a collection for the multi-part video if collectionName is provided
          let collectionId: string | null = null;
          if (collectionName) {
            const newCollection = {
              id: Date.now().toString(),
              name: collectionName,
              videos: [],
              createdAt: new Date().toISOString(),
              title: collectionName,
            };
            storageService.saveCollection(newCollection);
            collectionId = newCollection.id;
          }

          // Start downloading the first part
          const baseUrl = videoUrl.split("?")[0];
          const firstPartUrl = `${baseUrl}?p=1`;

          // Download the first part
          const firstPartResult =
            await downloadService.downloadSingleBilibiliPart(
              firstPartUrl,
              1,
              videosNumber,
              title || "Bilibili Video",
              downloadId,
              registerCancel
            );

          // Add to collection if needed
          if (collectionId && firstPartResult.videoData) {
            storageService.atomicUpdateCollection(
              collectionId,
              (collection) => {
                collection.videos.push(firstPartResult.videoData!.id);
                return collection;
              }
            );
          }

          // Set up background download for remaining parts
          // Note: We don't await this, it runs in background
          if (videosNumber > 1) {
            downloadService.downloadRemainingBilibiliParts(
              baseUrl,
              2,
              videosNumber,
              title || "Bilibili Video",
              collectionId!,
              downloadId // Pass downloadId to track progress
            );
          }

          return {
            success: true,
            video: firstPartResult.videoData,
            isMultiPart: true,
            totalParts: videosNumber,
            collectionId,
          };
        } else {
          // Regular single video download for Bilibili
          logger.info("Downloading single Bilibili video part");

          const result = await downloadService.downloadSingleBilibiliPart(
            videoUrl,
            1,
            1,
            "", // seriesTitle not used when totalParts is 1
            downloadId,
            registerCancel
          );

          if (result.success) {
            return { success: true, video: result.videoData };
          } else {
            throw new Error(
              result.error || "Failed to download Bilibili video"
            );
          }
        }
      } else if (videoUrl.includes("missav") || videoUrl.includes("123av")) {
        // MissAV/123av download
        const videoData = await downloadService.downloadMissAVVideo(
          videoUrl,
          downloadId,
          registerCancel
        );
        return { success: true, video: videoData };
      } else {
        // YouTube download
        const videoData = await downloadService.downloadYouTubeVideo(
          videoUrl,
          downloadId,
          registerCancel
        );
        return { success: true, video: videoData };
      }
    };

    // Determine type
    let type = "youtube";
    if (videoUrl.includes("missav") || videoUrl.includes("123av")) {
      type = "missav";
    } else if (isBilibiliUrl(videoUrl)) {
      type = "bilibili";
    }

    // Add to download manager
    downloadManager
      .addDownload(downloadTask, downloadId, initialTitle, videoUrl, type)
      .then((result: any) => {
        logger.info("Download completed successfully:", result);
      })
      .catch((error: any) => {
        logger.error("Download failed:", error);
      });

    // Return success immediately indicating the download is queued/started
    res.status(200).json({
      success: true,
      message: "Download queued",
      downloadId,
    });
  } catch (error: any) {
    logger.error("Error queuing download:", error);
    res
      .status(500)
      .json({ error: "Failed to queue download", details: error.message });
  }
};

/**
 * Get all videos
 * Errors are automatically handled by asyncHandler middleware
 */
export const getVideos = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const videos = storageService.getVideos();
  res.status(200).json(successResponse(videos));
};

/**
 * Get video by ID
 * Errors are automatically handled by asyncHandler middleware
 */
export const getVideoById = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const video = storageService.getVideoById(id);

  if (!video) {
    throw new NotFoundError("Video", id);
  }

  res.status(200).json(successResponse(video));
};

/**
 * Delete video
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteVideo = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const success = storageService.deleteVideo(id);

  if (!success) {
    throw new NotFoundError("Video", id);
  }

  res.status(200).json(successResponse(null, "Video deleted successfully"));
};

/**
 * Get download status
 * Errors are automatically handled by asyncHandler middleware
 */
export const getDownloadStatus = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const status = storageService.getDownloadStatus();
  // Debug log to verify progress data is included
  if (status.activeDownloads.length > 0) {
    status.activeDownloads.forEach((d) => {
      if (d.progress !== undefined || d.speed) {
        logger.debug(
          `[API] Download ${d.id}: progress=${d.progress}%, speed=${d.speed}, totalSize=${d.totalSize}`
        );
      }
    });
  }
  res.status(200).json(successResponse(status));
};

/**
 * Check Bilibili parts
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkBilibiliParts = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url } = req.query;

  if (!url) {
    throw new ValidationError("URL is required", "url");
  }

  if (!isBilibiliUrl(url as string)) {
    throw new ValidationError("Not a valid Bilibili URL", "url");
  }

  // Resolve shortened URLs (like b23.tv)
  let videoUrl = url as string;
  if (videoUrl.includes("b23.tv")) {
    videoUrl = await resolveShortUrl(videoUrl);
    logger.info("Resolved shortened URL to:", videoUrl);
  }

  // Trim Bilibili URL if needed
  videoUrl = trimBilibiliUrl(videoUrl);

  // Extract video ID
  const videoId = extractBilibiliVideoId(videoUrl);

  if (!videoId) {
    throw new ValidationError("Could not extract Bilibili video ID", "url");
  }

  const result = await downloadService.checkBilibiliVideoParts(videoId);

  res.status(200).json(successResponse(result));
};

/**
 * Check if Bilibili URL is a collection or series
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkBilibiliCollection = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url } = req.query;

  if (!url) {
    throw new ValidationError("URL is required", "url");
  }

  if (!isBilibiliUrl(url as string)) {
    throw new ValidationError("Not a valid Bilibili URL", "url");
  }

  // Resolve shortened URLs (like b23.tv)
  let videoUrl = url as string;
  if (videoUrl.includes("b23.tv")) {
    videoUrl = await resolveShortUrl(videoUrl);
    logger.info("Resolved shortened URL to:", videoUrl);
  }

  // Trim Bilibili URL if needed
  videoUrl = trimBilibiliUrl(videoUrl);

  // Extract video ID
  const videoId = extractBilibiliVideoId(videoUrl);

  if (!videoId) {
    throw new ValidationError("Could not extract Bilibili video ID", "url");
  }

  // Check if it's a collection or series
  const result = await downloadService.checkBilibiliCollectionOrSeries(videoId);

  res.status(200).json(successResponse(result));
};

/**
 * Get video comments
 * Errors are automatically handled by asyncHandler middleware
 */
export const getVideoComments = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const comments = await import("../services/commentService").then((m) =>
    m.getComments(id)
  );
  res.status(200).json(successResponse(comments));
};

/**
 * Upload video
 * Errors are automatically handled by asyncHandler middleware
 */
export const uploadVideo = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!req.file) {
    throw new ValidationError("No video file uploaded", "file");
  }

  const { title, author } = req.body;
  const videoId = Date.now().toString();
  const videoFilename = req.file.filename;
  const thumbnailFilename = `${path.parse(videoFilename).name}.jpg`;

  const videoPath = path.join(VIDEOS_DIR, videoFilename);
  const thumbnailPath = path.join(IMAGES_DIR, thumbnailFilename);

  // Generate thumbnail
  await new Promise<void>((resolve, _reject) => {
    exec(
      `ffmpeg -i "${videoPath}" -ss 00:00:00 -vframes 1 "${thumbnailPath}"`,
      (error) => {
        if (error) {
          logger.error("Error generating thumbnail:", error);
          // We resolve anyway to not block the upload, just without a custom thumbnail
          resolve();
        } else {
          resolve();
        }
      }
    );
  });

  // Get video duration
  const duration = await getVideoDuration(videoPath);

  // Get file size
  let fileSize: string | undefined;
  try {
    if (fs.existsSync(videoPath)) {
      const stats = fs.statSync(videoPath);
      fileSize = stats.size.toString();
    }
  } catch (e) {
    logger.error("Failed to get file size:", e);
  }

  const newVideo = {
    id: videoId,
    title: title || req.file.originalname,
    author: author || "Admin",
    source: "local",
    sourceUrl: "", // No source URL for uploaded videos
    videoFilename: videoFilename,
    thumbnailFilename: fs.existsSync(thumbnailPath)
      ? thumbnailFilename
      : undefined,
    videoPath: `/videos/${videoFilename}`,
    thumbnailPath: fs.existsSync(thumbnailPath)
      ? `/images/${thumbnailFilename}`
      : undefined,
    thumbnailUrl: fs.existsSync(thumbnailPath)
      ? `/images/${thumbnailFilename}`
      : undefined,
    duration: duration ? duration.toString() : undefined,
    fileSize: fileSize,
    createdAt: new Date().toISOString(),
    date: new Date().toISOString().split("T")[0].replace(/-/g, ""),
    addedAt: new Date().toISOString(),
  };

  storageService.saveVideo(newVideo);

  res
    .status(201)
    .json(successResponse({ video: newVideo }, "Video uploaded successfully"));
};

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

  res
    .status(200)
    .json(successResponse({ video: updatedVideo }, "Video rated successfully"));
};

/**
 * Update video details
 * Errors are automatically handled by asyncHandler middleware
 */
export const updateVideoDetails = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const updates = req.body;

  // Filter allowed updates
  const allowedUpdates: any = {};
  if (updates.title !== undefined) allowedUpdates.title = updates.title;
  if (updates.tags !== undefined) allowedUpdates.tags = updates.tags;
  // Add other allowed fields here if needed in the future

  if (Object.keys(allowedUpdates).length === 0) {
    throw new ValidationError("No valid updates provided", "body");
  }

  const updatedVideo = storageService.updateVideo(id, allowedUpdates);

  if (!updatedVideo) {
    throw new NotFoundError("Video", id);
  }

  res
    .status(200)
    .json(
      successResponse({ video: updatedVideo }, "Video updated successfully")
    );
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

  if (!fs.existsSync(videoFilePath)) {
    throw new NotFoundError("Video file", videoFilePath);
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
  fs.ensureDirSync(path.dirname(thumbnailAbsolutePath));

  // Generate thumbnail
  await new Promise<void>((resolve, reject) => {
    // -y to overwrite existing file
    exec(
      `ffmpeg -i "${videoFilePath}" -ss 00:00:00 -vframes 1 "${thumbnailAbsolutePath}" -y`,
      (error) => {
        if (error) {
          logger.error("Error generating thumbnail:", error);
          reject(error);
        } else {
          resolve();
        }
      }
    );
  });

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

  res
    .status(200)
    .json(
      successResponse({ thumbnailUrl }, "Thumbnail refreshed successfully")
    );
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

  res.status(200).json(
    successResponse({
      viewCount: updatedVideo?.viewCount,
    })
  );
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
