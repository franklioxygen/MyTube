import { Request, Response } from "express";
import fs from "fs-extra";
import multer from "multer";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { getVideoDuration } from "../services/metadataService";
import * as storageService from "../services/storageService";
import { logger } from "../utils/logger";
import { sendData, sendSuccess, successResponse } from "../utils/response";
import {
    execFileSafe,
    validateImagePath,
    validateVideoPath,
} from "../utils/security";

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

// Configure multer with large file size limit (100GB)
export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 * 1024, // 10GB in bytes
  },
});

/**
 * Get all videos
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns array directly for backward compatibility with frontend
 */
export const getVideos = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const videos = storageService.getVideos();
  // Return array directly for backward compatibility (frontend expects response.data to be Video[])
  sendData(res, videos);
};

/**
 * Get video by ID
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns video object directly for backward compatibility with frontend
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

  // Return video object directly for backward compatibility (frontend expects response.data to be Video)
  sendData(res, video);
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

  sendSuccess(res, null, "Video deleted successfully");
};

/**
 * Get video comments
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns comments array directly for backward compatibility with frontend
 */
export const getVideoComments = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const comments = await import("../services/commentService").then((m) =>
    m.getComments(id)
  );
  // Return comments array directly for backward compatibility (frontend expects response.data to be Comment[])
  sendData(res, comments);
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

  // Validate paths to prevent path traversal
  const validatedVideoPath = validateVideoPath(videoPath);
  const validatedThumbnailPath = validateImagePath(thumbnailPath);

  // Generate thumbnail using execFileSafe to prevent command injection
  try {
    await execFileSafe("ffmpeg", [
      "-i",
      validatedVideoPath,
      "-ss",
      "00:00:00",
      "-vframes",
      "1",
      validatedThumbnailPath,
    ]);
  } catch (error) {
    logger.error("Error generating thumbnail:", error);
    // Continue without thumbnail - don't block the upload
  }

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
  if (updates.visibility !== undefined) allowedUpdates.visibility = updates.visibility;
  // Add other allowed fields here if needed in the future

  if (Object.keys(allowedUpdates).length === 0) {
    throw new ValidationError("No valid updates provided", "body");
  }

  const updatedVideo = storageService.updateVideo(id, allowedUpdates);

  if (!updatedVideo) {
    throw new NotFoundError("Video", id);
  }

  // Return format expected by frontend: { success: true, video: ... }
  sendData(res, {
    success: true,
    video: updatedVideo,
  });
};

/**
 * Get author channel URL for a video
 * Errors are automatically handled by asyncHandler middleware
 */
export const getAuthorChannelUrl = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { sourceUrl } = req.query;

  if (!sourceUrl || typeof sourceUrl !== "string") {
    throw new ValidationError("sourceUrl is required", "sourceUrl");
  }

  try {
    // First, check if we have the video in the database with a stored channelUrl
    const existingVideo = storageService.getVideoBySourceUrl(sourceUrl);
    if (existingVideo && existingVideo.channelUrl) {
      res
        .status(200)
        .json({ success: true, channelUrl: existingVideo.channelUrl });
      return;
    }

    // If not in database, fetch it (for YouTube)
    if (sourceUrl.includes("youtube.com") || sourceUrl.includes("youtu.be")) {
      const {
        executeYtDlpJson,
        getNetworkConfigFromUserConfig,
        getUserYtDlpConfig,
      } = await import("../utils/ytDlpUtils");
      const userConfig = getUserYtDlpConfig(sourceUrl);
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);

      const info = await executeYtDlpJson(sourceUrl, {
        ...networkConfig,
        noWarnings: true,
      });

      const channelUrl = info.channel_url || info.uploader_url || null;
      if (channelUrl) {
        // If we have the video in database, update it with the channelUrl
        if (existingVideo) {
          storageService.updateVideo(existingVideo.id, { channelUrl });
        }
        sendData(res, { success: true, channelUrl });
        return;
      }
    }

    // Check if it's a Bilibili URL
    if (sourceUrl.includes("bilibili.com") || sourceUrl.includes("b23.tv")) {
      // If we have the video in database, try to get channelUrl from there first
      // (already checked above, but this is for clarity)
      if (existingVideo && existingVideo.channelUrl) {
        sendData(res, { success: true, channelUrl: existingVideo.channelUrl });
        return;
      }

      const axios = (await import("axios")).default;
      const { extractBilibiliVideoId } = await import("../utils/helpers");

      const videoId = extractBilibiliVideoId(sourceUrl);
      if (videoId) {
        try {
          // Handle both BV and av IDs
          const isBvId = videoId.startsWith("BV");
          const apiUrl = isBvId
            ? `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`
            : `https://api.bilibili.com/x/web-interface/view?aid=${videoId.replace(
                "av",
                ""
              )}`;

          const response = await axios.get(apiUrl, {
            headers: {
              Referer: "https://www.bilibili.com",
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            },
          });

          if (
            response.data &&
            response.data.data &&
            response.data.data.owner?.mid
          ) {
            const mid = response.data.data.owner.mid;
            const spaceUrl = `https://space.bilibili.com/${mid}`;

            // If we have the video in database, update it with the channelUrl
            if (existingVideo) {
              storageService.updateVideo(existingVideo.id, {
                channelUrl: spaceUrl,
              });
            }

            sendData(res, { success: true, channelUrl: spaceUrl });
            return;
          }
        } catch (error) {
          logger.error("Error fetching Bilibili video info:", error);
        }
      }
    }

    // If we couldn't get the channel URL, return null
    sendData(res, { success: true, channelUrl: null });
  } catch (error) {
    logger.error("Error getting author channel URL:", error);
    sendData(res, { success: true, channelUrl: null });
  }
};
