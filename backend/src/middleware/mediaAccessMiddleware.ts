import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { isLoginRequired } from "../services/passwordService";
import * as storageService from "../services/storageService";
import { Video } from "../services/storageService/types";

const stripQuery = (value: unknown): string | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.split("?")[0];
};

const isPublicVideo = (video: Video): boolean => (video.visibility ?? 1) === 1;

const normalizeRequestPath = (req: Request): string => {
  const basePath = `${req.baseUrl ?? ""}${req.path ?? ""}`;
  return basePath.replace(/\/{2,}/g, "/");
};

const cloudThumbnailCacheFilename = (cloudPath: string): string => {
  const hash = crypto.createHash("sha256").update(cloudPath).digest("hex");
  return `${hash}.jpg`;
};

const addWebPath = (paths: Set<string>, value: unknown): void => {
  const pathValue = stripQuery(value);
  if (!pathValue) {
    return;
  }

  if (
    pathValue.startsWith("/videos/") ||
    pathValue.startsWith("/images/") ||
    pathValue.startsWith("/subtitles/") ||
    pathValue.startsWith("/avatars/") ||
    pathValue.startsWith("cloud:")
  ) {
    paths.add(pathValue);
  }

  if (pathValue.startsWith("cloud:")) {
    paths.add(
      `/api/cloud/thumbnail-cache/${cloudThumbnailCacheFilename(pathValue)}`
    );
  }
};

const getVideoMediaPaths = (video: Video): Set<string> => {
  const paths = new Set<string>();
  addWebPath(paths, video.videoPath);
  addWebPath(paths, video.thumbnailPath);
  addWebPath(paths, video.thumbnailUrl);
  addWebPath(paths, video.authorAvatarPath);

  if (Array.isArray(video.subtitles)) {
    for (const subtitle of video.subtitles) {
      addWebPath(paths, subtitle?.path);
    }
  }

  return paths;
};

const getCloudFilename = (req: Request): string | null => {
  const filename = req.params?.filename;
  if (typeof filename === "string" && filename.length > 0) {
    return filename;
  }
  return null;
};

export const getRequestedMediaCandidates = (req: Request): string[] => {
  const requestPath = stripQuery(normalizeRequestPath(req));
  if (!requestPath) {
    return [];
  }

  const cloudFilename = getCloudFilename(req);
  if (requestPath.startsWith("/cloud/videos/") && cloudFilename) {
    return [`cloud:${cloudFilename}`];
  }

  if (requestPath.startsWith("/cloud/images/") && cloudFilename) {
    return [`cloud:${cloudFilename}`];
  }

  if (requestPath.startsWith("/images-small/")) {
    const relativePath = requestPath.slice("/images-small/".length);
    return [`/images/${relativePath}`, `/videos/${relativePath}`];
  }

  return [requestPath];
};

export const canVisitorAccessMedia = (
  candidates: string[],
  videos: Video[] = storageService.getVideos()
): boolean => {
  if (candidates.length === 0) {
    return false;
  }

  return videos.some((video) => {
    if (!isPublicVideo(video)) {
      return false;
    }

    const mediaPaths = getVideoMediaPaths(video);
    return candidates.some((candidate) => mediaPaths.has(candidate));
  });
};

export const mediaAccessMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!isLoginRequired()) {
    next();
    return;
  }

  if (req.user?.role === "admin") {
    next();
    return;
  }

  if (!req.user) {
    res.status(401).send("Authentication required");
    return;
  }

  if (req.user.role !== "visitor") {
    res.status(403).send("Forbidden");
    return;
  }

  if (canVisitorAccessMedia(getRequestedMediaCandidates(req))) {
    next();
    return;
  }

  res.status(404).send("Not Found");
};
