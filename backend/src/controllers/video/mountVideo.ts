import { Response } from "express";
import path from "path";
import { NotFoundError, ValidationError } from "../../errors/DownloadErrors";
import {
  normalizeSafeAbsolutePath,
  statTrusted,
} from "../../utils/security";

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

export const isMountVideoPath = (videoPath: string | undefined): boolean =>
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

export const resolveMountFilePath = (rawFilePath: string): string => {
  validateRawMountFilePath(rawFilePath);
  const filePath = normalizeSafeAbsolutePath(rawFilePath);
  validateRawMountFilePath(filePath);
  return filePath;
};

export const assertMountFileExists = async (filePath: string): Promise<void> => {
  // A single async stat call covers both the existence check and the file-type
  // check on the per-range-request streaming path.
  let stats: Awaited<ReturnType<typeof statTrusted>>;
  try {
    stats = await statTrusted(filePath);
  } catch {
    throw new NotFoundError("Video file", filePath);
  }
  if (!stats.isFile()) {
    throw new ValidationError("Path is not a file", "videoPath");
  }
};

const getVideoContentType = (filePath: string): string =>
  VIDEO_CONTENT_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()] ||
  "video/mp4";

export const setMountVideoHeaders = (res: Response, filePath: string): void => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Range, Content-Length"
  );
  res.setHeader("Content-Type", getVideoContentType(filePath));
};
