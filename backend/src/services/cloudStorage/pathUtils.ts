/**
 * Path resolution and filename utilities
 */

import path from "path";
import { logger } from "../../utils/logger";
import {
  pathExistsSafeSync,
  resolveSafeChildPath,
  validateUrlWithAllowlist,
} from "../../utils/security";

const CLOUD_API_PUT_PATH = "/api/fs/put";

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

  const resolveManagedPath = (root: string): string | null => {
    try {
      const fullPath = resolveSafeChildPath(root, cleanRelative);
      if (pathExistsSafeSync(fullPath, root)) {
        return fullPath;
      }
    } catch (error) {
      logger.warn("Rejected unsafe managed path", error);
    }
    return null;
  };

  if (cleanRelative.startsWith("videos/")) {
    const fullPath = resolveManagedPath(uploadsBase);
    if (fullPath) {
      logger.debug("Found video file at:", fullPath);
      return fullPath;
    }
    logger.debug("Video path does not exist or is invalid:", cleanRelative);
  }
  if (cleanRelative.startsWith("images/")) {
    const fullPath = resolveManagedPath(uploadsBase);
    if (fullPath) {
      logger.debug("Found image file at:", fullPath);
      return fullPath;
    }
    logger.debug("Image path does not exist or is invalid:", cleanRelative);
  }
  if (cleanRelative.startsWith("subtitles/")) {
    const fullPath = resolveManagedPath(uploadsBase);
    if (fullPath) {
      logger.debug("Found subtitle file at:", fullPath);
      return fullPath;
    }
    logger.debug("Subtitle path does not exist or is invalid:", cleanRelative);
  }

  // Old data directory logic (backward compatibility)
  const possibleRoots = [
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "..", "data"),
    path.join(__dirname, "..", "..", "..", "data"),
  ];
  for (const root of possibleRoots) {
    logger.debug("Checking data root:", root);
    const fullPath = resolveManagedPath(root);
    if (fullPath) {
      logger.debug("Found file in data root:", fullPath);
      return fullPath;
    }
    logger.debug("File not found in data root:", root, cleanRelative);
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

function parseValidatedCloudApiUrl(apiUrl: string): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw new Error(`Invalid cloud API URL: ${apiUrl}`);
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("Cloud API URL must not contain credentials");
  }

  const validatedUrl = validateUrlWithAllowlist(apiUrl, [parsedUrl.hostname]);
  const validatedParsedUrl = new URL(validatedUrl);

  if (!validatedParsedUrl.pathname.endsWith(CLOUD_API_PUT_PATH)) {
    throw new Error(
      `Cloud API URL must end with ${CLOUD_API_PUT_PATH}: ${apiUrl}`,
    );
  }

  return validatedParsedUrl;
}

export function validateCloudApiUrl(apiUrl: string): string {
  return parseValidatedCloudApiUrl(apiUrl).toString();
}

export function buildCloudApiEndpoint(
  apiUrl: string,
  endpointPath: string,
): string {
  const parsedUrl = parseValidatedCloudApiUrl(apiUrl);
  const normalizedEndpointPath = endpointPath.startsWith("/")
    ? endpointPath
    : `/${endpointPath}`;
  const cloudApiBasePath = parsedUrl.pathname.slice(
    0,
    -CLOUD_API_PUT_PATH.length,
  );
  const endpointUrl = new URL(parsedUrl.origin);
  endpointUrl.pathname = `${cloudApiBasePath}${normalizedEndpointPath}`;
  endpointUrl.search = "";
  endpointUrl.hash = "";

  return validateUrlWithAllowlist(endpointUrl.toString(), [parsedUrl.hostname]);
}
