/**
 * Path resolution and filename utilities
 */

import fs from "fs-extra";
import path from "path";
import { logger } from "../../utils/logger";

/**
 * Resolve absolute path from relative path
 * Handles multiple possible root directories for backward compatibility
 */
export function resolveAbsolutePath(relativePath: string): string | null {
  logger.debug("resolveAbsolutePath input:", relativePath);

  const cleanRelative = relativePath.startsWith("/")
    ? relativePath.slice(1)
    : relativePath;
  logger.debug("cleanRelative:", cleanRelative);

  // Key fix: uploadsBase should not add 'backend'
  const uploadsBase = path.join(process.cwd(), "uploads");
  logger.debug("uploadsBase:", uploadsBase);

  if (cleanRelative.startsWith("videos/")) {
    const fullPath = path.join(uploadsBase, cleanRelative);
    logger.debug("Trying uploads videos path:", fullPath);
    if (fs.existsSync(fullPath)) {
      logger.debug("Found video file at:", fullPath);
      return fullPath;
    }
    logger.debug("Video path does not exist:", fullPath);
  }
  if (cleanRelative.startsWith("images/")) {
    const fullPath = path.join(uploadsBase, cleanRelative);
    logger.debug("Trying uploads images path:", fullPath);
    if (fs.existsSync(fullPath)) {
      logger.debug("Found image file at:", fullPath);
      return fullPath;
    }
    logger.debug("Image path does not exist:", fullPath);
  }
  if (cleanRelative.startsWith("subtitles/")) {
    const fullPath = path.join(uploadsBase, cleanRelative);
    logger.debug("Trying uploads subtitles path:", fullPath);
    if (fs.existsSync(fullPath)) {
      logger.debug("Found subtitle file at:", fullPath);
      return fullPath;
    }
    logger.debug("Subtitle path does not exist:", fullPath);
  }

  // Old data directory logic (backward compatibility)
  const possibleRoots = [
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "..", "data"),
    path.join(__dirname, "..", "..", "..", "data"),
  ];
  for (const root of possibleRoots) {
    logger.debug("Checking data root:", root);
    if (fs.existsSync(root)) {
      const fullPath = path.join(root, cleanRelative);
      logger.debug("Found data root directory, trying file:", fullPath);
      if (fs.existsSync(fullPath)) {
        logger.debug("Found file in data root:", fullPath);
        return fullPath;
      }
      logger.debug("File not found in data root:", fullPath);
    } else {
      logger.debug("Data root does not exist:", root);
    }
  }

  logger.debug("No matching absolute path found for:", relativePath);
  return null;
}

/**
 * Sanitize filename for safe storage
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

/**
 * Normalize upload path (ensure it starts with / and uses forward slashes)
 */
export function normalizeUploadPath(uploadPath: string): string {
  const normalized = uploadPath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}
