/**
 * Signed URL retrieval and caching
 */

import path from "path";
import { logger } from "../../utils/logger";
import { CloudDriveConfig, CachedSignedUrl, FileUrlsResult, FileType } from "./types";
import { getFileList } from "./fileLister";
import { normalizeUploadPath } from "./pathUtils";

// Cache for signed URLs: key is "filename:type", value is cached URL with expiration
const signedUrlCache = new Map<string, CachedSignedUrl>();

// Cache TTL: 5 minutes (signs typically expire after some time, but we refresh proactively)
const CACHE_TTL_MS = 5 * 60 * 1000;

// Inflight requests for getSignedUrl: key is "filename:type", value is Promise<string | null>
// Used for request coalescing to prevent duplicate concurrent API calls
const inflightRequests = new Map<string, Promise<string | null>>();

/**
 * Get file URLs with sign information from Openlist
 * Returns URLs in format: https://domain/d/path/filename?sign=xxx
 */
async function getFileUrlsWithSign(
  config: CloudDriveConfig,
  videoFilename?: string,
  thumbnailFilename?: string
): Promise<FileUrlsResult> {
  try {
    // Normalize upload path (root)
    const normalizedUploadPath = normalizeUploadPath(config.uploadPath);
    const baseUploadPath = normalizedUploadPath;

    const result: FileUrlsResult = {};

    const apiBaseUrl = config.apiUrl.replace("/api/fs/put", "");
    // Use publicUrl if set, otherwise extract domain from apiBaseUrl
    const domain = config.publicUrl || apiBaseUrl;

    // Helper to find file in its directory
    const findFileInDir = async (fullRelativePath: string): Promise<any> => {
      // fullRelativePath is e.g. "subdir/video.mp4" or "video.mp4"
      const dirName = path.dirname(fullRelativePath);
      const fileName = path.basename(fullRelativePath);

      // Determine the full path to list
      // If dirName is ".", lookup path is just baseUploadPath
      // If dirName is "subdir", lookup path is baseUploadPath/subdir
      let listPath = baseUploadPath;
      if (dirName !== ".") {
        const normalizedDir = dirName.replace(/\\/g, "/");
        listPath = baseUploadPath.endsWith("/")
          ? `${baseUploadPath}${normalizedDir}`
          : `${baseUploadPath}/${normalizedDir}`;
      }

      const files = await getFileList(config, listPath);
      return files.find((f: any) => f.name === fileName);
    };

    // Find video file
    if (videoFilename) {
      const videoFile = await findFileInDir(videoFilename);

      if (videoFile && videoFile.sign) {
        // Build URL: https://domain/d/path/files/filename?sign=xxx
        // We need to construct the full web path including subdirectory
        // If videoFilename is "subdir/video.mp4", the path in URL should include /subdir/
        // The Alist pattern seems to be /d/mount_path/subdir/filename

        // Let's ensure proper path concatenation
        const relativeDirObj = path.parse(videoFilename);
        const relativeDir = relativeDirObj.dir; // "subdir" or ""
        const name = relativeDirObj.base; // "video.mp4"

        let fullWebPathLines = [baseUploadPath];
        if (relativeDir && relativeDir !== ".") {
          fullWebPathLines.push(relativeDir.replace(/\\/g, "/"));
        }
        fullWebPathLines.push(name);

        // Join and cleanup double slashes
        const fullWebPath = fullWebPathLines.join("/").replace(/\/+/g, "/");

        result.videoUrl = `${domain}/d${fullWebPath}?sign=${encodeURIComponent(
          videoFile.sign
        )}`;
      }
    }

    // Find thumbnail file
    if (thumbnailFilename) {
      const thumbnailFile = await findFileInDir(thumbnailFilename);

      if (thumbnailFile) {
        // Construct full path for URL same as video
        const relativeDirObj = path.parse(thumbnailFilename);
        const relativeDir = relativeDirObj.dir;
        const name = relativeDirObj.base;

        let fullWebPathLines = [baseUploadPath];
        if (relativeDir && relativeDir !== ".") {
          fullWebPathLines.push(relativeDir.replace(/\\/g, "/"));
        }
        fullWebPathLines.push(name);
        const fullWebPath = fullWebPathLines.join("/").replace(/\/+/g, "/");

        // Prefer file URL with sign if available
        if (thumbnailFile.sign) {
          result.thumbnailUrl = `${domain}/d${fullWebPath}?sign=${encodeURIComponent(
            thumbnailFile.sign
          )}`;
        }

        // If file doesn't have sign but has thumb URL, use thumb URL
        // Also check if no thumbnail file exists but video file has thumb
        if (thumbnailFile.thumb) {
          // ... existing thumb logic ...
          let thumbUrl = thumbnailFile.thumb;
          thumbUrl = thumbUrl.replace(
            /width=\d+[&\\u0026]height=\d+/,
            "width=1280&height=720"
          );
          thumbUrl = thumbUrl.replace(/\\u0026/g, "&");
          if (config.publicUrl) {
            try {
              const thumbUrlObj = new URL(thumbUrl);
              const publicUrlObj = new URL(config.publicUrl);
              thumbUrl = thumbUrl.replace(
                thumbUrlObj.origin,
                publicUrlObj.origin
              );
            } catch (e) {
              logger.debug(
                `[CloudStorage] Failed to replace domain: ${thumbUrl}`
              );
            }
          }
          result.thumbnailThumbUrl = thumbUrl;
        }
      } else {
        // Fallback: Check if video file has thumb (if thumbnail file itself wasn't found)
        // This is useful if we generated "cloud:video.jpg" but it doesn't exist yet or failed,
        // but maybe the video file "cloud:video.mp4" has a generated thumb from the server side.
        if (videoFilename) {
          const videoFile = await findFileInDir(videoFilename);
          if (videoFile && videoFile.thumb) {
            let thumbUrl = videoFile.thumb;
            thumbUrl = thumbUrl.replace(
              /width=\d+[&\\u0026]height=\d+/,
              "width=1280&height=720"
            );
            thumbUrl = thumbUrl.replace(/\\u0026/g, "&");
            if (config.publicUrl) {
              try {
                const thumbUrlObj = new URL(thumbUrl);
                const publicUrlObj = new URL(config.publicUrl);
                thumbUrl = thumbUrl.replace(
                  thumbUrlObj.origin,
                  publicUrlObj.origin
                );
              } catch (e) {
                logger.debug(
                  `[CloudStorage] Failed to replace domain: ${thumbUrl}`
                );
              }
            }
            result.thumbnailThumbUrl = thumbUrl;
          }
        }
      }
    }

    return result;
  } catch (error: any) {
    logger.error(
      `[CloudStorage] Failed to get file URLs with sign:`,
      error instanceof Error ? error : new Error(String(error))
    );
    return {};
  }
}

