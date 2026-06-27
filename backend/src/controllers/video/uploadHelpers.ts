import crypto from "crypto";
import { Request } from "express";
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
import {
  getUploadVideoId,
  UploadedVideoFile,
} from "../../utils/videoUpload";
import {
  pathExistsSafeSync,
  resolveSafePath,
  unlinkSafeSync,
} from "../../utils/security";
import { logger } from "../../utils/logger";
import {
  execFileSafe,
  getVideoDuration,
  uploadedFileHasVideoStream,
} from "./mediaProbe";

// Helper validate paths functions
export const validateVideoPath = (inputPath: string): string => {
  try {
    return resolveSafePath(inputPath, VIDEOS_DIR);
  } catch {
    throw new ValidationError("Invalid video path", "path");
  }
};

export const getStoredUploadFilename = (
  file: Pick<UploadedVideoFile, "filename">
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

const cleanupUploadedVideo = (
  file: Pick<UploadedVideoFile, "filename"> | undefined
): void => {
  const storedVideoFilename = file ? getStoredUploadFilename(file) : undefined;
  if (!storedVideoFilename) {
    return;
  }

  try {
    const storedVideoPath = validateVideoPath(
      `${VIDEOS_DIR}/${storedVideoFilename}`
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

export type UploadStatus = "uploaded" | "duplicate" | "failed";

export interface UploadResultItem {
  originalName: string;
  status: UploadStatus;
  message: string;
  video?: import("../../services/storageService").Video;
}

export interface UploadSummary {
  total: number;
  uploaded: number;
  duplicates: number;
  failed: number;
}

export const getUploadSummary = (results: UploadResultItem[]): UploadSummary =>
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

export const getDefaultUploadTitle = (originalName: string): string =>
  path.basename(originalName).replace(/\.[^/.]+$/, "");

export const readStringField = (
  value: unknown,
  fallback: string = ""
): string => {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }
  if (Array.isArray(value)) {
    const firstString = value.find(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0
    );
    return firstString?.trim() || fallback;
  }
  return fallback;
};

export const buildUploadResponseMessage = (summary: UploadSummary): string => {
  if (summary.failed === 0 && summary.duplicates === 0) {
    return `Uploaded ${summary.uploaded} video${summary.uploaded === 1 ? "" : "s"} successfully.`;
  }

  return `Upload finished. Uploaded: ${summary.uploaded}, duplicates skipped: ${summary.duplicates}, failed: ${summary.failed}.`;
};

export const buildUploadFailureResult = (
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

export const getUploadedFilesFromRequest = (
  req: Request
): UploadedVideoFile[] => {
  if (Array.isArray(req.files)) {
    return req.files as UploadedVideoFile[];
  }

  if (req.file) {
    return [req.file as UploadedVideoFile];
  }

  const filesByField = req.files as
    | Record<string, Express.Multer.File[]>
    | undefined;
  if (!filesByField) {
    return [];
  }

  return Object.values(filesByField).flat() as UploadedVideoFile[];
};

export const getUploadVideoPayload = async (
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

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
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
    settings.moveThumbnailsToVideoFolder || false
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
