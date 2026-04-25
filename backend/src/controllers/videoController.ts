import { Request, Response } from "express";
import path from "path";
import { VIDEOS_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import * as storageService from "../services/storageService";
import { twitchApiService } from "../services/twitchService";
import {
  extractTwitchVideoId,
  isBilibiliUrl,
  isTwitchChannelUrl,
  isTwitchVideoUrl,
  isYouTubeUrl,
  normalizeTwitchChannelUrl,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import { successResponse } from "../utils/response";
import { resolvePlayableVideoFilePath } from "../utils/videoFileResolver";
export {
  upload,
  uploadBatch,
  uploadVideo,
  uploadVideosBatch,
  videoBatchUploadStorage,
  videoUploadStorage,
} from "./video/uploadController";
export { uploadSubtitle, uploadSubtitleMiddleware } from "./video/subtitleController";
import {
  pathExistsTrustedSync,
  normalizeSafeAbsolutePath,
  resolveSafePath,
  statTrustedSync,
} from "../utils/security";

// Helper responses
const sendData = (res: Response, data: any) => {
  res.status(200).json(data);
};

const sendSuccess = (res: Response, data: any, message: string) => {
  res.status(200).json(successResponse(data, message));
};

const resolveVideoWebPath = (absoluteVideoPath: string): string | null => {
  const videosRoot = path.resolve(VIDEOS_DIR);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const normalizedPath = path.resolve(absoluteVideoPath);

  if (
    normalizedPath !== videosRoot &&
    !normalizedPath.startsWith(`${videosRoot}${path.sep}`)
  ) {
    return null;
  }

  const relativePath = path.relative(videosRoot, normalizedPath);
  if (!relativePath || relativePath.startsWith("..")) {
    return null;
  }

  return `/videos/${relativePath.split(path.sep).join("/")}`;
};

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

  // Self-heal local paths that point to a missing merged file.
  // If yt-dlp produced split artifacts (e.g. *.f137.mp4), use a playable fallback.
  if (video.videoPath?.startsWith("/videos/")) {
    const relativeVideoPath = video.videoPath.replace(/^\/videos\//, "");
    const expectedVideoPath = path.resolve(
      path.join(VIDEOS_DIR, ...relativeVideoPath.split("/"))
    );
    const resolvedVideoPath = resolvePlayableVideoFilePath(expectedVideoPath);

    if (
      resolvedVideoPath &&
      path.normalize(resolvedVideoPath) !== path.normalize(expectedVideoPath)
    ) {
      const resolvedVideoWebPath = resolveVideoWebPath(resolvedVideoPath);
      const resolvedVideoFilename = path.basename(resolvedVideoPath);

      if (resolvedVideoWebPath) {
        video.videoPath = resolvedVideoWebPath;
        video.videoFilename = resolvedVideoFilename;
        try {
          storageService.updateVideo(video.id, {
            videoPath: resolvedVideoWebPath,
            videoFilename: resolvedVideoFilename,
          });
        } catch (error) {
          logger.error(
            `Failed to persist repaired video path for ${video.id}`,
            error
          );
        }

        logger.warn(
          `Video file repaired for ${video.id}: ${expectedVideoPath} -> ${resolvedVideoPath}`
        );
      }
    }
  }

  // Check if video is in cloud storage and inject signed URLs
  if (video.videoPath?.startsWith("cloud:")) {
    const { CloudStorageService } = await import(
      "../services/CloudStorageService"
    );

    // Helper to extract cloud filename
    const extractCloudFilename = (path: string) => {
      return path.startsWith("cloud:") ? path.substring(6) : path;
    };

    const videoFilename = extractCloudFilename(video.videoPath);
    const signedUrl = await CloudStorageService.getSignedUrl(
      videoFilename,
      "video"
    );

    if (signedUrl) {
      (video as any).signedUrl = signedUrl;
    }

    if (video.thumbnailPath?.startsWith("cloud:")) {
      const thumbnailFilename = extractCloudFilename(video.thumbnailPath);
      const signedThumbnailUrl = await CloudStorageService.getSignedUrl(
        thumbnailFilename,
        "thumbnail"
      );

      if (signedThumbnailUrl) {
        (video as any).signedThumbnailUrl = signedThumbnailUrl;
      }
    }
  }

  // Check if video is in mount directory and inject mount video URL
  if (video.videoPath?.startsWith("mount:")) {
    // For mount directory videos, provide a special URL that will be served by the mount video endpoint
    (video as any).signedUrl = `/api/mount-video/${id}`;
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
  if (updates.visibility !== undefined)
    allowedUpdates.visibility = updates.visibility;
  if (updates.subtitles !== undefined)
    allowedUpdates.subtitles = updates.subtitles;
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

type ExistingVideoRecord = { id: string; channelUrl?: string };

const BILIBILI_REQUEST_HEADERS = {
  Referer: "https://www.bilibili.com",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

const VIDEO_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".flv": "video/x-flv",
  ".3gp": "video/3gpp",
};

const getExistingVideoBySourceUrl = (sourceUrl: string): ExistingVideoRecord | null =>
  (storageService.getVideoBySourceUrl(sourceUrl) as ExistingVideoRecord | null);

const persistChannelUrlForVideo = (
  existingVideo: ExistingVideoRecord | null,
  channelUrl: string
): void => {
  if (!existingVideo) {
    return;
  }
  storageService.updateVideo(existingVideo.id, { channelUrl });
};

const getBilibiliApiUrl = (videoId: string): string => {
  if (videoId.startsWith("BV")) {
    return `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
  }
  return `https://api.bilibili.com/x/web-interface/view?aid=${videoId.replace(
    "av",
    ""
  )}`;
};

const fetchYouTubeChannelUrl = async (sourceUrl: string): Promise<string | null> => {
  if (!isYouTubeUrl(sourceUrl)) {
    return null;
  }

  const { executeYtDlpJson, getNetworkConfigFromUserConfig, getUserYtDlpConfig } =
    await import("../utils/ytDlpUtils");
  const userConfig = getUserYtDlpConfig(sourceUrl);
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);
  const info = await executeYtDlpJson(sourceUrl, {
    ...networkConfig,
    noWarnings: true,
  });

  return info.channel_url || info.uploader_url || null;
};

const fetchBilibiliChannelUrl = async (
  sourceUrl: string
): Promise<string | null> => {
  if (!isBilibiliUrl(sourceUrl)) {
    return null;
  }

  const { extractBilibiliVideoId } = await import("../utils/helpers");
  const videoId = extractBilibiliVideoId(sourceUrl);
  if (!videoId) {
    return null;
  }

  try {
    const axios = (await import("axios")).default;
    const response = await axios.get(getBilibiliApiUrl(videoId), {
      headers: BILIBILI_REQUEST_HEADERS,
    });

    const ownerMid = response?.data?.data?.owner?.mid;
    if (!ownerMid) {
      return null;
    }
    return `https://space.bilibili.com/${ownerMid}`;
  } catch (error) {
    logger.error("Error fetching Bilibili video info:", error);
    return null;
  }
};

const fetchTwitchChannelUrl = async (
  sourceUrl: string
): Promise<string | null> => {
  if (isTwitchChannelUrl(sourceUrl)) {
    return normalizeTwitchChannelUrl(sourceUrl);
  }

  if (!isTwitchVideoUrl(sourceUrl)) {
    return null;
  }

  const twitchVideoId = extractTwitchVideoId(sourceUrl);
  if (!twitchVideoId) {
    return null;
  }

  try {
    const twitchVideo = await twitchApiService.getVideoById(twitchVideoId);
    if (twitchVideo) {
      return `https://www.twitch.tv/${twitchVideo.userLogin}`;
    }
  } catch (error) {
    logger.error("Error fetching Twitch video info:", error);
  }

  const {
    getChannelUrlFromVideo,
    getNetworkConfigFromUserConfig,
    getUserYtDlpConfig,
  } = await import("../utils/ytDlpUtils");
  const userConfig = getUserYtDlpConfig(sourceUrl);
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);
  return getChannelUrlFromVideo(sourceUrl, networkConfig);
};

const resolveChannelUrl = async (sourceUrl: string): Promise<string | null> => {
  const youtubeChannelUrl = await fetchYouTubeChannelUrl(sourceUrl);
  if (youtubeChannelUrl) {
    return youtubeChannelUrl;
  }
  const bilibiliChannelUrl = await fetchBilibiliChannelUrl(sourceUrl);
  if (bilibiliChannelUrl) {
    return bilibiliChannelUrl;
  }
  return fetchTwitchChannelUrl(sourceUrl);
};

const isMountVideoPath = (videoPath: string | undefined): boolean =>
  typeof videoPath === "string" && videoPath.startsWith("mount:");

const validateRawMountFilePath = (rawFilePath: string): void => {
  if (!rawFilePath) {
    throw new ValidationError("Invalid file path: empty or invalid", "videoPath");
  }
  if (rawFilePath.includes("..") || rawFilePath.includes("\0")) {
    throw new ValidationError(
      "Invalid file path: path traversal detected",
      "videoPath"
    );
  }
  if (!path.isAbsolute(rawFilePath)) {
    throw new ValidationError("Invalid file path: must be absolute", "videoPath");
  }
};

const resolveMountFilePath = (rawFilePath: string): string => {
  validateRawMountFilePath(rawFilePath);
  const filePath = normalizeSafeAbsolutePath(rawFilePath);
  validateRawMountFilePath(filePath);
  return filePath;
};

const assertMountFileExists = (filePath: string): void => {
  if (!pathExistsTrustedSync(filePath)) {
    throw new NotFoundError("Video file", filePath);
  }
  if (!statTrustedSync(filePath).isFile()) {
    throw new ValidationError("Path is not a file", "videoPath");
  }
};

const getVideoContentType = (filePath: string): string =>
  VIDEO_CONTENT_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()] ||
  "video/mp4";

