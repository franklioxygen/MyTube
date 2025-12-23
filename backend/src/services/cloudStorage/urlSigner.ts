/**
 * Signed URL retrieval and caching
 */

import path from "path";
import { logger } from "../../utils/logger";
import { getFileList } from "./fileLister";
import { normalizeUploadPath } from "./pathUtils";
import {
  CachedSignedUrl,
  CloudDriveConfig,
  FileType,
  FileUrlsResult,
} from "./types";

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
    // Returns { file: fileObject, foundPath: string } where foundPath is the directory where file was found
    // fullRelativePath can be:
    // - "video.mp4" (in uploadPath root, or just filename)
    // - "subdir/video.mp4" (in uploadPath/subdir)
    // - "a/movies/video.mp4" (in scanPath /a/movies, not in uploadPath)
    // - "/video.mp4" (absolute path, but might be just filename)
    const findFileInDir = async (
      fullRelativePath: string
    ): Promise<{ file: any; foundPath: string } | undefined> => {
      // Remove leading slash if present (for consistency)
      const cleanPath = fullRelativePath.startsWith("/")
        ? fullRelativePath.substring(1)
        : fullRelativePath;

      const dirName = path.dirname(cleanPath);
      const fileName = path.basename(cleanPath);

      // If dirName is ".", it means only filename was provided
      // We need to search in multiple possible locations (including subdirectories)
      if (dirName === ".") {
        // Helper function to recursively search for a file
        const searchRecursively = async (
          searchPath: string
        ): Promise<{ file: any; foundPath: string } | undefined> => {
          try {
            const files = await getFileList(config, searchPath);
            // Check current directory
            let foundFile = files.find(
              (f: any) => f.name === fileName && !f.is_dir
            );
            if (foundFile) {
              return { file: foundFile, foundPath: searchPath };
            }
            // Recursively search subdirectories
            for (const file of files) {
              if (file.is_dir) {
                const subDirPath = searchPath.endsWith("/")
                  ? `${searchPath}${file.name}`
                  : `${searchPath}/${file.name}`;
                const result = await searchRecursively(subDirPath);
                if (result) {
                  return result;
                }
              }
            }
            return undefined;
          } catch (error) {
            logger.debug(
              `[CloudStorage] Failed to search in path ${searchPath}:`,
              error
            );
            return undefined;
          }
        };

        // Try to find file in uploadPath first (recursively)
        let result = await searchRecursively(baseUploadPath);
        if (result) {
          return result;
        }

        // If not found in uploadPath, try scanPaths if configured (recursively)
        if (config.scanPaths && config.scanPaths.length > 0) {
          for (const scanPath of config.scanPaths) {
            const normalizedScanPath = normalizeUploadPath(scanPath);
            result = await searchRecursively(normalizedScanPath);
            if (result) {
              return result;
            }
          }
        }

        // Not found anywhere
        return undefined;
      }

      // Path contains directory information
      // First, try as relative path from uploadPath
      // If not found, try as absolute path (scanPath)
      const absoluteUploadRoot = baseUploadPath.startsWith("/")
        ? baseUploadPath
        : "/" + baseUploadPath;

      // Try 1: Treat as relative path from uploadPath
      const normalizedDir = dirName.replace(/\\/g, "/");
      let listPath = baseUploadPath.endsWith("/")
        ? `${baseUploadPath}${normalizedDir}`
        : `${baseUploadPath}/${normalizedDir}`;

      try {
        const files = await getFileList(config, listPath);
        const foundFile = files.find((f: any) => f.name === fileName);
        if (foundFile) {
          return { file: foundFile, foundPath: listPath };
        }
      } catch (error) {
        // If failed, try as absolute path (scanPath)
        logger.debug(
          `[CloudStorage] File not found in uploadPath subdirectory ${listPath}, trying as scanPath:`,
          error
        );
      }

      // If failed, try to find in scanPaths
      if (config.scanPaths && config.scanPaths.length > 0) {
        // Check if the path is already an absolute path starting with a scanPath
        const absoluteCleanPath = "/" + cleanPath;
        for (const scanPath of config.scanPaths) {
          try {
            const normalizedScanPath = normalizeUploadPath(scanPath);
            const absoluteScanPath = normalizedScanPath.startsWith("/")
              ? normalizedScanPath
              : "/" + normalizedScanPath;

            let listPath: string;

            // Check if the directory path starts with this scanPath
            const absoluteDirPath = "/" + normalizedDir;
            if (absoluteDirPath.startsWith(absoluteScanPath)) {
              // Path is already absolute and starts with this scanPath, use it directly
              listPath = absoluteDirPath;
            } else {
              // Path is relative to this scanPath, append it
              listPath = normalizedScanPath.endsWith("/")
                ? `${normalizedScanPath}${normalizedDir}`
                : `${normalizedScanPath}/${normalizedDir}`;
            }

            const files = await getFileList(config, listPath);
            const foundFile = files.find((f: any) => f.name === fileName);
            if (foundFile) {
              return { file: foundFile, foundPath: listPath };
            }
          } catch (error) {
            // Continue to next scanPath
            logger.debug(
              `[CloudStorage] Failed to search in scanPath ${scanPath}:`,
              error
            );
          }
        }
      }

      // Not found in either location
      return undefined;
    };

    // Find video file
    if (videoFilename) {
      const videoResult = await findFileInDir(videoFilename);

      if (videoResult && videoResult.file.sign) {
        // Build URL: https://domain/d/path/files/filename?sign=xxx
        // Use the actual path where file was found to construct URL
        const foundPath = videoResult.foundPath;
        const fileName = path.basename(videoFilename);
        const fullWebPath = foundPath.endsWith("/")
          ? `${foundPath}${fileName}`
          : `${foundPath}/${fileName}`;
        const normalizedWebPath = fullWebPath.replace(/\/+/g, "/");

        result.videoUrl = `${domain}/d${normalizedWebPath}?sign=${encodeURIComponent(
          videoResult.file.sign
        )}`;
      }
    }

    // Find thumbnail file
    if (thumbnailFilename) {
      const thumbnailResult = await findFileInDir(thumbnailFilename);

      if (thumbnailResult) {
        // Use the actual path where file was found to construct URL
        const foundPath = thumbnailResult.foundPath;
        const fileName = path.basename(thumbnailFilename);
        const fullWebPath = foundPath.endsWith("/")
          ? `${foundPath}${fileName}`
          : `${foundPath}/${fileName}`;
        const normalizedWebPath = fullWebPath.replace(/\/+/g, "/");

        // Prefer file URL with sign if available
        if (thumbnailResult.file.sign) {
          result.thumbnailUrl = `${domain}/d${normalizedWebPath}?sign=${encodeURIComponent(
            thumbnailResult.file.sign
          )}`;
        }

        // If file doesn't have sign but has thumb URL, use thumb URL
        // Also check if no thumbnail file exists but video file has thumb
        if (thumbnailResult.file.thumb) {
          // ... existing thumb logic ...
          let thumbUrl = thumbnailResult.file.thumb;
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
          const videoResult = await findFileInDir(videoFilename);
          if (videoResult && videoResult.file.thumb) {
            let thumbUrl = videoResult.file.thumb;
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
