/// <reference path="../types/ass-to-vtt.d.ts" />
import crypto from "crypto";
import { Request, Response } from "express";
import fs from "fs-extra";
import multer from "multer";
import path from "path";
import sanitizeFilename from "sanitize-filename";
import { SUBTITLES_DIR, VIDEOS_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import * as storageService from "../services/storageService";
import {
  deleteSmallThumbnailMirrorSync,
  regenerateSmallThumbnailForThumbnailPath,
  resolveManagedThumbnailTarget,
} from "../services/thumbnailMirrorService";
import { isBilibiliUrl, isYouTubeUrl } from "../utils/helpers";
import { logger } from "../utils/logger";
import { successResponse } from "../utils/response";
import {
  createUploadValidationError,
  createVideoUploadStorage,
  getUploadVideoId,
  UploadedVideoFile,
} from "../utils/videoUpload";
import { resolvePlayableVideoFilePath } from "../utils/videoFileResolver";
import {
  resolveSafePath,
  sanitizePathSegment,
} from "../utils/security";

const MAX_VIDEO_UPLOAD_FILE_SIZE = 100 * 1024 * 1024 * 1024;
const MAX_BATCH_UPLOAD_FILES = 100;
const MAX_BATCH_UPLOAD_TOTAL_SIZE = MAX_VIDEO_UPLOAD_FILE_SIZE;
const MAX_SINGLE_UPLOAD_FIELDS = 4;
const MAX_BATCH_UPLOAD_FIELDS = MAX_BATCH_UPLOAD_FILES + 4;

export const videoUploadStorage = createVideoUploadStorage(VIDEOS_DIR);
export const videoBatchUploadStorage = createVideoUploadStorage(VIDEOS_DIR, {
  maxTotalBytes: MAX_BATCH_UPLOAD_TOTAL_SIZE,
});

const videoUploadOptions: multer.Options = {
  storage: videoUploadStorage,
  limits: {
    fileSize: MAX_VIDEO_UPLOAD_FILE_SIZE,
    files: 1,
    fields: MAX_SINGLE_UPLOAD_FIELDS,
    parts: 1 + MAX_SINGLE_UPLOAD_FIELDS,
  },
};

const videoBatchUploadOptions: multer.Options = {
  storage: videoBatchUploadStorage,
  limits: {
    fileSize: MAX_VIDEO_UPLOAD_FILE_SIZE,
    files: MAX_BATCH_UPLOAD_FILES,
    fields: MAX_BATCH_UPLOAD_FIELDS,
    parts: MAX_BATCH_UPLOAD_FILES + MAX_BATCH_UPLOAD_FIELDS,
  },
};

export const upload = multer(videoUploadOptions);
export const uploadBatch = multer(videoBatchUploadOptions);

export const uploadSubtitleMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.match(/\.(vtt|srt|ass|ssa)$/i)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only .vtt, .srt, .ass and .ssa are allowed."
        )
      );
    }
  },
});

// Helper to safely execute files (prevent command injection)
const execFileSafe = async (
  file: string,
  args: string[],
  options: any = {}
): Promise<void> => {
  const { execFile } = await import("child_process");
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, _stdout, stderr) => {
      if (error) {
        logger.error(`execFile error: ${error.message}`);
        logger.error(`stderr: ${stderr}`);
        reject(error);
        return;
      }
      resolve();
    });
  });
};

// Helper validate paths functions
const validateVideoPath = (inputPath: string): string => {
  try {
    return resolveSafePath(inputPath, VIDEOS_DIR);
  } catch {
    throw new ValidationError("Invalid video path", "path");
  }
};

const getStoredUploadFilename = (
  file: Pick<UploadedVideoFile, "filename">,
): string | undefined => {
  if (typeof file.filename !== "string" || file.filename.length === 0) {
    return undefined;
  }

  const safeFilename = sanitizeFilename(file.filename);
  if (!safeFilename || safeFilename !== file.filename) {
    return undefined;
  }

  return safeFilename;
};

// Helper for video duration
const getVideoDuration = async (
  videoPath: string
): Promise<number | undefined> => {
  try {
    const { execFile } = await import("child_process");
    return new Promise((resolve) => {
      execFile(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          videoPath,
        ],
        (error, stdout) => {
          if (error) {
            logger.error("ffprobe error:", error);
            resolve(undefined);
            return;
          }
          const duration = parseFloat(stdout);
          resolve(isNaN(duration) ? undefined : duration);
        }
      );
    });
  } catch (err) {
    logger.error("Failed to get video duration:", err);
    return undefined;
  }
};

