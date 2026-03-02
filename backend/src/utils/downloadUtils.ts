/**
 * Utility functions for download operations
 */

import fs from "fs-extra";
import os from "os";
import path from "path";
import {
  DATA_DIR,
  IMAGES_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../config/paths";
import {
  DownloadCancelledError,
  isAnyCancellationError,
} from "../errors/DownloadErrors";
import * as storageService from "../services/storageService";
import { sanitizeLogMessage } from "./logger";
import { validatePathWithinDirectories } from "./security";

const SAFE_REMOVE_ALLOWED_DIRS = [
  VIDEOS_DIR,
  IMAGES_DIR,
  SUBTITLES_DIR,
  DATA_DIR,
  os.tmpdir(),
  "/tmp",
];

/**
 * Check if a download was cancelled by checking if it's still in active downloads
 * @param downloadId - The download ID to check
 * @returns true if download is still active, false if it was cancelled
 */
export function isDownloadActive(downloadId?: string): boolean {
  if (!downloadId) return true; // If no downloadId, assume active

  const status = storageService.getDownloadStatus();
  return status.activeDownloads.some((d) => d.id === downloadId);
}

/**
 * Check if download was cancelled and throw DownloadCancelledError if so
 * @param downloadId - The download ID to check
 * @throws DownloadCancelledError if download was cancelled
 */
export function throwIfCancelled(downloadId?: string): void {
  if (!isDownloadActive(downloadId)) {
    throw DownloadCancelledError.create();
  }
}

/**
 * Check if an error is a cancellation error
 * Uses the centralized check from DownloadErrors
 * @param error - The error to check
 * @returns true if the error indicates cancellation
 */
export function isCancellationError(error: unknown): boolean {
  return isAnyCancellationError(error);
}

/**
 * Clean up subtitle files (.vtt) from VIDEOS_DIR that match a base filename
 * @param baseFilename - The base filename to match (e.g., "video_123")
 * @param directory - Optional directory to search in (defaults to VIDEOS_DIR)
 * @returns Array of deleted file paths
 */
export async function cleanupSubtitleFiles(
  baseFilename: string,
  directory: string = VIDEOS_DIR
): Promise<string[]> {
  const deletedFiles: string[] = [];

  try {
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (!fs.existsSync(directory)) {
      return deletedFiles;
    }

    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    const files = fs.readdirSync(directory);
    const subtitleFiles = files.filter(
      (file: string) => file.startsWith(baseFilename) && file.endsWith(".vtt")
    );

    for (const subtitleFile of subtitleFiles) {
      const subtitlePath = path.join(directory, subtitleFile);
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (fs.existsSync(subtitlePath)) {
        await safeRemove(subtitlePath);
        deletedFiles.push(subtitlePath);
        console.log("Deleted subtitle file:", subtitlePath);
      }
    }
  } catch (error) {
    console.error("Error cleaning up subtitle files:", error);
  }

  return deletedFiles;
}

/**
 * Clean up temporary files (.part, .ytdl, etc.) that match a video filename
 * @param videoPath - The full path to the video file
 * @returns Array of deleted file paths
 */
export async function cleanupTemporaryFiles(videoPath: string): Promise<string[]> {
  const deletedFiles: string[] = [];

  try {
    const videoDir = path.dirname(videoPath);
    const videoBasename = path.basename(videoPath);

    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (!fs.existsSync(videoDir)) {
      return deletedFiles;
    }

    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    const files = fs.readdirSync(videoDir);
    const tempFiles = files.filter((file: string) => {
      // Match files like: filename.mp4.part, filename.mp4.ytdl, etc.
      // but not the final video file itself
      return (
        file.startsWith(videoBasename) &&
        file !== videoBasename &&
        (file.endsWith(".part") ||
          file.endsWith(".ytdl") ||
          file.endsWith(".mp4.part") ||
          file.endsWith(".mp4.ytdl"))
      );
    });

    for (const tempFile of tempFiles) {
      const tempFilePath = path.join(videoDir, tempFile);
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (fs.existsSync(tempFilePath)) {
        await safeRemove(tempFilePath);
        deletedFiles.push(tempFilePath);
        console.log("Deleted temporary file:", tempFilePath);
      }
    }

    // Also check for the main video file if it exists (partial download)
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(videoPath)) {
      await safeRemove(videoPath);
      deletedFiles.push(videoPath);
      console.log("Deleted partial video file:", videoPath);
    }
  } catch (error) {
    console.error("Error cleaning up temporary files:", error);
  }

  return deletedFiles;
}

/**
 * Clean up partial video files (.part) for a given video path
 * @param videoPath - The full path to the video file
 * @returns Array of deleted file paths
 */
