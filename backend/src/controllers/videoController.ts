/// <reference path="../types/ass-to-vtt.d.ts" />
import crypto from "crypto";
import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { SUBTITLES_DIR, VIDEOS_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { syncMediaServerArtifactsForRecord } from "../services/mediaServerExport";
import { invalidateRecommendationSignalsCache } from "../services/recommendationSignalsService";
import * as storageService from "../services/storageService";
import { addTagsToGlobalSettings } from "../services/tagService";
import { logger } from "../utils/logger";
import {
  getLimitParam,
  getPositiveIntegerParam,
  getStringParam,
} from "../utils/paramUtils";
import { successResponse } from "../utils/response";
import { createUploadValidationError } from "../utils/videoUpload";
import { resolvePlayableVideoFilePath } from "../utils/videoFileResolver";
import {
  createReadStreamSafe,
  createWriteStreamSafe,
  removeSafe,
  resolveSafePath,
  sanitizePathSegment,
  writeFileSafe,
} from "../utils/security";
import { getVisibilityScopedRole } from "./video/visibility";
import { sendData, sendSuccess } from "./video/responses";
import { getLanguageFromFilename, resolveVideoWebPath } from "./video/pathUtils";
import {
  buildUploadFailureResult,
  buildUploadResponseMessage,
  getDefaultUploadTitle,
  getUploadSummary,
  getUploadVideoPayload,
  getUploadedFilesFromRequest,
  readStringField,
  UploadResultItem,
} from "./video/uploadHelpers";
import {
  getExistingVideoBySourceUrl,
  persistChannelUrlForVideo,
  resolveChannelUrl,
} from "./video/channelUrl";
import {
  assertMountFileExists,
  isMountVideoPath,
  resolveMountFilePath,
  setMountVideoHeaders,
} from "./video/mountVideo";

// Re-export upload middleware/storage so existing `videoController.*` imports keep working.
export {
  upload,
  uploadBatch,
  uploadSubtitleMiddleware,
  videoBatchUploadStorage,
  videoUploadStorage,
} from "./video/uploadMiddleware";

/**
 * Get all videos
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns array directly for backward compatibility with frontend
 */
export const getVideos = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Visitors must only see public (visibility=1) videos. The query layer
  // enforces this so the frontend filter (VideoContext) is no longer the only
  // gate. Fixes GHSA-hcm6-w6x8-6jhr.
  const role = getVisibilityScopedRole(req);

  // Conditional-request short-circuit: the frontend refetches the whole list
  // after every completed download and on many mutations. When nothing in the
  // videos table changed since the client's copy, answer 304 from the
  // in-process revision counter without hydrating/serializing the table.
  const etag = storageService.getVideosListETag(
    role === "visitor" ? "visitor" : "all"
  );
  const ifNoneMatch = req.headers["if-none-match"];
  if (
    typeof ifNoneMatch === "string" &&
    ifNoneMatch
      .split(",")
      .map((tag) => tag.trim())
      .includes(etag)
  ) {
    res.status(304).end();
    return;
  }
  res.set("ETag", etag);
  // Cache but always revalidate, and never share across users (role-scoped).
  res.set("Cache-Control", "private, no-cache");

  // Opt-in pagination groundwork (P-1 step 3): external API consumers can
  // request a window; without params the full-list contract is unchanged.
  const page =
    req.query?.limit !== undefined
      ? {
          limit: getLimitParam(req.query.limit, 100, 500),
          offset: getPositiveIntegerParam(req.query.offset) ?? 0,
        }
      : undefined;

  // List views never render description/subtitles; the player loads the full
  // row via GET /videos/:id. Omitting them keeps the payload flat as the
  // library and its per-video description sizes grow.
  const videos = storageService.getVideoSummaries(role, page);
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
  const id = getStringParam(req.params.id) ?? "";
  // Visitors are restricted to public videos; a hidden video is treated as
  // "not found" for them. Fixes GHSA-hcm6-w6x8-6jhr.
  const video = storageService.getVideoById(id, getVisibilityScopedRole(req));

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
      video.signedUrl = signedUrl;
    }

    if (video.thumbnailPath?.startsWith("cloud:")) {
      const thumbnailFilename = extractCloudFilename(video.thumbnailPath);
      const signedThumbnailUrl = await CloudStorageService.getSignedUrl(
        thumbnailFilename,
        "thumbnail"
      );

      if (signedThumbnailUrl) {
        video.signedThumbnailUrl = signedThumbnailUrl;
      }
    }
  }

  // Check if video is in mount directory and inject mount video URL
  if (video.videoPath?.startsWith("mount:")) {
    // For mount directory videos, provide a special URL that will be served by the mount video endpoint
    video.signedUrl = `/api/mount-video/${id}`;
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
  const id = getStringParam(req.params.id) ?? "";
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
  const id = getStringParam(req.params.id) ?? "";
  // Don't reveal a hidden video's comments to visitors: a hidden video is
  // treated as "not found" for them. The query-layer role filter returns
  // undefined for a hidden id when the caller is a visitor (and ignores stale
  // roles when login is disabled). Fixes GHSA-hcm6-w6x8-6jhr.
  const role = getVisibilityScopedRole(req);
  if (role === "visitor" && !storageService.getVideoById(id, role)) {
    throw new NotFoundError("Video", id);
  }
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
  const id = getStringParam(req.params.id) ?? "";
  const updates = req.body;

  // Filter allowed updates
  const allowedUpdates: Partial<import("../services/storageService").Video> = {};
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

  // Keep the global tag catalog (settings.tags) in sync so tags created while
  // tagging a video also appear in Tags Management and as suggestions.
  if (Array.isArray(allowedUpdates.tags) && allowedUpdates.tags.length > 0) {
    addTagsToGlobalSettings(allowedUpdates.tags);
  }

  if (allowedUpdates.visibility !== undefined) {
    invalidateRecommendationSignalsCache();
  }

  syncMediaServerArtifactsForRecord(updatedVideo);

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
  const sourceUrl = getStringParam(req.query.sourceUrl);

  if (!sourceUrl) {
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
  const id = getStringParam(req.params.id) ?? "";
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
  await fs.ensureDir(SUBTITLES_DIR);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  let sourcePath = resolveSafePath(path.join(SUBTITLES_DIR, sourceFilename), SUBTITLES_DIR);
  await writeFileSafe(sourcePath, SUBTITLES_DIR, req.file.buffer);
  let filename = sourceFilename;

  // Find the video first
  const video = storageService.getVideoById(id);
  if (!video) {
    // Clean up the uploaded file if video doesn't exist. removeSafe is a no-op
    // when the path is already gone, so no existence check is needed.
    if (req.file) {
      try {
        await removeSafe(sourcePath, SUBTITLES_DIR);
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
        const readStream = createReadStreamSafe(sourcePath, SUBTITLES_DIR);
        const writeStream = createWriteStreamSafe(vttPath, SUBTITLES_DIR);
        const assToVttStream = assToVtt();

        readStream.on("error", reject);
        assToVttStream.on("error", reject);
        writeStream.on("finish", () => resolve());
        writeStream.on("error", reject);

        readStream.pipe(assToVttStream);
        assToVttStream.pipe(writeStream);
      });
      await removeSafe(sourcePath, SUBTITLES_DIR);
      sourcePath = vttPath;
      filename = path.basename(vttPath);
    } catch (err) {
      await removeSafe(sourcePath, SUBTITLES_DIR);
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
  const id = getStringParam(req.params.id) ?? "";
  // Visitors must not be able to stream hidden mount-directory videos.
  const video = storageService.getVideoById(id, getVisibilityScopedRole(req));

  if (!video) {
    throw new NotFoundError("Video", id);
  }

  const mountVideoPath = video.videoPath ?? undefined;

  if (!isMountVideoPath(mountVideoPath)) {
    throw new NotFoundError("Video", id);
  }

  const rawFilePath = mountVideoPath.substring(6);
  const filePath = resolveMountFilePath(rawFilePath);
  await assertMountFileExists(filePath);
  setMountVideoHeaders(res, filePath);
  res.sendFile(path.basename(filePath), { root: path.dirname(filePath) });
};
