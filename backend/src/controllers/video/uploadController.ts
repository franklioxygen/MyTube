import crypto from "crypto";
import { Request, Response } from "express";
import multer from "multer";
import path from "path";
import sanitizeFilename from "sanitize-filename";
import { IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import { ValidationError } from "../../errors/DownloadErrors";
import * as storageService from "../../services/storageService";
import {
  deleteSmallThumbnailMirrorSync,
  regenerateSmallThumbnailForThumbnailPath,
  resolveManagedThumbnailTarget,
} from "../../services/thumbnailMirrorService";
import { logger } from "../../utils/logger";
import { successResponse } from "../../utils/response";
import {
  createUploadValidationError,
  createVideoUploadStorage,
  getUploadVideoId,
  UploadedVideoFile,
} from "../../utils/videoUpload";
import {
  pathExistsSafeSync,
  resolveSafePath,
  unlinkSafeSync,
} from "../../utils/security";

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
    const storedVideoPath = validateVideoPath(
      `${VIDEOS_DIR}/${storedVideoFilename}`,
    );
    if (pathExistsSafeSync(storedVideoPath, VIDEOS_DIR)) {
      unlinkSafeSync(storedVideoPath, VIDEOS_DIR);
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
    if (pathExistsSafeSync(thumbnailPath, [IMAGES_DIR, VIDEOS_DIR])) {
      unlinkSafeSync(thumbnailPath, [IMAGES_DIR, VIDEOS_DIR]);
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
  video?: import("../../services/storageService").Video;
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
  video: import("../../services/storageService").Video
): UploadResultItem => ({
  originalName: path.basename(file.originalname),
  status: "duplicate",
  message: "Video already exists. Skipped duplicate upload",
  video,
});

const buildUploadSuccessResult = (
  file: Pick<UploadedVideoFile, "originalname">,
  video: import("../../services/storageService").Video,
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

  const thumbnailExists = pathExistsSafeSync(validatedThumbnailPath, [
    IMAGES_DIR,
    VIDEOS_DIR,
  ]);
  if (thumbnailExists) {
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
    thumbnailFilename: thumbnailExists ? thumbnailFilename : undefined,
    videoPath: `/videos/${videoFilename}`,
    thumbnailPath: thumbnailExists ? thumbnailWebPath : undefined,
    thumbnailUrl: thumbnailExists ? thumbnailWebPath : undefined,
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