export async function cleanupPartialVideoFiles(videoPath: string): Promise<string[]> {
  const deletedFiles: string[] = [];

  try {
    const partVideoPath = `${videoPath}.part`;

    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(partVideoPath)) {
      await safeRemove(partVideoPath);
      deletedFiles.push(partVideoPath);
      console.log("Deleted partial video file:", partVideoPath);
    }

    if (fs.existsSync(videoPath)) {
      await safeRemove(videoPath);
      deletedFiles.push(videoPath);
      console.log("Deleted video file:", videoPath);
    }
  } catch (error) {
    console.error("Error cleaning up partial video files:", error);
  }

  return deletedFiles;
}

/**
 * Parse size string (e.g., "10.00MiB", "123.45KiB") to bytes
 * Handles both decimal (KB, MB, GB, TB) and binary (KiB, MiB, GiB, TiB) units
 * Also handles ~ prefix for approximate sizes
 */
export function parseSize(sizeStr: string): number {
  if (!sizeStr) return 0;

  // Remove ~ prefix if present
  const cleanSize = sizeStr.replace(/^~/, "").trim();

  // Match number and unit
  const match = cleanSize.match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers: { [key: string]: number } = {
    B: 1,
    KB: 1000,
    KIB: 1024,
    MB: 1000 * 1000,
    MIB: 1024 * 1024,
    GB: 1000 * 1000 * 1000,
    GIB: 1024 * 1024 * 1024,
    TB: 1000 * 1000 * 1000 * 1000,
    TIB: 1024 * 1024 * 1024 * 1024,
  };

  return value * (multipliers[unit] || 1);
}

/**
 * Format bytes to human readable string (e.g., "55.8 MiB")
 * Uses binary units (KiB, MiB, GiB, TiB) with 1024 base
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Calculate downloaded size from progress percentage and total size
 * Returns formatted string (e.g., "55.8 MiB")
 */
export function calculateDownloadedSize(
  percentage: number,
  totalSize: string
): string {
  if (!totalSize || totalSize === "?") return "0 B";
  const totalBytes = parseSize(totalSize);
  const downloadedBytes = (percentage / 100) * totalBytes;
  return formatBytes(downloadedBytes);
}

/**
 * Clean up all artifacts related to a video download (temp files, partials, format streams)
 * @param baseFilename - The base filename to match (without extension)
 * @param directory - Optional directory to search in (defaults to VIDEOS_DIR)
 * @returns Array of deleted file paths
 */
export async function cleanupVideoArtifacts(
  baseFilename: string,
  directory: string = VIDEOS_DIR
): Promise<string[]> {
  const deletedFiles: string[] = [];

  try {
    if (!fs.existsSync(directory)) {
      return deletedFiles;
    }

    const files = fs.readdirSync(directory);
    
    // Filter files that start with the base filename and are likely download artifacts
    const artifactFiles = files.filter((file: string) => {
      if (!file.startsWith(baseFilename)) return false;
      
      // Always cleanup .part and .ytdl files
      if (file.endsWith(".part") || file.endsWith(".ytdl")) return true;
      
      // Cleanup intermediate format files (e.g., .f137.mp4, .f140.m4a, .temp.mp4)
      // yt-dlp often uses .f[format_id]. in filenames for intermediate streams
      if (/\.f[0-9]+/.test(file) || /\.temp\./.test(file)) return true;
      
      // Cleanup the main video file variants (mp4, mkv, webm, etc) if this is called during cleanup
      // This matches strictly files that share the base filename
      const ext = path.extname(file);
      const fileWithoutExt = path.basename(file, ext);
      if (fileWithoutExt === baseFilename) return true;
      
      return false;
    });

    for (const artifact of artifactFiles) {
      const artifactPath = path.join(directory, artifact);
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (fs.existsSync(artifactPath)) {
        await safeRemove(artifactPath);
        deletedFiles.push(artifactPath);
        console.log("Deleted artifact file:", artifactPath);
      }
    }
  } catch (error) {
    console.error("Error cleaning up video artifacts:", error);
  }

  return deletedFiles;
}

/**
 * Safely remove a file or directory with retries
 * Useful when processes might still be releasing locks
 */
export async function safeRemove(
  pathToRemove: string,
  retryCount: number = 3,
  initialDelay: number = 500
): Promise<void> {
  const resolvedPath = path.resolve(pathToRemove);
  if (
    !validatePathWithinDirectories(resolvedPath, SAFE_REMOVE_ALLOWED_DIRS)
  ) {
    console.error(
      "Refusing to remove path outside allowed directories:",
      sanitizeLogMessage(resolvedPath),
    );
    return;
  }

  // Initial delay to allow processes to release locks
  if (initialDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, initialDelay));
  }

  for (let i = 0; i < retryCount; i++) {
    try {
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (fs.existsSync(resolvedPath)) {
        await fs.remove(resolvedPath);
      }
      return;
    } catch (err) {
      if (i === retryCount - 1) {
        console.error(
          "Failed to remove path after retry attempts:",
          sanitizeLogMessage(resolvedPath),
          retryCount,
          err,
        );
      } else {
        // Linear backoff
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
}
