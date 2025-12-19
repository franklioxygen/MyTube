import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { FileError, NetworkError } from "../errors/DownloadErrors";
import { logger } from "../utils/logger";
import { getSettings } from "./storageService";

interface CloudDriveConfig {
  enabled: boolean;
  apiUrl: string;
  token: string;
  publicUrl?: string;
  uploadPath: string;
}

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
            if (videoData.videoFilename) {
              updates.videoPath = `cloud:${videoData.videoFilename}`;
            }

            if (videoData.thumbnailFilename) {
              updates.thumbnailPath = `cloud:${videoData.thumbnailFilename}`;
            }

            if (Object.keys(updates).length > 0) {
              storageService.updateVideo(videoData.id, updates);
              logger.info(
                `[CloudStorage] Updated video record ${videoData.id} with cloud storage indicators`
              );
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
    config: CloudDriveConfig
  ): Promise<void> {
    // 1. Get basic file information
    const fileName = path.basename(filePath);
    const fileStat = fs.statSync(filePath);
    const fileSize = fileStat.size;
    const lastModified = fileStat.mtime.getTime().toString(); // Get millisecond timestamp
    const fileStream = fs.createReadStream(filePath);

    logger.info(`[CloudStorage] Uploading ${fileName} (${fileSize} bytes)...`);

    // 2. Prepare request URL and path
    // URL is always a fixed PUT endpoint
    const url = config.apiUrl; // Assume apiUrl is http://127.0.0.1:5244/api/fs/put

    // Destination path is the combination of uploadPath and fileName
    // Normalize path separators to forward slashes for Alist (works on all platforms)
    const normalizedUploadPath = config.uploadPath.replace(/\\/g, "/");
    const normalizedPath = normalizedUploadPath.endsWith("/")
      ? `${normalizedUploadPath}${fileName}`
      : `${normalizedUploadPath}/${fileName}`;
    const destinationPath = normalizedPath.startsWith("/")
      ? normalizedPath
      : `/${normalizedPath}`;

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

  /**
   * Get signed URL for a cloud storage file
   * Returns URL in format: https://domain/d/path/filename?sign=xxx
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

    try {
      const result = await this.getFileUrlsWithSign(
        config,
        fileType === "video" ? filename : undefined,
        fileType === "thumbnail" ? filename : undefined
      );

      if (fileType === "video") {
        return result.videoUrl || null;
      } else {
        return result.thumbnailUrl || result.thumbnailThumbUrl || null;
      }
    } catch (error) {
      logger.error(
        `[CloudStorage] Failed to get signed URL for ${filename}:`,
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
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
      // Extract base URL from apiUrl (remove /api/fs/put)
      const apiBaseUrl = config.apiUrl.replace("/api/fs/put", "");
      const listUrl = `${apiBaseUrl}/api/fs/list`;

      // Normalize upload path
      const normalizedUploadPath = config.uploadPath.replace(/\\/g, "/");
      const uploadPath = normalizedUploadPath.startsWith("/")
        ? normalizedUploadPath
        : `/${normalizedUploadPath}`;

      // Call api/fs/list to get file list with sign information
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
        return {};
      }

      const files = response.data.data.content;
      const result: {
        videoUrl?: string;
        thumbnailUrl?: string;
        thumbnailThumbUrl?: string;
      } = {};

      // Use publicUrl if set, otherwise extract domain from apiBaseUrl
      // If publicUrl is set (e.g., https://cloudflare-tunnel-domain.com), use it for file URLs
      // Otherwise, use apiBaseUrl (e.g., http://127.0.0.1:5244)
      const domain = config.publicUrl || apiBaseUrl;

      // Find video file
      if (videoFilename) {
        const videoFile = files.find(
          (file: any) => file.name === videoFilename
        );
        if (videoFile && videoFile.sign) {
          // Build URL: https://domain/d/path/filename?sign=xxx
          // Only encode the filename, not the path
          const encodedFilename = encodeURIComponent(videoFilename);
          result.videoUrl = `${domain}/d${uploadPath}/${encodedFilename}?sign=${encodeURIComponent(
            videoFile.sign
          )}`;
        }
      }

      // Find thumbnail file
      if (thumbnailFilename) {
        const thumbnailFile = files.find(
          (file: any) => file.name === thumbnailFilename
        );
        if (thumbnailFile) {
          // Prefer file URL with sign if available
          if (thumbnailFile.sign) {
            // Build URL: https://domain/d/path/filename?sign=xxx
            const encodedFilename = encodeURIComponent(thumbnailFilename);
            result.thumbnailUrl = `${domain}/d${uploadPath}/${encodedFilename}?sign=${encodeURIComponent(
              thumbnailFile.sign
            )}`;
          }
          // If file doesn't have sign but has thumb URL, use thumb URL
          // Also check if no thumbnail file exists but video file has thumb
          if (thumbnailFile.thumb) {
            // Use thumb URL and modify resolution
            // Replace width=176&height=176 with width=1280&height=720
            let thumbUrl = thumbnailFile.thumb;
            thumbUrl = thumbUrl.replace(
              /width=\d+[&\\u0026]height=\d+/,
              "width=1280&height=720"
            );
            // Also handle \u0026 encoding
            thumbUrl = thumbUrl.replace(/\\u0026/g, "&");
            // If publicUrl is set, replace the domain in thumbUrl with publicUrl
            if (config.publicUrl) {
              try {
                const thumbUrlObj = new URL(thumbUrl);
                const publicUrlObj = new URL(config.publicUrl);
                thumbUrl = thumbUrl.replace(
                  thumbUrlObj.origin,
                  publicUrlObj.origin
                );
              } catch (e) {
                // If URL parsing fails, use thumbUrl as is
                logger.debug(
                  `[CloudStorage] Failed to replace domain in thumbUrl: ${thumbUrl}`
                );
              }
            }
            result.thumbnailThumbUrl = thumbUrl;
          }
        } else {
          // Thumbnail file not found, check if video file has thumb
          if (videoFilename) {
            const videoFile = files.find(
              (file: any) => file.name === videoFilename
            );
            if (videoFile && videoFile.thumb) {
              // Use video file's thumb URL and modify resolution
              let thumbUrl = videoFile.thumb;
              thumbUrl = thumbUrl.replace(
                /width=\d+[&\\u0026]height=\d+/,
                "width=1280&height=720"
              );
              thumbUrl = thumbUrl.replace(/\\u0026/g, "&");
              // If publicUrl is set, replace the domain in thumbUrl with publicUrl
              if (config.publicUrl) {
                try {
                  const thumbUrlObj = new URL(thumbUrl);
                  const publicUrlObj = new URL(config.publicUrl);
                  thumbUrl = thumbUrl.replace(
                    thumbUrlObj.origin,
                    publicUrlObj.origin
                  );
                } catch (e) {
                  // If URL parsing fails, use thumbUrl as is
                  logger.debug(
                    `[CloudStorage] Failed to replace domain in thumbUrl: ${thumbUrl}`
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
}
