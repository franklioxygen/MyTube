/// <reference path="../types/ass-to-vtt.d.ts" />
import crypto from "crypto";
import { Request, Response } from "express";
import fs from "fs-extra";
import multer from "multer";
import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import * as storageService from "../services/storageService";
import { isBilibiliUrl, isYouTubeUrl } from "../utils/helpers";
import { logger } from "../utils/logger";
import { successResponse } from "../utils/response";
import {
  resolveSafePath,
  sanitizePathSegment,
} from "../utils/security";

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.ensureDirSync(VIDEOS_DIR);
    cb(null, VIDEOS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix =
      Date.now() + "-" + crypto.randomBytes(8).toString("hex");
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
  const normalized = path.normalize(inputPath);
  if (!normalized.startsWith(VIDEOS_DIR)) {
    throw new ValidationError("Invalid video path", "path");
  }
  return normalized;
};

const validateImagePath = (inputPath: string): string => {
  const normalized = path.normalize(inputPath);
  if (!normalized.startsWith(IMAGES_DIR)) {
    throw new ValidationError("Invalid image path", "path");
  }
  return normalized;
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
  if (!req.file) {
    throw new ValidationError("No video file uploaded", "file");
  }

  const { title, author } = req.body;
  const videoId = Date.now().toString();
  const videoFilename = req.file.filename;
  const thumbnailFilename = `${path.parse(videoFilename).name}.jpg`;

  const videoPath = path.normalize(path.join(VIDEOS_DIR, videoFilename));
  const thumbnailPath = path.normalize(
    path.join(IMAGES_DIR, thumbnailFilename)
  );

  // Validate paths to ensure they are within the intended directories
  if (!videoPath.startsWith(VIDEOS_DIR)) {
    throw new ValidationError("Invalid video filename", "file");
  }
  if (!thumbnailPath.startsWith(IMAGES_DIR)) {
    // Should technically not happen if generated from safe filename, but good to check
    throw new ValidationError("Invalid thumbnail path", "file");
  }

  // Validate paths to prevent path traversal (using existing helper for file existence/permission checks if any)
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
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(videoPath)) {
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
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
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    thumbnailFilename: fs.existsSync(thumbnailPath)
      ? thumbnailFilename
      : undefined,
    videoPath: `/videos/${videoFilename}`,
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    thumbnailPath: fs.existsSync(thumbnailPath)
      ? `/images/${thumbnailFilename}`
      : undefined,
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
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
        ? resolveSafePath(path.join(VIDEOS_DIR, relativeVideoDir), VIDEOS_DIR)
        : VIDEOS_DIR;

      fs.ensureDirSync(videoDir);
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
        const targetDir = resolveSafePath(
          path.join(SUBTITLES_DIR, relativeVideoDir),
          SUBTITLES_DIR
        );
        fs.ensureDirSync(targetDir);
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

  if (!isMountVideoPath(video.videoPath)) {
    throw new NotFoundError("Video", id);
  }

  const rawFilePath = video.videoPath.substring(6);
  const filePath = resolveMountFilePath(rawFilePath);
  assertMountFileExists(filePath);
  setMountVideoHeaders(res, filePath);
  res.sendFile(path.basename(filePath), { root: path.dirname(filePath) });
};