const uploadedFileHasVideoStream = async (videoPath: string): Promise<boolean> => {
  try {
    const { execFile } = await import("child_process");
    return new Promise((resolve) => {
      execFile(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          videoPath,
        ],
        (error, stdout) => {
          if (error) {
            logger.error("ffprobe stream validation error:", error);
            resolve(false);
            return;
          }

          const streamTypes = stdout
            .split(/\r?\n/)
            .map((line) => line.trim().toLowerCase())
            .filter(Boolean);
          resolve(streamTypes.includes("video"));
        }
      );
    });
  } catch (err) {
    logger.error("Failed to validate uploaded video stream:", err);
    return false;
  }
};

const cleanupUploadedVideo = (
  file: Pick<UploadedVideoFile, "filename"> | undefined,
): void => {
  const storedVideoFilename = file ? getStoredUploadFilename(file) : undefined;
  if (!storedVideoFilename) {
    return;
  }

  try {
    const storedVideoPath = path.join(VIDEOS_DIR, storedVideoFilename);
    if (fs.existsSync(storedVideoPath)) {
      fs.unlinkSync(storedVideoPath);
    }
  } catch (error) {
    logger.error("Failed to clean up uploaded video:", error);
  }
};

const cleanupGeneratedThumbnail = (thumbnailPath: string | undefined): void => {
  if (!thumbnailPath) {
    return;
  }

  try {
    if (fs.existsSync(thumbnailPath)) {
      fs.unlinkSync(thumbnailPath);
    }
    deleteSmallThumbnailMirrorSync(thumbnailPath);
  } catch (error) {
    logger.error("Failed to clean up generated thumbnail:", error);
  }
};

type UploadStatus = "uploaded" | "duplicate" | "failed";

interface UploadResultItem {
  originalName: string;
  status: UploadStatus;
  message: string;
  video?: import("../services/storageService").Video;
}

interface UploadSummary {
  total: number;
  uploaded: number;
  duplicates: number;
  failed: number;
}

const getUploadSummary = (results: UploadResultItem[]): UploadSummary =>
  results.reduce(
    (summary, result) => {
      summary.total += 1;
      if (result.status === "uploaded") {
        summary.uploaded += 1;
      } else if (result.status === "duplicate") {
        summary.duplicates += 1;
      } else {
        summary.failed += 1;
      }
      return summary;
    },
    { total: 0, uploaded: 0, duplicates: 0, failed: 0 }
  );

const getDefaultUploadTitle = (originalName: string): string =>
  path.basename(originalName).replace(/\.[^/.]+$/, "");

const readStringField = (
  value: unknown,
  fallback: string = ""
): string => {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }
  if (Array.isArray(value)) {
    const firstString = value.find(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
    );
    return firstString?.trim() || fallback;
  }
  return fallback;
};

const buildUploadResponseMessage = (summary: UploadSummary): string => {
  if (summary.failed === 0 && summary.duplicates === 0) {
    return `Uploaded ${summary.uploaded} video${summary.uploaded === 1 ? "" : "s"} successfully.`;
  }

  return `Upload finished. Uploaded: ${summary.uploaded}, duplicates skipped: ${summary.duplicates}, failed: ${summary.failed}.`;
};

const buildUploadFailureResult = (
  file: Pick<UploadedVideoFile, "originalname">,
  message: string
): UploadResultItem => ({
  originalName: path.basename(file.originalname),
  status: "failed",
  message,
});

const buildUploadDuplicateResult = (
  file: Pick<UploadedVideoFile, "originalname">,
  video: import("../services/storageService").Video
): UploadResultItem => ({
  originalName: path.basename(file.originalname),
  status: "duplicate",
  message: "Video already exists. Skipped duplicate upload",
  video,
});

const buildUploadSuccessResult = (
  file: Pick<UploadedVideoFile, "originalname">,
  video: import("../services/storageService").Video,
  status: Exclude<UploadStatus, "failed"> = "uploaded"
): UploadResultItem => ({
  originalName: path.basename(file.originalname),
  status,
  message:
    status === "uploaded"
      ? "Video uploaded successfully"
      : "Video already exists. Skipped duplicate upload",
  video,
});

const getUploadedFilesFromRequest = (req: Request): UploadedVideoFile[] => {
  if (Array.isArray(req.files)) {
    return req.files as UploadedVideoFile[];
  }

  if (req.file) {
    return [req.file as UploadedVideoFile];
  }

  const filesByField = req.files as Record<string, Express.Multer.File[]> | undefined;
  if (!filesByField) {
    return [];
  }

  return Object.values(filesByField).flat() as UploadedVideoFile[];
};