/**
 * Get signed URL for a cloud storage file
 * Returns URL in format: https://domain/d/path/filename?sign=xxx
 * Uses caching to reduce OpenList API calls
 * Implements request coalescing to handle concurrent requests
 * @param filename - The filename to get signed URL for
 * @param fileType - 'video' or 'thumbnail'
 * @param config - Cloud drive configuration
 */
export async function getSignedUrl(
  filename: string,
  fileType: FileType,
  config: CloudDriveConfig
): Promise<string | null> {
  // Check cache first
  const cacheKey = `${filename}:${fileType}`;
  const cached = signedUrlCache.get(cacheKey);
  const now = Date.now();

  if (cached && now < cached.expiresAt) {
    logger.debug(
      `[CloudStorage] Using cached signed URL for ${filename} (${fileType})`
    );
    return cached.url;
  }

  // Check if there's already an inflight request for this file
  if (inflightRequests.has(cacheKey)) {
    logger.debug(
      `[CloudStorage] Joining inflight request for ${filename} (${fileType})`
    );
    return inflightRequests.get(cacheKey)!;
  }

  // Cache miss or expired, fetch from OpenList
  const promise = (async () => {
    try {
      const result = await getFileUrlsWithSign(
        config,
        fileType === "video" ? filename : undefined,
        fileType === "thumbnail" ? filename : undefined
      );

      let url: string | null = null;
      if (fileType === "video") {
        url = result.videoUrl || null;
      } else {
        url = result.thumbnailUrl || result.thumbnailThumbUrl || null;
      }

      // Cache the result if we got a URL
      if (url) {
        signedUrlCache.set(cacheKey, {
          url,
          timestamp: Date.now(),
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        logger.debug(
          `[CloudStorage] Cached signed URL for ${filename} (${fileType})`
        );
      }

      return url;
    } catch (error) {
      logger.error(
        `[CloudStorage] Failed to get signed URL for ${filename}:`,
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    } finally {
      // Remove from inflight requests when done
      inflightRequests.delete(cacheKey);
    }
  })();

  inflightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Clear cache for a specific file or all files
 * @param filename - Optional filename to clear specific cache entry
 * @param fileType - Optional file type to clear specific cache entry
 */
export function clearSignedUrlCache(
  filename?: string,
  fileType?: FileType
): void {
  if (filename && fileType) {
    const cacheKey = `${filename}:${fileType}`;
    signedUrlCache.delete(cacheKey);
    logger.debug(`[CloudStorage] Cleared cache for ${cacheKey}`);
  } else {
    signedUrlCache.clear();
    logger.debug("[CloudStorage] Cleared all signed URL caches");
  }
}

