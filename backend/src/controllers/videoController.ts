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
  isPathWithinDirectories,
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

// Configure Multer for subtitle uploads
const subtitleStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.ensureDirSync(SUBTITLES_DIR);
    cb(null, SUBTITLES_DIR);
  },
  filename: (_req, file, cb) => {
    // Preserve original name for language detection, prepend timestamp for uniqueness
    // Sanitize filename to prevent issues
    const safeOriginalName = file.originalname.replace(
      /[^a-zA-Z0-9.\-_]/g,
      "_"
    );
    const uniqueSuffix = Date.now() + "-" + safeOriginalName;
    cb(null, uniqueSuffix);
  },
});

export const uploadSubtitleMiddleware = multer({
  storage: subtitleStorage,
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
    if (isYouTubeUrl(sourceUrl)) {
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
    if (isBilibiliUrl(sourceUrl)) {
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

  // Find the video first
  const video = storageService.getVideoById(id);
  const allowedUploadDirs = [
    path.resolve(SUBTITLES_DIR),
    path.resolve(VIDEOS_DIR),
    path.resolve("/tmp"),
  ];
  const isAllowedUploadPath = (candidatePath: string): boolean =>
    isPathWithinDirectories(candidatePath, allowedUploadDirs);
  if (!video) {
    // Clean up the uploaded file if video doesn't exist
    if (req.file) {
      try {
        const safeUploadedPath = path.resolve(req.file.path);
        if (isAllowedUploadPath(safeUploadedPath) && fs.existsSync(safeUploadedPath)) {
          fs.unlinkSync(safeUploadedPath);
        }
      } catch {
        // Ignore cleanup path validation errors for already-missing/invalid temp paths.
      }
    }
    throw new NotFoundError("Video", id);
  }

  let sourcePath = path.resolve(req.file.path);
  const isAllowedSourcePath = isAllowedUploadPath(sourcePath);
  if (!isAllowedSourcePath) {
    throw new ValidationError("Invalid subtitle file path", "file");
  }
  let filename = path.basename(req.file.filename);

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
      const isAllowedConversionSource = isAllowedUploadPath(sourcePath);
      if (!isAllowedConversionSource) {
        throw new ValidationError("Invalid subtitle file path", "file");
      }

      await new Promise<void>((resolve, reject) => {
        const readStream = fs.createReadStream(sourcePath);
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
      const isAllowedMoveSource = isAllowedUploadPath(sourcePath);
      if (!isAllowedMoveSource) {
        throw new ValidationError("Invalid subtitle source path", "file");
      }

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
        const isAllowedMoveSource = isAllowedUploadPath(sourcePath);
        if (!isAllowedMoveSource) {
          throw new ValidationError("Invalid subtitle source path", "file");
        }

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

  // Check if video is a mount directory video
  if (!video.videoPath?.startsWith("mount:")) {
    throw new NotFoundError("Video", id);
  }

  // Extract the actual file path (remove "mount:" prefix)
  const rawFilePath = video.videoPath.substring(6); // Remove "mount:" prefix

  // Validate and sanitize path to prevent path traversal
  // For mount paths, we need to validate they're safe
  // Note: mount paths are user-configured, so we validate they don't contain traversal sequences
  if (!rawFilePath || typeof rawFilePath !== "string") {
    throw new ValidationError(
      "Invalid file path: empty or invalid",
      "videoPath"
    );
  }

  if (rawFilePath.includes("..") || rawFilePath.includes("\0")) {
    throw new ValidationError(
      "Invalid file path: path traversal detected",
      "videoPath"
    );
  }

  // Additional validation: ensure path is absolute
  if (!path.isAbsolute(rawFilePath)) {
    throw new ValidationError(
      "Invalid file path: must be absolute",
      "videoPath"
    );
  }

  // Resolve the path (should not change absolute paths, but normalizes them)
  const filePath = path.resolve(rawFilePath);

  // Final validation: ensure resolved path is still absolute and doesn't contain traversal
  if (
    !path.isAbsolute(filePath) ||
    filePath.includes("..") ||
    filePath.includes("\0")
  ) {
    throw new ValidationError(
      "Invalid file path: path traversal detected",
      "videoPath"
    );
  }

  // Validate path exists and is safe
  if (!fs.existsSync(filePath)) {
    throw new NotFoundError("Video file", filePath);
  }

  // Validate it's a file, not a directory
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new ValidationError("Path is not a file", "videoPath");
  }

  // Set headers for video streaming (important for Range requests)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Range, Content-Length"
  );

  // Determine MIME type based on file extension (case-insensitive)
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith(".mp4")) {
    res.setHeader("Content-Type", "video/mp4");
  } else if (lowerPath.endsWith(".webm")) {
    res.setHeader("Content-Type", "video/webm");
  } else if (lowerPath.endsWith(".mkv")) {
    res.setHeader("Content-Type", "video/x-matroska");
  } else if (lowerPath.endsWith(".avi")) {
    res.setHeader("Content-Type", "video/x-msvideo");
  } else if (lowerPath.endsWith(".mov")) {
    res.setHeader("Content-Type", "video/quicktime");
  } else if (lowerPath.endsWith(".m4v")) {
    res.setHeader("Content-Type", "video/x-m4v");
  } else if (lowerPath.endsWith(".flv")) {
    res.setHeader("Content-Type", "video/x-flv");
  } else if (lowerPath.endsWith(".3gp")) {
    res.setHeader("Content-Type", "video/3gpp");
  } else {
    // Default to mp4 for unknown extensions (Safari prefers this)
    res.setHeader("Content-Type", "video/mp4");
  }

  // Send the file - Express will handle Range requests automatically
  res.sendFile(filePath);
};
