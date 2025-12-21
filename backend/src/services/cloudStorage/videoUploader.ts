/**
 * Video upload operations (handles video, thumbnail, and metadata uploads)
 */

import fs from "fs-extra";
import path from "path";
import { logger } from "../../utils/logger";
import { updateVideo } from "../storageService";
import { CloudDriveConfig, FileType } from "./types";
import { resolveAbsolutePath, sanitizeFilename } from "./pathUtils";
import { uploadFile } from "./fileUploader";
import { clearSignedUrlCache } from "./urlSigner";
import { clearFileListCache } from "./fileLister";
import { normalizeUploadPath } from "./pathUtils";

/**
 * Upload video, thumbnail, and metadata to cloud storage
 * @param videoData - Video data object
 * @param config - Cloud drive configuration
 */
export async function uploadVideo(
  videoData: any,
  config: CloudDriveConfig
): Promise<void> {
  logger.info(`[CloudStorage] Starting upload for video: ${videoData.title}`);

  const uploadedFiles: string[] = []; // Track successfully uploaded files for deletion

  try {
    // Upload Video File
    if (videoData.videoPath) {
      const absoluteVideoPath = resolveAbsolutePath(videoData.videoPath);
      if (absoluteVideoPath && fs.existsSync(absoluteVideoPath)) {
        await uploadFile(absoluteVideoPath, config);
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
      const absoluteThumbPath = resolveAbsolutePath(videoData.thumbnailPath);
      if (absoluteThumbPath && fs.existsSync(absoluteThumbPath)) {
        await uploadFile(absoluteThumbPath, config);
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
      : `${sanitizeFilename(videoData.title)}.json`;
    const metadataPath = path.join(
      process.cwd(),
      "temp_metadata",
      metadataFileName
    );
    fs.ensureDirSync(path.dirname(metadataPath));
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    await uploadFile(metadataPath, config);

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
            updateVideo(videoData.id, updates);
            logger.info(
              `[CloudStorage] Updated video record ${videoData.id} with cloud storage indicators`
            );

            // Clear cache for uploaded files to ensure fresh URLs
            if (videoFilename) {
              clearSignedUrlCache(videoFilename, "video");
            }
            if (thumbnailFilename) {
              clearSignedUrlCache(thumbnailFilename, "thumbnail");
            }
            // Also clear file list cache since new files were added
            const uploadPath = normalizeUploadPath(config.uploadPath);
            clearFileListCache(uploadPath);
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

