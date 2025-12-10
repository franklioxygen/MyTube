/**
 * Utility functions for download operations
 */

import fs from "fs-extra";
import path from "path";
import { VIDEOS_DIR } from "../config/paths";
import * as storageService from "../services/storageService";

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
 * Check if download was cancelled and throw error if so
 * @param downloadId - The download ID to check
 * @param message - Optional custom error message
 * @throws Error if download was cancelled
 */
export function throwIfCancelled(
  downloadId?: string,
  message: string = "Download cancelled by user"
): void {
  if (!isDownloadActive(downloadId)) {
    throw new Error(message);
  }
}

/**
 * Check if an error is a cancellation error
 * @param error - The error to check
 * @returns true if the error indicates cancellation
 */
export function isCancellationError(error: any): boolean {
  if (!error) return false;

  return (
    error.code === 143 ||
    error.message?.includes("killed") ||
    error.message?.includes("SIGTERM") ||
    error.code === "SIGTERM" ||
    error.message?.includes("Download cancelled by user") ||
    error.message?.includes("cancelled")
  );
}

/**
 * Clean up subtitle files (.vtt) from VIDEOS_DIR that match a base filename
 * @param baseFilename - The base filename to match (e.g., "video_123")
 * @param directory - Optional directory to search in (defaults to VIDEOS_DIR)
 * @returns Array of deleted file paths
 */
export function cleanupSubtitleFiles(
  baseFilename: string,
  directory: string = VIDEOS_DIR
): string[] {
  const deletedFiles: string[] = [];

  try {
    if (!fs.existsSync(directory)) {
      return deletedFiles;
    }

    const files = fs.readdirSync(directory);
    const subtitleFiles = files.filter(
      (file: string) => file.startsWith(baseFilename) && file.endsWith(".vtt")
    );

    for (const subtitleFile of subtitleFiles) {
      const subtitlePath = path.join(directory, subtitleFile);
      if (fs.existsSync(subtitlePath)) {
        fs.unlinkSync(subtitlePath);
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
export function cleanupTemporaryFiles(videoPath: string): string[] {
  const deletedFiles: string[] = [];

  try {
    const videoDir = path.dirname(videoPath);
    const videoBasename = path.basename(videoPath);

    if (!fs.existsSync(videoDir)) {
      return deletedFiles;
    }

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
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        deletedFiles.push(tempFilePath);
        console.log("Deleted temporary file:", tempFilePath);
      }
    }

    // Also check for the main video file if it exists (partial download)
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
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
export function cleanupPartialVideoFiles(videoPath: string): string[] {
  const deletedFiles: string[] = [];

  try {
    const partVideoPath = `${videoPath}.part`;

    if (fs.existsSync(partVideoPath)) {
      fs.unlinkSync(partVideoPath);
      deletedFiles.push(partVideoPath);
      console.log("Deleted partial video file:", partVideoPath);
    }

    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
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
