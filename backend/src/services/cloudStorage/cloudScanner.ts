/**
 * Cloud storage scanning operations
 */

import { exec } from "child_process";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR } from "../../config/paths";
import { formatVideoFilename } from "../../utils/helpers";
import { logger } from "../../utils/logger";
import { getVideos, saveVideo } from "../storageService";
import { clearFileListCache, getFilesRecursively } from "./fileLister";
import { uploadFile } from "./fileUploader";
import { normalizeUploadPath } from "./pathUtils";
import { CloudDriveConfig, ScanResult } from "./types";
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
    // Normalize upload path
    const uploadPath = normalizeUploadPath(config.uploadPath);

    // Recursively get all files from cloud storage
    const allCloudFiles = await getFilesRecursively(config, uploadPath);

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
        // file.path is the full path from upload root (e.g., /a/b/Youtube/video/1.mp4) or relative path depending on alist version
        // We normalize everything to be safe

        // 1. Get the upload root path
        const uploadRoot = normalizeUploadPath(config.uploadPath);

        // 2. Ensure filePath is absolute-like for path.relative calculation if it isn't already
        // path.relative works best when both are absolute or both relative
        // We treats them as absolute paths rooted at /
        const absoluteUploadRoot = uploadRoot.startsWith("/")
          ? uploadRoot
          : "/" + uploadRoot;
        const absoluteFilePath = filePath.startsWith("/")
          ? filePath
          : "/" + filePath;

        // 3. Calculate relative path from upload root to the file
        // e.g. from "/a/b/Youtube" to "/a/b/Youtube/video/1.mp4" -> "video/1.mp4"
        const relativeFilePath = path.relative(
          absoluteUploadRoot,
          absoluteFilePath
        );

        // 4. Get the directory of the video file relative to upload root
        // e.g. "video"
        const relativeVideoDir = path.dirname(relativeFilePath);

        // 5. Construct thumbnail path
        // If dir is root ".", relativeVideoDir is "."
        const remoteThumbnailDir =
          relativeVideoDir === "." ? "" : relativeVideoDir;
        const remoteThumbnailPath = remoteThumbnailDir
          ? path
              .join(remoteThumbnailDir, newThumbnailFilename)
              .replace(/\\/g, "/")
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
          await uploadFile(tempThumbnailPath, config, remoteThumbnailPath);

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

        // Store path relative to upload root
        // relativeFilePath was already calculated above using path.relative
        // e.g. "video/1.mp4" from "/a/b/Youtube" to "/a/b/Youtube/video/1.mp4"
        // Just ensure it is normalized to forward slashes
        const relativeVideoPath = relativeFilePath.replace(/\\/g, "/");

        const newVideo = {
          id: videoId,
          title: originalTitle || "Untitled Video",
          author: author,
          source: "cloud",
          sourceUrl: "",
          videoFilename: filename, // Keep original filename
          // Store path relative to upload root (e.g., video/1.mp4, not a/b/Youtube/video/1.mp4)
          videoPath: `cloud:${relativeVideoPath}`,
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
        // Use relative paths (relative to upload root) for cache keys
        clearSignedUrlCache(relativeVideoPath, "video");
        clearSignedUrlCache(remoteThumbnailPath, "thumbnail");

        // Also clear file list cache for the directory where thumbnail was added
        const baseUploadPath = normalizeUploadPath(config.uploadPath);
        const dirPath = remoteThumbnailDir
          ? `${baseUploadPath}/${remoteThumbnailDir}`
          : baseUploadPath;
        // Normalize path (remove duplicate slashes)
        const cleanDirPath = dirPath.replace(/\/+/g, "/");
        clearFileListCache(cleanDirPath);
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
