/// <reference path="../../types/ass-to-vtt.d.ts" />
import crypto from "crypto";
import { Request, Response } from "express";
import fs from "fs-extra";
import multer from "multer";
import path from "path";
import { SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { NotFoundError, ValidationError } from "../../errors/DownloadErrors";
import * as storageService from "../../services/storageService";
import { logger } from "../../utils/logger";
import { successResponse } from "../../utils/response";
import {
  createReadStreamSafe,
  createWriteStreamSafe,
  pathExistsSafeSync,
  resolveSafePath,
  sanitizePathSegment,
  unlinkSafeSync,
  writeFileSafeSync,
} from "../../utils/security";

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

// Extract language code from filename (e.g. "movie.en.vtt" -> "en")
const getLanguageFromFilename = (filename: string): string | null => {
  const parts = filename.split(".");
  if (parts.length < 2) return null;
  const langCode = parts[parts.length - 2];
  if (/^[a-z]{2,3}(-[A-Z]{2})?$/i.test(langCode)) return langCode;
  return null;
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
  writeFileSafeSync(sourcePath, SUBTITLES_DIR, req.file.buffer);
  let filename = sourceFilename;

  // Find the video first
  const video = storageService.getVideoById(id);
  if (!video) {
    // Clean up the uploaded file if video doesn't exist
    if (req.file) {
      try {
        if (pathExistsSafeSync(sourcePath, SUBTITLES_DIR)) {
          unlinkSafeSync(sourcePath, SUBTITLES_DIR);
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
      unlinkSafeSync(sourcePath, SUBTITLES_DIR);
      sourcePath = vttPath;
      filename = path.basename(vttPath);
    } catch (err) {
      if (pathExistsSafeSync(sourcePath, SUBTITLES_DIR)) {
        unlinkSafeSync(sourcePath, SUBTITLES_DIR);
      }
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