const setMountVideoHeaders = (res: Response, filePath: string): void => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Range, Content-Length"
  );
  res.setHeader("Content-Type", getVideoContentType(filePath));
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
    const existingVideo = getExistingVideoBySourceUrl(sourceUrl);
    if (existingVideo?.channelUrl) {
      sendData(res, { success: true, channelUrl: existingVideo.channelUrl });
      return;
    }

    const channelUrl = await resolveChannelUrl(sourceUrl);
    if (channelUrl) {
      persistChannelUrlForVideo(existingVideo, channelUrl);
      sendData(res, { success: true, channelUrl });
      return;
    }

    sendData(res, { success: true, channelUrl: null });
  } catch (error) {
    logger.error("Error getting author channel URL:", error);
    sendData(res, { success: true, channelUrl: null });
  }
};

/**
 * Serve mount directory video file
 * Errors are automatically handled by asyncHandler middleware
 */
export const serveMountVideo = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const video = storageService.getVideoById(id);

  if (!video) {
    throw new NotFoundError("Video", id);
  }

  const mountVideoPath = video.videoPath ?? undefined;

  if (!isMountVideoPath(mountVideoPath)) {
    throw new NotFoundError("Video", id);
  }

  const rawFilePath = mountVideoPath.substring(6);
  const filePath = resolveMountFilePath(rawFilePath);
  assertMountFileExists(filePath);
  setMountVideoHeaders(res, filePath);
  res.sendFile(path.basename(filePath), { root: path.dirname(filePath) });
};
