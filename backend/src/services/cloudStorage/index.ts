/**
 * Main CloudStorageService - orchestrates cloud storage operations
 * This is a facade that delegates to specialized modules
 */

import { logger } from "../../utils/logger";
import { scanCloudFiles } from "./cloudScanner";
import { getConfig, isConfigured } from "./config";
import { clearFileListCache } from "./fileLister";
import { FileType, ScanResult } from "./types";
import { clearSignedUrlCache, getSignedUrl } from "./urlSigner";
import { uploadVideo as uploadVideoToCloud } from "./videoUploader";

export class CloudStorageService {
  /**
   * Upload video, thumbnail, and metadata to cloud storage
   * @param videoData - Video data object
   */
  static async uploadVideo(videoData: any): Promise<void> {
    const config = getConfig();
    if (!isConfigured(config)) {
      return;
    }

    await uploadVideoToCloud(videoData, config);
  }

  /**
   * Get signed URL for a cloud storage file
   * Returns URL in format: https://domain/d/path/filename?sign=xxx
   * Uses caching to reduce OpenList API calls
   * Implements request coalescing to handle concurrent requests
   * @param filename - The filename to get signed URL for
   * @param fileType - 'video' or 'thumbnail'
   */
  static async getSignedUrl(
    filename: string,
    fileType: FileType = "video"
  ): Promise<string | null> {
    const config = getConfig();
    if (!isConfigured(config)) {
      return null;
    }

    return getSignedUrl(filename, fileType, config);
  }

  /**
   * Clear cache for a specific file or all files
   * @param filename - Optional filename to clear specific cache entry
   * @param fileType - Optional file type to clear specific cache entry
   */
  static clearCache(filename?: string, fileType?: FileType): void {
    if (filename && fileType) {
      clearSignedUrlCache(filename, fileType);
    } else {
      clearSignedUrlCache();
      clearFileListCache();
    }
  }

  /**
   * Scan cloud storage for videos not in database (Two-way Sync)
   * @param onProgress - Optional callback for progress updates
   * @returns Report with added count and errors
   */
  static async scanCloudFiles(
    onProgress?: (message: string, current?: number, total?: number) => void
  ): Promise<ScanResult> {
    const config = getConfig();
    if (!isConfigured(config)) {
      logger.info("[CloudStorage] Cloud storage not configured, skipping scan");
      return { added: 0, errors: [] };
    }

    return scanCloudFiles(config, onProgress);
  }
}