const getUploadVideoPayload = async (
  file: UploadedVideoFile,
  title: string,
  author: string
): Promise<UploadResultItem> => {
  const storedVideoFilename = getStoredUploadFilename(file);

  if (file.validationError) {
    cleanupUploadedVideo(file);
    return buildUploadFailureResult(file, file.validationError);
  }

  if (!storedVideoFilename) {
    return buildUploadFailureResult(file, "No video file uploaded");
  }

  const rawVideoPath = path.join(VIDEOS_DIR, storedVideoFilename);
  const validatedVideoPath = validateVideoPath(rawVideoPath);
  const contentHash = file.contentHash;
  const videoId =
    typeof contentHash === "string" && contentHash.length > 0
      ? getUploadVideoId(contentHash)
      : crypto.randomUUID();
  const existingVideo = storageService.getVideoById(videoId);

  if (existingVideo) {
    cleanupUploadedVideo(file);
    return buildUploadDuplicateResult(file, existingVideo);
  }

  const videoFilename = storedVideoFilename;
  const requestedThumbnailFilename = `${path.parse(videoFilename).name}.jpg`;
  const settings = storageService.getSettings();
  const thumbnailTarget = resolveManagedThumbnailTarget(
    {
      videoPath: `/videos/${videoFilename}`,
    },
    requestedThumbnailFilename,
    settings.moveThumbnailsToVideoFolder || false,
  );
  const thumbnailFilename = path.basename(thumbnailTarget.relativePath);
  const validatedThumbnailPath = thumbnailTarget.absolutePath;
  const thumbnailWebPath = thumbnailTarget.webPath;

  const hasVideoStream = await uploadedFileHasVideoStream(validatedVideoPath);
  if (!hasVideoStream) {
    cleanupUploadedVideo(file);
    cleanupGeneratedThumbnail(validatedThumbnailPath);
    return buildUploadFailureResult(
      file,
      "Uploaded file is not a valid supported video"
    );
  }

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
  }

  if (fs.existsSync(validatedThumbnailPath)) {
    await regenerateSmallThumbnailForThumbnailPath(thumbnailWebPath);
  }

  const duration = await getVideoDuration(validatedVideoPath);

  const fileSize =
    typeof file.size === "number" && Number.isFinite(file.size)
      ? file.size.toString()
      : undefined;

  const newVideo = {
    id: videoId,
    title: title || getDefaultUploadTitle(file.originalname),
    author: author || "Admin",
    source: "local",
    sourceUrl: "",
    videoFilename,
    thumbnailFilename: fs.existsSync(validatedThumbnailPath)
      ? thumbnailFilename
      : undefined,
    videoPath: `/videos/${videoFilename}`,
    thumbnailPath: fs.existsSync(validatedThumbnailPath)
      ? thumbnailWebPath
      : undefined,
    thumbnailUrl: fs.existsSync(validatedThumbnailPath)
      ? thumbnailWebPath
      : undefined,
    duration: duration ? duration.toString() : undefined,
    fileSize,
    createdAt: new Date().toISOString(),
    date: new Date().toISOString().split("T")[0].replace(/-/g, ""),
    addedAt: new Date().toISOString(),
  };

  try {
    const inserted = storageService.saveVideoIfAbsent(newVideo);
    if (!inserted) {
      cleanupUploadedVideo(file);
      cleanupGeneratedThumbnail(validatedThumbnailPath);
      const concurrentVideo = storageService.getVideoById(videoId);
      if (concurrentVideo) {
        return buildUploadDuplicateResult(file, concurrentVideo);
      }

      throw new Error(
        `Concurrent upload conflict for ${videoId}: existing record could not be loaded`
      );
    }

    return buildUploadSuccessResult(file, newVideo);
  } catch (error) {
    cleanupUploadedVideo(file);
    cleanupGeneratedThumbnail(validatedThumbnailPath);
    throw error;
  }
};

// Helper responses
const sendData = (res: Response, data: any) => {
  res.status(200).json(data);
};

const sendSuccess = (res: Response, data: any, message: string) => {
  res.status(200).json(successResponse(data, message));
};

