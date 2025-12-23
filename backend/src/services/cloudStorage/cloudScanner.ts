/**
 * Cloud storage scanning operations
 */

import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR } from "../../config/paths";
import { formatVideoFilename } from "../../utils/helpers";
import { logger } from "../../utils/logger";
import { execFileSafe, validateImagePath, validateUrl } from "../../utils/security";
import { getVideos, saveVideo } from "../storageService";
import { clearFileListCache, getFilesRecursively } from "./fileLister";
import { uploadFile } from "./fileUploader";
import { normalizeUploadPath } from "./pathUtils";
import { CloudDriveConfig, FileWithPath, ScanResult } from "./types";
import { clearSignedUrlCache, getSignedUrl } from "./urlSigner";

/**
 * Scan cloud storage for videos not in database (Two-way Sync)
 * @param config - Cloud drive configuration
 * @param onProgress - Optional callback for progress updates
 * @returns Report with added count and errors
 */
export async function scanCloudFiles(
  config: CloudDriveConfig,
  onProgress?: (message: string, current?: number, total?: number) => void
): Promise<ScanResult> {
  logger.info("[CloudStorage] Starting cloud file scan...");
  onProgress?.("Scanning cloud storage for videos...");

  try {
    // Determine which paths to scan
    // Always scan the default uploadPath
    // If scanPaths is provided, scan those as well
    const uploadRoot = normalizeUploadPath(config.uploadPath);
    const pathsToScan: string[] = [uploadRoot];

    if (config.scanPaths && config.scanPaths.length > 0) {
      const additionalPaths = config.scanPaths.map((path) =>
        normalizeUploadPath(path)
      );
      // Avoid duplicates
      for (const path of additionalPaths) {
        if (!pathsToScan.includes(path)) {
          pathsToScan.push(path);
        }
      }
    }

    logger.info(
      `[CloudStorage] Scanning ${
        pathsToScan.length
      } path(s): ${pathsToScan.join(", ")}`
    );

    // Recursively get all files from all scan paths
    const allCloudFiles: FileWithPath[] = [];
    for (const scanPath of pathsToScan) {
      logger.info(`[CloudStorage] Scanning path: ${scanPath}`);
      const filesFromPath = await getFilesRecursively(config, scanPath);
      allCloudFiles.push(...filesFromPath);
      logger.info(
        `[CloudStorage] Found ${filesFromPath.length} files in ${scanPath}`
      );
    }

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
      
      // Also check by calculated relative path (for backward compatibility with uploadPath files)
      // This is important because for files in uploadPath, we store them relative to uploadPath
      // But here filePath is absolute/relative to root
      
      // Calculate what the storage path WOULD be for this file
      let potentialStoragePath: string;
      const absoluteFilePath = filePath.startsWith("/") ? filePath : "/" + filePath;
      const absoluteUploadRoot = uploadRoot.startsWith("/") ? uploadRoot : "/" + uploadRoot;
      
      if (absoluteFilePath.startsWith(absoluteUploadRoot)) {
        // It's in the upload path, so it would be stored relative to that
        const relativePath = path.relative(absoluteUploadRoot, absoluteFilePath);
        potentialStoragePath = relativePath.replace(/\\/g, "/");
      } else {
        // It's NOT in the upload path, so it would be stored as full path (without leading slash)
        potentialStoragePath = absoluteFilePath.substring(1);
      }
      
      if (existingPaths.has(potentialStoragePath)) {
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
        let videoSignedUrl = await getSignedUrl(filename, "video", config);

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
        // filePath is the full absolute path (e.g., /a/movies/video/1.mp4)
        // We want to put the thumbnail in the same directory as the video

        // 1. Normalize filePath to ensure it's an absolute path
        const absoluteFilePath = filePath.startsWith("/")
          ? filePath
          : "/" + filePath;

        // 2. Get the directory of the video file
        const videoDir = path.dirname(absoluteFilePath).replace(/\\/g, "/");

        // 3. Construct thumbnail path in the same directory as video
        const remoteThumbnailPath = videoDir.endsWith("/")
          ? `${videoDir}${newThumbnailFilename}`
          : `${videoDir}/${newThumbnailFilename}`;

        // 4. Calculate relative path for video storage in database
        // logic: if file is in uploadPath, use relative path; otherwise use full path
        let relativeVideoPath: string;
        
        // Ensure uploadRoot is absolute for comparison
        const absoluteUploadRoot = uploadRoot.startsWith("/") ? uploadRoot : "/" + uploadRoot;
        
        if (absoluteFilePath.startsWith(absoluteUploadRoot)) {
            // It IS in the default upload path (or a subdir of it)
            // Calculate relative path from uploadRoot
            const relativePath = path.relative(absoluteUploadRoot, absoluteFilePath);
            relativeVideoPath = relativePath.replace(/\\/g, "/");
        } else {
             // It is NOT in the default upload path (must be from one of the scanPaths)
             // Use the full path relative to root
             relativeVideoPath = absoluteFilePath.substring(1);
        }

        // Ensure directory exists
        fs.ensureDirSync(path.dirname(tempThumbnailPath));

        // Validate paths and URL to prevent command injection and SSRF
        const validatedThumbnailPath = validateImagePath(tempThumbnailPath);
        const validatedVideoUrl = validateUrl(videoSignedUrl);

        // Generate thumbnail using ffmpeg with signed URL
        // ffmpeg can work with HTTP URLs directly
        try {
          await execFileSafe("ffmpeg", [
            "-i", validatedVideoUrl,
            "-ss", "00:00:00",
            "-vframes", "1",
            validatedThumbnailPath,
            "-y"
          ], { timeout: 30000 });
        } catch (error) {
          logger.error(
            `[CloudStorage] Error generating thumbnail for ${filename}:`,
            error
          );
          throw error;
        }

        // Upload thumbnail to cloud storage (with correct filename and location)
        // remoteThumbnailPath is a full absolute path (e.g., /a/movies/video/thumbnail.jpg)
        // uploadFile now supports absolute paths, so we can pass it directly
        // uploadFile will check if file already exists before uploading
        let relativeThumbnailPath: string | undefined = undefined;
        if (fs.existsSync(tempThumbnailPath)) {
          const uploadResult = await uploadFile(tempThumbnailPath, config, remoteThumbnailPath);
          
          if (uploadResult.skipped) {
            logger.info(
              `[CloudStorage] Thumbnail ${newThumbnailFilename} already exists in cloud storage, skipping upload`
            );
          }

          // Cleanup temp thumbnail after upload (or skip)
          fs.unlinkSync(tempThumbnailPath);
          
          // Calculate relative thumbnail path for database storage (same format as video path)
          // If video is in uploadPath, use relative path; otherwise use full path without leading slash
          if (absoluteFilePath.startsWith(absoluteUploadRoot)) {
            // Video is in uploadPath, thumbnail should also be relative to uploadRoot
            const thumbnailRelativePath = path.relative(absoluteUploadRoot, remoteThumbnailPath);
            relativeThumbnailPath = thumbnailRelativePath.replace(/\\/g, "/");
          } else {
            // Video is in scanPath, thumbnail should also be absolute path without leading slash
            relativeThumbnailPath = remoteThumbnailPath.startsWith("/")
              ? remoteThumbnailPath.substring(1)
              : remoteThumbnailPath;
          }
        }

        // Get duration
        let duration: string | undefined = undefined;
        try {
          // Validate URL to prevent SSRF
          const validatedVideoUrlForDuration = validateUrl(videoSignedUrl);
          
          const { stdout } = await execFileSafe("ffprobe", [
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            validatedVideoUrlForDuration
          ], { timeout: 10000 });
          
          const durationOutput = stdout.trim();
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

        // relativeVideoPath was already calculated above
        // For scan paths: full path without leading slash (e.g., "a/movies/video/1.mp4")
        // For upload path: relative path (e.g., "video/1.mp4")

        const newVideo = {
          id: videoId,
          title: originalTitle || "Untitled Video",
          author: author,
          source: "cloud",
          sourceUrl: "",
          videoFilename: filename, // Keep original filename
          // Store path relative to root (e.g., "a/movies/video/1.mp4" or "video/1.mp4")
          videoPath: `cloud:${relativeVideoPath}`,
          thumbnailFilename: relativeThumbnailPath ? newThumbnailFilename : undefined,
          thumbnailPath: relativeThumbnailPath ? `cloud:${relativeThumbnailPath}` : undefined, // Store path in same format as video path
          thumbnailUrl: relativeThumbnailPath ? `cloud:${relativeThumbnailPath}` : undefined,
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
        // Use relative paths (relative to upload root) for cache keys
        clearSignedUrlCache(relativeVideoPath, "video");
        // For thumbnail cache, use the directory path
        const thumbnailDirForCache = path
          .dirname(remoteThumbnailPath)
          .replace(/\\/g, "/");
        clearSignedUrlCache(thumbnailDirForCache, "thumbnail");

        // Also clear file list cache for the directory where thumbnail was added
        // remoteThumbnailPath is an absolute path, so we can use it directly
        const thumbnailDir = path
          .dirname(remoteThumbnailPath)
          .replace(/\\/g, "/");
        clearFileListCache(thumbnailDir);
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      "[CloudStorage] Cloud scan failed:",
      error instanceof Error ? error : new Error(errorMessage)
    );
    onProgress?.("Scan failed: " + errorMessage);
    return { added: 0, errors: [errorMessage] };
  }
}
