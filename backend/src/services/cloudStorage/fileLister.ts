/**
 * File listing operations with caching
 */

import axios from "axios";
import path from "path";
import { logger } from "../../utils/logger";
import { CloudDriveConfig, CachedFileList, FileWithPath } from "./types";
import { normalizeUploadPath } from "./pathUtils";

// Cache for file list: key is uploadPath, value is file list with timestamp
const fileListCache = new Map<string, CachedFileList>();

// File list cache TTL: 1 minute
const FILE_LIST_CACHE_TTL_MS = 60 * 1000;

/**
 * Get file list from OpenList with caching
 * @param config - Cloud drive configuration
 * @param uploadPath - Upload path to list files from
 */
export async function getFileList(
  config: CloudDriveConfig,
  uploadPath: string
): Promise<any[]> {
  // Check cache first
  const cacheKey = uploadPath;
  const cached = fileListCache.get(cacheKey);
  const now = Date.now();

  if (cached && now < cached.timestamp + FILE_LIST_CACHE_TTL_MS) {
    logger.debug(
      `[CloudStorage] Using cached file list for path: ${uploadPath}`
    );
    return cached.files;
  }

  // Cache miss or expired, fetch from OpenList
  try {
    const apiBaseUrl = config.apiUrl.replace("/api/fs/put", "");
    const listUrl = `${apiBaseUrl}/api/fs/list`;

    const response = await axios.post(
      listUrl,
      {
        path: uploadPath,
        password: "",
        page: 1,
        per_page: 0,
        refresh: false,
      },
      {
        headers: {
          Authorization: config.token,
        },
      }
    );

    if (response.data?.code !== 200 || !response.data?.data?.content) {
      logger.error(
        `[CloudStorage] Failed to get file list: ${JSON.stringify(
          response.data
        )}`
      );
      return [];
    }

    const files = response.data.data.content;

    // Cache the result
    fileListCache.set(cacheKey, {
      files,
      timestamp: now,
    });
    logger.debug(`[CloudStorage] Cached file list for path: ${uploadPath}`);

    return files;
  } catch (error) {
    logger.error(
      `[CloudStorage] Failed to get file list:`,
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}

/**
 * Recursively get all files from cloud storage (including subdirectories)
 * @param config - Cloud drive configuration
 * @param uploadPath - Upload path to scan
 * @param allFiles - Accumulator for all files found
 */
export async function getFilesRecursively(
  config: CloudDriveConfig,
  uploadPath: string,
  allFiles: FileWithPath[] = []
): Promise<FileWithPath[]> {
  try {
    const files = await getFileList(config, uploadPath);

    for (const file of files) {
      // Normalize path
      const normalizedUploadPath = uploadPath.replace(/\\/g, "/");
      const filePath = normalizedUploadPath.endsWith("/")
        ? `${normalizedUploadPath}${file.name}`
        : `${normalizedUploadPath}/${file.name}`;
      const normalizedFilePath = filePath.startsWith("/")
        ? filePath
        : `/${filePath}`;

      if (file.is_dir) {
        // Recursively scan subdirectory
        await getFilesRecursively(config, normalizedFilePath, allFiles);
      } else {
        // Add file to results
        allFiles.push({ file, path: normalizedFilePath });
      }
    }

    return allFiles;
  } catch (error) {
    logger.error(
      `[CloudStorage] Failed to recursively get files from ${uploadPath}:`,
      error instanceof Error ? error : new Error(String(error))
    );
    return allFiles;
  }
}

/**
 * Clear file list cache for a specific path or all paths
 */
export function clearFileListCache(uploadPath?: string): void {
  if (uploadPath) {
    fileListCache.delete(uploadPath);
    logger.debug(`[CloudStorage] Cleared file list cache for ${uploadPath}`);
  } else {
    fileListCache.clear();
    logger.debug("[CloudStorage] Cleared all file list caches");
  }
}

