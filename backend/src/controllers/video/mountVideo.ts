import { Response } from "express";
import path from "path";
import { NotFoundError, ValidationError } from "../../errors/DownloadErrors";
import {
  normalizeSafeAbsolutePath,
  pathExistsTrustedSync,
  statTrustedSync,
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

export const assertMountFileExists = (filePath: string): void => {
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

export const setMountVideoHeaders = (res: Response, filePath: string): void => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Range, Content-Length"
  );
  res.setHeader("Content-Type", getVideoContentType(filePath));
};
