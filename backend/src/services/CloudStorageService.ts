import axios from "axios";
import { exec } from "child_process";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR } from "../config/paths";
import { FileError, NetworkError } from "../errors/DownloadErrors";
import { formatVideoFilename } from "../utils/helpers";
import { logger } from "../utils/logger";
import { getSettings, getVideos, saveVideo } from "./storageService";

interface CloudDriveConfig {
  enabled: boolean;
  apiUrl: string;
  token: string;
  publicUrl?: string;
  uploadPath: string;
}

interface CachedSignedUrl {
  url: string;
  timestamp: number;
  expiresAt: number;
}

interface CachedFileList {
  files: any[];
  timestamp: number;
}

// Cache for signed URLs: key is "filename:type", value is cached URL with expiration
const signedUrlCache = new Map<string, CachedSignedUrl>();

// Cache TTL: 5 minutes (signs typically expire after some time, but we refresh proactively)
const CACHE_TTL_MS = 5 * 60 * 1000;

// Cache for file list: key is uploadPath, value is file list with timestamp
const fileListCache = new Map<string, CachedFileList>();

// File list cache TTL: 1 minute
const FILE_LIST_CACHE_TTL_MS = 60 * 1000;

export class CloudStorageService {
  private static getConfig(): CloudDriveConfig {
    const settings = getSettings();
    return {
      enabled: settings.cloudDriveEnabled || false,
      apiUrl: settings.openListApiUrl || "",
      token: settings.openListToken || "",
      publicUrl: settings.openListPublicUrl || undefined,
      uploadPath: settings.cloudDrivePath || "/",
    };
  }

