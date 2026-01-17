/**
 * Path resolution and filename utilities
 */

import fs from "fs-extra";
import path from "path";
import { logger } from "../../utils/logger";
import { validatePathWithinDirectory } from "../../utils/security";

/**
 * Resolve absolute path from relative path
 * Handles multiple possible root directories for backward compatibility
 * Validates input to prevent path traversal attacks
 */
export function resolveAbsolutePath(relativePath: string): string | null {
  logger.debug("resolveAbsolutePath input:", relativePath);

  // Validate input to prevent path traversal
  if (!relativePath || typeof relativePath !== "string") {
    logger.warn("Invalid relativePath provided to resolveAbsolutePath");
    return null;
  }

  // Check for path traversal attempts
  if (relativePath.includes("..") || relativePath.includes("\0")) {
    logger.warn("Path traversal detected in relativePath:", relativePath);
    return null;
  }

  const cleanRelative = relativePath.startsWith("/")
    ? relativePath.slice(1)
    : relativePath;
  logger.debug("cleanRelative:", cleanRelative);
  
  // Additional validation after cleaning
  if (cleanRelative.includes("..") || cleanRelative.includes("\0")) {
    logger.warn("Path traversal detected in cleanRelative:", cleanRelative);
    return null;
  }

  // Key fix: uploadsBase should not add 'backend'
  const uploadsBase = path.join(process.cwd(), "uploads");
  logger.debug("uploadsBase:", uploadsBase);

  if (cleanRelative.startsWith("videos/")) {
    const fullPath = path.join(uploadsBase, cleanRelative);
    logger.debug("Trying uploads videos path:", fullPath);
    // Validate path is within uploadsBase to prevent path traversal
    if (validatePathWithinDirectory(fullPath, uploadsBase) && fs.existsSync(fullPath)) {
      logger.debug("Found video file at:", fullPath);
      return fullPath;
    }
    logger.debug("Video path does not exist or is invalid:", fullPath);
  }
  if (cleanRelative.startsWith("images/")) {
    const fullPath = path.join(uploadsBase, cleanRelative);
    logger.debug("Trying uploads images path:", fullPath);
    // Validate path is within uploadsBase to prevent path traversal
    if (validatePathWithinDirectory(fullPath, uploadsBase) && fs.existsSync(fullPath)) {
      logger.debug("Found image file at:", fullPath);
      return fullPath;
    }
    logger.debug("Image path does not exist or is invalid:", fullPath);
  }
  if (cleanRelative.startsWith("subtitles/")) {
    const fullPath = path.join(uploadsBase, cleanRelative);
    logger.debug("Trying uploads subtitles path:", fullPath);
    // Validate path is within uploadsBase to prevent path traversal
    if (validatePathWithinDirectory(fullPath, uploadsBase) && fs.existsSync(fullPath)) {
      logger.debug("Found subtitle file at:", fullPath);
      return fullPath;
    }
    logger.debug("Subtitle path does not exist or is invalid:", fullPath);
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
      // Validate path is within root to prevent path traversal
      if (validatePathWithinDirectory(fullPath, root) && fs.existsSync(fullPath)) {
        logger.debug("Found file in data root:", fullPath);
        return fullPath;
      }
      logger.debug("File not found in data root or path traversal detected:", fullPath);
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
