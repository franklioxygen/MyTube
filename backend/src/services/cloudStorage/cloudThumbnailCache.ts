/**
 * Local cache for cloud storage thumbnails
 * Caches thumbnails locally to reduce cloud storage API calls
 */

import axios from "axios";
import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import { CLOUD_THUMBNAIL_CACHE_DIR, IMAGES_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import {
  copySafe,
  pathExistsSafeSync,
  pathExistsTrustedSync,
  readdirSafeSync,
  resolveSafeChildPath,
  statSafeSync,
  unlinkSafeSync,
  validateCloudThumbnailCachePath,
  validateUrl,
  writeFileSafe,
} from "../../utils/security";

const CACHE_COPY_SOURCE_ALLOWED_DIRS = [
  CLOUD_THUMBNAIL_CACHE_DIR,
  IMAGES_DIR,
];

// Ensure cache directory exists
fs.ensureDirSync(CLOUD_THUMBNAIL_CACHE_DIR);

/**
 * Generate cache key from cloud storage path
 * Uses SHA-256 hash to create safe filename
 */
function getCacheKey(cloudPath: string): string {
  const hash = crypto.createHash("sha256").update(cloudPath).digest("hex");
  return `${hash}.jpg`;
}

/**
 * Get cache file path for a cloud storage thumbnail path
 */
function getCacheFilePath(cloudPath: string): string {
  const cacheKey = getCacheKey(cloudPath);
  return resolveSafeChildPath(CLOUD_THUMBNAIL_CACHE_DIR, cacheKey);
}

/**
 * Check if thumbnail exists in local cache
 * @param cloudPath - Cloud storage path (e.g., "cloud:a/movies/video/thumb.jpg")
 * @returns Cache file path if exists, null otherwise
 */
export function getCachedThumbnail(cloudPath: string): string | null {
  if (!cloudPath || !cloudPath.startsWith("cloud:")) {
    return null;
  }

  const cachePath = getCacheFilePath(cloudPath);

  if (pathExistsSafeSync(cachePath, CLOUD_THUMBNAIL_CACHE_DIR)) {
    logger.debug(`[CloudThumbnailCache] Cache hit for ${cloudPath}`);
    return cachePath;
  }

  logger.debug(`[CloudThumbnailCache] Cache miss for ${cloudPath}`);
  return null;
}

/**
 * Save thumbnail to local cache
 * @param cloudPath - Cloud storage path (e.g., "cloud:a/movies/video/thumb.jpg")
 * @param thumbnailData - Buffer or file path of thumbnail
 */
export async function saveThumbnailToCache(
  cloudPath: string,
  thumbnailData: Buffer | string
): Promise<void> {
  if (!cloudPath || !cloudPath.startsWith("cloud:")) {
    return;
  }

  try {
    const cachePath = validateCloudThumbnailCachePath(getCacheFilePath(cloudPath));

    // Ensure directory exists
    fs.ensureDirSync(path.dirname(cachePath));

    if (typeof thumbnailData === "string") {
      // If it's a file path, copy it
      if (pathExistsSafeSync(cachePath, CLOUD_THUMBNAIL_CACHE_DIR)) {
        // File already exists, skip
        return;
      }
      await copySafe(
        thumbnailData,
        CACHE_COPY_SOURCE_ALLOWED_DIRS,
        cachePath,
        CLOUD_THUMBNAIL_CACHE_DIR
      );
    } else {
      // If it's a buffer, write it
      await writeFileSafe(cachePath, CLOUD_THUMBNAIL_CACHE_DIR, thumbnailData);
    }

    logger.debug(`[CloudThumbnailCache] Cached thumbnail for ${cloudPath}`);
  } catch (error) {
    logger.error(
      `[CloudThumbnailCache] Failed to cache thumbnail for ${cloudPath}:`,
      error
    );
    // Don't throw - caching is optional
  }
}

/**
 * Download thumbnail from cloud storage and cache it
 * @param cloudPath - Cloud storage path (e.g., "cloud:a/movies/video/thumb.jpg")
 * @param signedUrl - Signed URL to download thumbnail from
 * @returns Local cache file path
 */
export async function downloadAndCacheThumbnail(
  cloudPath: string,
  signedUrl: string
): Promise<string | null> {
  if (!cloudPath || !cloudPath.startsWith("cloud:")) {
    return null;
  }

  try {
    // Double-check cache (in case it was cached between controller check and this call)
    const cached = getCachedThumbnail(cloudPath);
    if (cached) {
      logger.debug(
        `[CloudThumbnailCache] Thumbnail was cached while downloading: ${cloudPath}`
      );
      return cached;
    }

    // Download from cloud
    logger.debug(
      `[CloudThumbnailCache] Downloading thumbnail from cloud: ${cloudPath}`
    );

    const validatedUrl = validateUrl(signedUrl);

    const response = await axios.get(validatedUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    // Validate response data
    if (!response.data || response.data.length === 0) {
      logger.error(
        `[CloudThumbnailCache] Empty response when downloading thumbnail for ${cloudPath}`
      );
      return null;
    }

    const cachePath = validateCloudThumbnailCachePath(getCacheFilePath(cloudPath));

    // Ensure directory exists
    fs.ensureDirSync(path.dirname(cachePath));

    await writeFileSafe(
      cachePath,
      CLOUD_THUMBNAIL_CACHE_DIR,
      Buffer.from(response.data)
    );

    logger.info(
      `[CloudThumbnailCache] Successfully downloaded and cached thumbnail for ${cloudPath}`
    );
    return cachePath;
  } catch (error) {
    logger.error(
      `[CloudThumbnailCache] Failed to download and cache thumbnail for ${cloudPath}:`,
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }
}

/**
 * Clear cache for a specific thumbnail or all thumbnails
 * @param cloudPath - Optional cloud storage path to clear specific cache entry
 */
export function clearThumbnailCache(cloudPath?: string): void {
  try {
    if (cloudPath) {
      const cachePath = getCacheFilePath(cloudPath);
      if (pathExistsSafeSync(cachePath, CLOUD_THUMBNAIL_CACHE_DIR)) {
        unlinkSafeSync(cachePath, CLOUD_THUMBNAIL_CACHE_DIR);
        logger.debug(`[CloudThumbnailCache] Cleared cache for ${cloudPath}`);
      }
    } else {
      // Clear all cache
      const files = readdirSafeSync(
        CLOUD_THUMBNAIL_CACHE_DIR,
        CLOUD_THUMBNAIL_CACHE_DIR
      );
      for (const file of files) {
        const filePath = resolveSafeChildPath(CLOUD_THUMBNAIL_CACHE_DIR, file);
        if (statSafeSync(filePath, CLOUD_THUMBNAIL_CACHE_DIR).isFile()) {
          unlinkSafeSync(filePath, CLOUD_THUMBNAIL_CACHE_DIR);
        }
      }
      logger.debug(`[CloudThumbnailCache] Cleared all cache`);
    }
  } catch (error) {
    logger.error(`[CloudThumbnailCache] Failed to clear cache:`, error);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { count: number; size: number } {
  try {
    if (!pathExistsTrustedSync(CLOUD_THUMBNAIL_CACHE_DIR)) {
      return { count: 0, size: 0 };
    }

    const files = readdirSafeSync(
      CLOUD_THUMBNAIL_CACHE_DIR,
      CLOUD_THUMBNAIL_CACHE_DIR
    );
    let totalSize = 0;
    let fileCount = 0;

    for (const file of files) {
      const filePath = resolveSafeChildPath(CLOUD_THUMBNAIL_CACHE_DIR, file);
      const stats = statSafeSync(filePath, CLOUD_THUMBNAIL_CACHE_DIR);
      if (stats.isFile()) {
        totalSize += stats.size;
        fileCount++;
      }
    }

    return { count: fileCount, size: totalSize };
  } catch (error) {
    logger.error(`[CloudThumbnailCache] Failed to get cache stats:`, error);
    return { count: 0, size: 0 };
  }
}