  static async uploadVideo(videoData: any): Promise<void> {
    const config = this.getConfig();
    if (!config.enabled || !config.apiUrl || !config.token) {
      return;
    }

    logger.info(`[CloudStorage] Starting upload for video: ${videoData.title}`);

    const uploadedFiles: string[] = []; // Track successfully uploaded files for deletion

    try {
      // Upload Video File
      if (videoData.videoPath) {
        const absoluteVideoPath = this.resolveAbsolutePath(videoData.videoPath);
        if (absoluteVideoPath && fs.existsSync(absoluteVideoPath)) {
          await this.uploadFile(absoluteVideoPath, config);
          uploadedFiles.push(absoluteVideoPath);
        } else {
          logger.error(
            `[CloudStorage] Video file not found: ${videoData.videoPath}`
          );
          // Don't throw - continue with other files
        }
      }

      // Upload Thumbnail
      if (videoData.thumbnailPath) {
        const absoluteThumbPath = this.resolveAbsolutePath(
          videoData.thumbnailPath
        );
        if (absoluteThumbPath && fs.existsSync(absoluteThumbPath)) {
          await this.uploadFile(absoluteThumbPath, config);
          uploadedFiles.push(absoluteThumbPath);
        }
      }

      // Upload Metadata (JSON)
      const metadata = {
        title: videoData.title,
        description: videoData.description,
        author: videoData.author,
        sourceUrl: videoData.sourceUrl,
        tags: videoData.tags,
        createdAt: videoData.createdAt,
        ...videoData,
      };

      // Keep metadata filename consistent with thumbnail and video filename
      const metadataFileName = videoData.thumbnailFilename
        ? videoData.thumbnailFilename
            .replace(".jpg", ".json")
            .replace(".png", ".json")
        : `${this.sanitizeFilename(videoData.title)}.json`;
      const metadataPath = path.join(
        process.cwd(),
        "temp_metadata",
        metadataFileName
      );
      fs.ensureDirSync(path.dirname(metadataPath));
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      await this.uploadFile(metadataPath, config);

      // Cleanup temp metadata (always delete temp file)
      fs.unlinkSync(metadataPath);

      logger.info(`[CloudStorage] Upload completed for: ${videoData.title}`);

      // Delete local files after successful upload and update video record to point to cloud storage
      if (uploadedFiles.length > 0) {
        logger.info(
          `[CloudStorage] Deleting ${uploadedFiles.length} local file(s) after successful upload...`
        );

        // Track which files were successfully deleted
        const deletedFiles: string[] = [];
        for (const filePath of uploadedFiles) {
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              deletedFiles.push(filePath);
              logger.info(`[CloudStorage] Deleted local file: ${filePath}`);
            }
          } catch (deleteError: any) {
            logger.error(
              `[CloudStorage] Failed to delete local file ${filePath}:`,
              deleteError instanceof Error
                ? deleteError
                : new Error(deleteError.message)
            );
            // Don't throw - continue with other files
          }
        }
        logger.info(`[CloudStorage] Local file cleanup completed`);

        // Update video record to point to cloud storage (store only filename, not full URL with sign)
        // Sign will be retrieved dynamically when needed
        if (videoData.id && deletedFiles.length > 0) {
          try {
            const storageService = await import("./storageService");
            const updates: any = {};

            // Store cloud storage indicator in path format: "cloud:filename"
            // This allows us to identify cloud storage files and retrieve sign dynamically
            const videoFilename =
              videoData.videoFilename ||
              (videoData.videoPath ? path.basename(videoData.videoPath) : null);

            if (videoFilename) {
              updates.videoPath = `cloud:${videoFilename}`;
            }

            const thumbnailFilename =
              videoData.thumbnailFilename ||
              (videoData.thumbnailPath
                ? path.basename(videoData.thumbnailPath)
                : null);

            if (thumbnailFilename) {
              updates.thumbnailPath = `cloud:${thumbnailFilename}`;
            }

            if (Object.keys(updates).length > 0) {
              storageService.updateVideo(videoData.id, updates);
              logger.info(
                `[CloudStorage] Updated video record ${videoData.id} with cloud storage indicators`
              );

              // Clear cache for uploaded files to ensure fresh URLs
              if (videoFilename) {
                this.clearCache(videoFilename, "video");
              }
              if (thumbnailFilename) {
                this.clearCache(thumbnailFilename, "thumbnail");
              }
              // Also clear file list cache since new files were added
              const normalizedUploadPath = config.uploadPath.replace(
                /\\/g,
                "/"
              );
              const uploadPath = normalizedUploadPath.startsWith("/")
                ? normalizedUploadPath
                : `/${normalizedUploadPath}`;
              fileListCache.delete(uploadPath);
            }
          } catch (updateError: any) {
            logger.error(
              `[CloudStorage] Failed to update video record with cloud paths:`,
              updateError instanceof Error
                ? updateError
                : new Error(updateError.message)
            );
            // Don't throw - file deletion was successful
          }
        }
      }
    } catch (error) {
      logger.error(
        `[CloudStorage] Upload failed for ${videoData.title}:`,
        error instanceof Error ? error : new Error(String(error))
      );
      // If upload failed, don't delete local files
    }
  }

  private static resolveAbsolutePath(relativePath: string): string | null {
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

  private static async uploadFile(
    filePath: string,
    config: CloudDriveConfig,
    remotePath?: string
  ): Promise<void> {
    // 1. Get basic file information
    const fileStat = fs.statSync(filePath);
    const fileSize = fileStat.size;
    const lastModified = fileStat.mtime.getTime().toString(); // Get millisecond timestamp
    const fileStream = fs.createReadStream(filePath);
    const fileName = path.basename(filePath);

    // 2. Prepare request URL and path
    // URL is always a fixed PUT endpoint
    const url = config.apiUrl; // Assume apiUrl is http://127.0.0.1:5244/api/fs/put

    // Destination path logic
    const normalizedUploadPath = config.uploadPath.replace(/\\/g, "/");
    let destinationPath = "";

    if (remotePath) {
      // If remotePath is provided, append it to uploadPath
      // remotePath should be relative to uploadPath, e.g. "subdir/file.jpg" or "file.jpg"
      const normalizedRemotePath = remotePath.replace(/\\/g, "/");
      destinationPath = normalizedUploadPath.endsWith("/")
        ? `${normalizedUploadPath}${normalizedRemotePath}`
        : `${normalizedUploadPath}/${normalizedRemotePath}`;
    } else {
      // Default behavior: upload to root of uploadPath using source filename
      destinationPath = normalizedUploadPath.endsWith("/")
        ? `${normalizedUploadPath}${fileName}`
        : `${normalizedUploadPath}/${fileName}`;
    }

    // Ensure it starts with /
    destinationPath = destinationPath.startsWith("/")
      ? destinationPath
      : `/${destinationPath}`;

    logger.info(
      `[CloudStorage] Uploading ${fileName} to ${destinationPath} (${fileSize} bytes)...`
    );

    logger.debug(
      `[CloudStorage] Destination path in header: ${destinationPath}`
    );

    // 3. Prepare Headers
    const headers = {
      // Key fix #1: Destination path is passed in Header
      "file-path": encodeURI(destinationPath), // Alist expects this header, needs encoding

      // Key fix #2: Authorization Header does not have 'Bearer ' prefix
      Authorization: config.token,

      // Key fix #3: Include Last-Modified Header
      "Last-Modified": lastModified,

      // Other Headers
      "Content-Type": "application/octet-stream", // Use generic stream type
      "Content-Length": fileSize.toString(),
    };

    try {
      // 4. Send PUT request, note that URL is fixed
      const response = await axios.put(url, fileStream, {
        headers: headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      // 5. Check if the returned JSON Body indicates real success
      if (response.data && response.data.code === 200) {
        logger.info(
          `[CloudStorage] Successfully uploaded ${fileName}. Server message: ${response.data.message}`
        );
      } else {
        // Even if HTTP status code is 200, server may return business errors
        const errorMessage = response.data
          ? response.data.message
          : "Unknown server error after upload";
        throw NetworkError.withStatus(
          `Upload failed on server: ${errorMessage} (Code: ${response.data?.code})`,
          response.status || 500
        );
      }
    } catch (error: any) {
      // Error handling logic
      if (error.response) {
        // HTTP error response
        const statusCode = error.response.status;
        logger.error(
          `[CloudStorage] HTTP Error: ${statusCode}`,
          new Error(JSON.stringify(error.response.data))
        );
        throw NetworkError.withStatus(
          `Upload failed: ${error.message}`,
          statusCode
        );
      } else if (error.request) {
        // Request was made but no response received
        logger.error("[CloudStorage] Network Error: No response received.");
        throw NetworkError.timeout();
      } else if (error.code === "ENOENT") {
        // File not found
        throw FileError.notFound(filePath);
      } else {
        // Other errors
        logger.error(
          "[CloudStorage] Upload Error:",
          error instanceof Error ? error : new Error(error.message)
        );
        throw FileError.writeError(filePath, error.message);
      }
    }
  }

  private static sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  }

  // Inflight requests for getSignedUrl: key is "filename:type", value is Promise<string | null>
  // Used for request coalescing to prevent duplicate concurrent API calls
  private static inflightRequests = new Map<string, Promise<string | null>>();

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
    fileType: "video" | "thumbnail" = "video"
  ): Promise<string | null> {
    const config = this.getConfig();
    if (!config.enabled || !config.apiUrl || !config.token) {
      return null;
    }

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
    if (this.inflightRequests.has(cacheKey)) {
      logger.debug(
        `[CloudStorage] Joining inflight request for ${filename} (${fileType})`
      );
      return this.inflightRequests.get(cacheKey)!;
    }

    // Cache miss or expired, fetch from OpenList
    const promise = (async () => {
      try {
        const result = await this.getFileUrlsWithSign(
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
        this.inflightRequests.delete(cacheKey);
      }
    })();

    this.inflightRequests.set(cacheKey, promise);
    return promise;
  }

  /**
   * Clear cache for a specific file or all files
   * @param filename - Optional filename to clear specific cache entry
   * @param fileType - Optional file type to clear specific cache entry
   */
  static clearCache(filename?: string, fileType?: "video" | "thumbnail"): void {
    if (filename && fileType) {
      const cacheKey = `${filename}:${fileType}`;
      signedUrlCache.delete(cacheKey);
      logger.debug(`[CloudStorage] Cleared cache for ${cacheKey}`);
    } else {
      signedUrlCache.clear();
      fileListCache.clear();
      logger.debug("[CloudStorage] Cleared all caches");
    }
  }

  /**
   * Get file list from OpenList with caching
   * @param config - Cloud drive configuration
   * @param uploadPath - Upload path to list files from
   */
  private static async getFileList(
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
  private static async getFilesRecursively(
    config: CloudDriveConfig,
    uploadPath: string,
    allFiles: Array<{ file: any; path: string }> = []
  ): Promise<Array<{ file: any; path: string }>> {
    try {
      const files = await this.getFileList(config, uploadPath);

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
          await this.getFilesRecursively(config, normalizedFilePath, allFiles);
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
   * Get file URLs with sign information from Openlist
   * Returns URLs in format: https://domain/d/path/filename?sign=xxx
   */
  private static async getFileUrlsWithSign(
    config: CloudDriveConfig,
    videoFilename?: string,
    thumbnailFilename?: string
  ): Promise<{
    videoUrl?: string;
    thumbnailUrl?: string;
    thumbnailThumbUrl?: string;
  }> {
    try {
      // Normalize upload path (root)
      const normalizedUploadPath = config.uploadPath.replace(/\\/g, "/");
      const baseUploadPath = normalizedUploadPath.startsWith("/")
        ? normalizedUploadPath
        : `/${normalizedUploadPath}`;

      const result: {
        videoUrl?: string;
        thumbnailUrl?: string;
        thumbnailThumbUrl?: string;
      } = {};

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

        const files = await this.getFileList(config, listPath);
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
   * Scan cloud storage for videos not in database (Two-way Sync)
   * @param onProgress - Optional callback for progress updates
   * @returns Report with added count and errors
   */
  static async scanCloudFiles(
    onProgress?: (message: string, current?: number, total?: number) => void
  ): Promise<{
    added: number;
    errors: string[];
  }> {
    const config = this.getConfig();
    if (!config.enabled || !config.apiUrl || !config.token) {
      logger.info("[CloudStorage] Cloud storage not configured, skipping scan");
      return { added: 0, errors: [] };
    }

    logger.info("[CloudStorage] Starting cloud file scan...");
    onProgress?.("Scanning cloud storage for videos...");

    try {
      // Normalize upload path
      const normalizedUploadPath = config.uploadPath.replace(/\\/g, "/");
      const uploadPath = normalizedUploadPath.startsWith("/")
        ? normalizedUploadPath
        : `/${normalizedUploadPath}`;

      // Recursively get all files from cloud storage
      const allCloudFiles = await this.getFilesRecursively(config, uploadPath);

      // Filter for video files
      const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov"];
      const videoFiles = allCloudFiles.filter(({ file }) => {
        const ext = path.extname(file.name).toLowerCase();
        return videoExtensions.includes(ext);
      });

      logger.info(
        `[CloudStorage] Found ${videoFiles.length} video files in cloud storage`
      );
      onProgress?.(
        `Found ${videoFiles.length} video files in cloud storage`,
        0,
        videoFiles.length
      );

      // Get existing videos from database
      const existingVideos = getVideos();
      const existingFilenames = new Set<string>();
      const existingPaths = new Set<string>();
      for (const video of existingVideos) {
        if (video.videoFilename) {
          existingFilenames.add(video.videoFilename);
        }
        // Also check by full path for cloud videos
        if (video.videoPath && video.videoPath.startsWith("cloud:")) {
          const cloudPath = video.videoPath.substring(6); // Remove "cloud:" prefix
          existingPaths.add(cloudPath);
        }
      }

      // Find videos not in database
      // Check both by filename and by full path to handle subdirectories correctly
      const newVideos = videoFiles.filter(({ file, path: filePath }) => {
        // Remove leading slash and normalize path relative to upload root
        const normalizedPath = filePath.startsWith("/")
          ? filePath.substring(1)
          : filePath;
        // Check if this exact path exists
        if (existingPaths.has(normalizedPath)) {
          return false;
        }
        // Also check by filename (for backward compatibility)
        return !existingFilenames.has(file.name);
      });

      logger.info(
        `[CloudStorage] Found ${newVideos.length} new videos to add to database`
      );

      let added = 0;
      const errors: string[] = [];

      // Process each new video
      for (let i = 0; i < newVideos.length; i++) {
        const { file, path: filePath } = newVideos[i];
        const filename = file.name;

        onProgress?.(`Processing: ${filename}`, i + 1, newVideos.length);

        try {
          // Get signed URL for video
          // Try to get signed URL using the standard method first
          let videoSignedUrl = await this.getSignedUrl(filename, "video");

          // If not found and file has sign property (for files in subdirectories), construct URL directly
          if (!videoSignedUrl && file.sign) {
            const domain =
              config.publicUrl || config.apiUrl.replace("/api/fs/put", "");
            // filePath is the full path from upload root (e.g., /mytube-uploads/subfolder/video.mp4)
            videoSignedUrl = `${domain}/d${filePath}?sign=${encodeURIComponent(
              file.sign
            )}`;
            logger.debug(
              `[CloudStorage] Using file sign for ${filename} from path ${filePath}`
            );
          }

          if (!videoSignedUrl) {
            errors.push(`${filename}: Failed to get signed URL`);
            logger.error(
              `[CloudStorage] Failed to get signed URL for ${filename}`
            );
            continue;
          }

          // Extract title from filename
          const originalTitle = path.parse(filename).name;
          const author = "Cloud Admin";
          const dateString = new Date()
            .toISOString()
            .split("T")[0]
            .replace(/-/g, "");

          // Format filename (same as local scan)
          const baseFilename = formatVideoFilename(
            originalTitle,
            author,
            dateString
          );
          const videoExtension = path.extname(filename);
          // newVideoFilename is just for reference or local temp usage
          // The actual cloud path is preserved from the source
          const newThumbnailFilename = `${baseFilename}.jpg`;

          // Generate thumbnail from video using signed URL
          // Download video temporarily to generate thumbnail
          // Note: ffmpeg can work with URLs, but we'll download a small portion
          const tempThumbnailPath = path.join(
            IMAGES_DIR,
            `temp_${Date.now()}_${path.parse(filename).name}.jpg`
          );

          // Determine remote thumbnail path (put it in the same folder as video)
          // filePath is the full path from upload root (e.g., /mytube-uploads/subdir/video.mp4)
          // We need to extract the relative directory path
          const normalizedFilePath = filePath.startsWith("/")
            ? filePath.substring(1)
            : filePath;
          const videoDir = path.dirname(normalizedFilePath);
          // If videoDir is "." it means root, otherwise it's the subdirectory path
          const remoteThumbnailDir = videoDir === "." ? "" : videoDir;
          const remoteThumbnailPath = remoteThumbnailDir
            ? `${remoteThumbnailDir}/${newThumbnailFilename}`
            : newThumbnailFilename;

          // Ensure directory exists
          fs.ensureDirSync(path.dirname(tempThumbnailPath));

          // Generate thumbnail using ffmpeg with signed URL
          // ffmpeg can work with HTTP URLs directly
          await new Promise<void>((resolve, reject) => {
            exec(
              `ffmpeg -i "${videoSignedUrl}" -ss 00:00:00 -vframes 1 "${tempThumbnailPath}" -y`,
              { timeout: 30000 }, // 30 second timeout
              (error) => {
                if (error) {
                  logger.error(
                    `[CloudStorage] Error generating thumbnail for ${filename}:`,
                    error
                  );
                  reject(error);
                } else {
                  resolve();
                }
              }
            );
          });

          // Upload thumbnail to cloud storage (with correct filename and location)
          if (fs.existsSync(tempThumbnailPath)) {
            // New uploadFile signature or logic needed here?
            // Actually, we can just pass the desired destination path to uploadFile if we refactor it
            // Or we can manually construct the full local path if it was a local file,
            // but here we have a temp file we want to put in a specific remote location.
            // Let's assume uploadFile takes an optional remotePath.
            await this.uploadFile(
              tempThumbnailPath,
              config,
              remoteThumbnailPath
            );

            // Cleanup temp thumbnail after upload
            fs.unlinkSync(tempThumbnailPath);
          }

          // Get duration
          let duration: string | undefined = undefined;
          try {
            const durationOutput = await new Promise<string>(
              (resolve, reject) => {
                exec(
                  `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoSignedUrl}"`,
                  { timeout: 10000 },
                  (error, stdout, _stderr) => {
                    if (error) {
                      reject(error);
                    } else {
                      resolve(stdout.trim());
                    }
                  }
                );
              }
            );
            if (durationOutput) {
              const durationSec = parseFloat(durationOutput);
              if (!isNaN(durationSec)) {
                duration = Math.round(durationSec).toString();
              }
            }
          } catch (err) {
            logger.error(
              `[CloudStorage] Error getting duration for ${filename}:`,
              err
            );
            // Continue without duration
          }

          // Create video record
          const videoId = (
            Date.now() + Math.floor(Math.random() * 10000)
          ).toString();

          const newVideo = {
            id: videoId,
            title: originalTitle || "Untitled Video",
            author: author,
            source: "cloud",
            sourceUrl: "",
            videoFilename: filename, // Keep original filename
            // Store path relative to upload root (remove leading slash if present)
            videoPath: `cloud:${normalizedFilePath}`, // Store relative path (e.g., mytube-uploads/subdir/video.mp4)
            thumbnailFilename: newThumbnailFilename,
            thumbnailPath: `cloud:${remoteThumbnailPath}`, // Store relative path
            thumbnailUrl: `cloud:${remoteThumbnailPath}`,
            createdAt: file.modified
              ? new Date(file.modified).toISOString()
              : new Date().toISOString(),
            addedAt: new Date().toISOString(),
            date: dateString,
            duration: duration,
          };

          saveVideo(newVideo);
          added++;

          logger.info(
            `[CloudStorage] Added video to database: ${newVideo.title} (${filePath})`
          );

          // Clear cache for the new files
          // Use normalized paths (relative to upload root) for cache keys
          this.clearCache(normalizedFilePath, "video");
          this.clearCache(remoteThumbnailPath, "thumbnail");

          // Also clear file list cache for the directory where thumbnail was added
          const normalizedUploadPath = config.uploadPath.replace(/\\/g, "/");
          const baseUploadPath = normalizedUploadPath.startsWith("/")
            ? normalizedUploadPath
            : `/${normalizedUploadPath}`;
          const dirPath = remoteThumbnailDir
            ? `${baseUploadPath}/${remoteThumbnailDir}`
            : baseUploadPath;
          // Normalize path (remove duplicate slashes)
          const cleanDirPath = dirPath.replace(/\/+/g, "/");
          fileListCache.delete(cleanDirPath);
        } catch (error: any) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          errors.push(`${filename}: ${errorMessage}`);
          logger.error(
            `[CloudStorage] Failed to process video ${filename}:`,
            error instanceof Error ? error : new Error(errorMessage)
          );
        }
      }

      logger.info(
        `[CloudStorage] Cloud scan completed: ${added} added, ${errors.length} errors`
      );
      onProgress?.(
        `Scan completed: ${added} added, ${errors.length} errors`,
        newVideos.length,
        newVideos.length
      );

      return { added, errors };
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        "[CloudStorage] Cloud scan failed:",
        error instanceof Error ? error : new Error(errorMessage)
      );
      onProgress?.("Scan failed: " + errorMessage);
      return { added: 0, errors: [errorMessage] };
    }
  }
}