// Extract language code from filename (e.g. "movie.en.vtt" -> "en")
const getLanguageFromFilename = (filename: string): string | null => {
  const parts = filename.split(".");
  if (parts.length < 2) return null;
  const langCode = parts[parts.length - 2];
  if (/^[a-z]{2,3}(-[A-Z]{2})?$/i.test(langCode)) return langCode;
  return null;
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
 * Upload video
 * Errors are automatically handled by asyncHandler middleware
 */
export const uploadVideo = async (
  req: Request,
  res: Response
): Promise<void> => {
  const [file] = getUploadedFilesFromRequest(req);
  if (!file) {
    throw createUploadValidationError("No video file uploaded");
  }

  const title = readStringField(req.body?.title);
  const author = readStringField(req.body?.author, "Admin");
  const result = await getUploadVideoPayload(file, title, author);

  if (result.status === "failed") {
    throw createUploadValidationError(result.message);
  }

  const statusCode = result.status === "duplicate" ? 200 : 201;
  res
    .status(statusCode)
    .json(successResponse({ video: result.video }, result.message));
};

export const uploadVideosBatch = async (
  req: Request,
  res: Response
): Promise<void> => {
  const files = getUploadedFilesFromRequest(req);
  if (files.length === 0) {
    throw createUploadValidationError("No video files uploaded");
  }

  const title = readStringField(req.body?.title);
  const author = readStringField(req.body?.author, "Admin");
  const results: UploadResultItem[] = [];

  for (const [index, file] of files.entries()) {
    const fileTitle = files.length === 1 && title
      ? title
      : getDefaultUploadTitle(file.originalname || `video-${index + 1}`);

    try {
      const result = await getUploadVideoPayload(file, fileTitle, author);
      results.push(result);
    } catch (error) {
      logger.error("Unhandled batch upload error:", error);
      results.push(
        buildUploadFailureResult(
          file,
          error instanceof Error ? error.message : "Failed to upload video"
        )
      );
    }
  }

  const summary = getUploadSummary(results);
  res.status(200).json(
    successResponse(
      {
        results,
        summary,
      },
      buildUploadResponseMessage(summary)
    )
  );
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

const resolveChannelUrl = async (sourceUrl: string): Promise<string | null> => {
  const youtubeChannelUrl = await fetchYouTubeChannelUrl(sourceUrl);
  if (youtubeChannelUrl) {
    return youtubeChannelUrl;
  }
  return fetchBilibiliChannelUrl(sourceUrl);
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
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const filePath = path.resolve(rawFilePath);
  validateRawMountFilePath(filePath);
  return filePath;
};

const assertMountFileExists = (filePath: string): void => {
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (!fs.existsSync(filePath)) {
    throw new NotFoundError("Video file", filePath);
  }
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (!fs.statSync(filePath).isFile()) {
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
 * Upload subtitle
 * Errors are automatically handled by asyncHandler middleware
 */
export const uploadSubtitle = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { language } = req.body;

  if (!req.file) {
    throw new ValidationError("No subtitle file uploaded", "file");
  }

  if (!req.file.buffer || req.file.buffer.length === 0) {
    throw new ValidationError("Uploaded subtitle file is empty", "file");
  }

  const originalExt = path.extname(req.file.originalname || "").toLowerCase();
  const safeExt = originalExt.match(/^\.(vtt|srt|ass|ssa)$/)
    ? originalExt
    : ".vtt";
  const sourceFilename = `${Date.now()}-${crypto
    .randomBytes(8)
    .toString("hex")}${safeExt}`;
  if (!sourceFilename) {
    throw new ValidationError("Invalid subtitle file path", "file");
  }
  fs.ensureDirSync(SUBTITLES_DIR);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  let sourcePath = resolveSafePath(path.join(SUBTITLES_DIR, sourceFilename), SUBTITLES_DIR);
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  fs.writeFileSync(sourcePath, req.file.buffer);
  let filename = sourceFilename;

  // Find the video first
  const video = storageService.getVideoById(id);
  if (!video) {
    // Clean up the uploaded file if video doesn't exist
    if (req.file) {
      try {
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        if (fs.existsSync(sourcePath)) {
          // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
          fs.unlinkSync(sourcePath);
        }
      } catch {
        // Ignore cleanup path validation errors for already-missing/invalid temp paths.
      }
    }
    throw new NotFoundError("Video", id);
  }

  // Convert ASS/SSA to VTT for HTML5 <track> playback (browsers don't support ASS natively)
  if (/\.(ass|ssa)$/i.test(filename)) {
    const assToVttModule = await import("ass-to-vtt");
    const assToVtt = ((): (() => NodeJS.ReadWriteStream) => {
      const m = assToVttModule as {
        default?: () => NodeJS.ReadWriteStream;
      } & (() => NodeJS.ReadWriteStream);
      return typeof m.default === "function" ? m.default : m;
    })();
    const sourceDir = path.dirname(sourcePath);
    const vttFilename = `${path.parse(filename).name}.vtt`;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const vttPath = resolveSafePath(path.join(sourceDir, vttFilename), sourceDir);
    try {
      await new Promise<void>((resolve, reject) => {
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        const readStream = fs.createReadStream(sourcePath);
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        const writeStream = fs.createWriteStream(vttPath);
        readStream
          .pipe(assToVtt())
          .pipe(writeStream)
          .on("finish", () => resolve())
          .on("error", reject);
        readStream.on("error", reject);
      });
      fs.unlinkSync(sourcePath);
      sourcePath = vttPath;
      filename = path.basename(vttPath);
    } catch (err) {
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
      logger.error("ASS/SSA to VTT conversion failed:", err);
      throw new ValidationError(
        "Invalid ASS/SSA file or conversion failed. Try uploading VTT or SRT.",
        "file"
      );
    }
  }

  // Determine the target directory and web path based on settings
  const settings = storageService.getSettings();
  const moveSubtitlesToVideoFolder = settings.moveSubtitlesToVideoFolder;

  let finalWebPath = "";

  // Determine relative video directory (Collection/Folder)
  let relativeVideoDir = "";

  if (video.videoPath) {
    // videoPath is like /videos/Folder/video.mp4 or /videos/video.mp4
    const cleanPath = video.videoPath.replace(/^\/videos\//, "");
    const dirName = path.dirname(cleanPath);
    if (dirName && dirName !== "." && !path.isAbsolute(dirName)) {
      const safeSegments = dirName
        .split(/[\\/]+/)
        .map((segment) => sanitizePathSegment(segment))
        .filter(Boolean);
      if (safeSegments.length > 0) {
        relativeVideoDir = path.join(...safeSegments);
      }
    }
  }

  try {
    if (moveSubtitlesToVideoFolder) {
      // Move to VIDEO folder: uploads/videos/Collection/filename
      const videoDir = relativeVideoDir
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        ? resolveSafePath(path.join(VIDEOS_DIR, relativeVideoDir), VIDEOS_DIR)
        : VIDEOS_DIR;

      fs.ensureDirSync(videoDir);
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const targetPath = resolveSafePath(path.join(videoDir, filename), videoDir);

      fs.moveSync(sourcePath, targetPath, { overwrite: true });

      const relativeWebDir = relativeVideoDir.split(path.sep).join("/");
      if (relativeVideoDir) {
        finalWebPath = `/videos/${relativeWebDir}/${filename}`;
      } else {
        finalWebPath = `/videos/${filename}`;
      }
    } else {
      // Move to SUBTITLE folder: uploads/subtitles/Collection/filename (Mirroring)
      // If relativeVideoDir exists, move it into that subfolder in subtitles
      if (relativeVideoDir) {
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        const targetDir = resolveSafePath(
          path.join(SUBTITLES_DIR, relativeVideoDir),
          SUBTITLES_DIR
        );
        fs.ensureDirSync(targetDir);
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        const targetPath = resolveSafePath(path.join(targetDir, filename), targetDir);

        fs.moveSync(sourcePath, targetPath, { overwrite: true });

        const relativeWebDir = relativeVideoDir.split(path.sep).join("/");
        finalWebPath = `/subtitles/${relativeWebDir}/${filename}`;
      } else {
        // Keep in default location (root of subtitles dir), but path needs to be correct
        // Multer put it in SUBTITLES_DIR already
        finalWebPath = `/subtitles/${filename}`;
      }
    }
  } catch (err) {
    logger.error("Failed to move subtitle:", err);
    // Fallback: assume it's where Multer put it
    finalWebPath = `/subtitles/${filename}`;
  }

  // Determine language
  let finalLanguage = language;

  if (!finalLanguage || finalLanguage === "unknown") {
    const detectedLang = getLanguageFromFilename(req.file.originalname);
    if (detectedLang) {
      finalLanguage = detectedLang;
    } else {
      finalLanguage = "unknown";
    }
  }

  // Create new subtitle object
  const newSubtitle = {
    language: finalLanguage,
    filename: filename,
    path: finalWebPath,
  };

  // Update video with new subtitle
  const currentSubtitles = video.subtitles || [];
  const updatedSubtitles = [...currentSubtitles, newSubtitle];

  const updatedVideo = storageService.updateVideo(id, {
    subtitles: updatedSubtitles,
  });

  if (!updatedVideo) {
    throw new NotFoundError("Video", id);
  }

  res.status(201).json(
    successResponse(
      {
        subtitle: newSubtitle,
        video: updatedVideo,
      },
      "Subtitle uploaded successfully"
    )
  );
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
