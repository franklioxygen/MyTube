import { Request, Response } from "express";
import { VIDEOS_DIR } from "../config/paths";
import { ValidationError } from "../errors/DownloadErrors";
import * as storageService from "../services/storageService";
import { createArtifactReferenceGuard } from "../services/storageService/artifactReferences";
import { logger } from "../utils/logger";
import {
  readdirDirentsSafe,
  resolveSafeChildPath,
  unlinkSafeSync,
} from "../utils/security";

/**
 * Clean up temporary download files (.ytdl, .part)
 * Errors are automatically handled by asyncHandler middleware
 */
export const cleanupTempFiles = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Check if there are active downloads
  const downloadStatus = storageService.getDownloadStatus();
  if (downloadStatus.activeDownloads.length > 0) {
    throw new ValidationError(
      `Cannot clean up while downloads are active (${downloadStatus.activeDownloads.length} active)`,
      "activeDownloads"
    );
  }

  let deletedCount = 0;
  const errors: string[] = [];

  // Recursively find and delete .ytdl and .part files
  const cleanupDirectory = async (dir: string) => {
    try {
      const entries = await readdirDirentsSafe(dir, VIDEOS_DIR);

      for (const entry of entries) {
        const fullPath = resolveSafeChildPath(dir, entry.name);

        if (entry.isDirectory()) {
          // A temp_ prefix is also a valid author/template directory. Without
          // a job-owned manifest it does not establish that a folder is trash.
          await cleanupDirectory(fullPath);
        } else if (entry.isFile()) {
          // Check if file has .ytdl or .part extension
          if (entry.name.endsWith(".ytdl") || entry.name.endsWith(".part")) {
            try {
              // Recheck after asynchronous traversal, then inspect owners and
              // unlink synchronously so another request cannot start a download
              // or register this artifact between the check and deletion.
              if (storageService.getDownloadStatus().activeDownloads.length > 0) {
                throw new Error("Downloads became active during cleanup");
              }
              const isReferenced = createArtifactReferenceGuard(storageService.getVideosStrict());
              if (isReferenced(fullPath)) continue;
              unlinkSafeSync(fullPath, VIDEOS_DIR);
              deletedCount++;
              logger.debug(`Deleted temp file: ${fullPath}`);
            } catch (error) {
              const errorMsg = `Failed to delete ${fullPath}: ${
                error instanceof Error ? error.message : String(error)
              }`;
              logger.warn(errorMsg);
              errors.push(errorMsg);
            }
          }
        }
      }
    } catch (error) {
      const errorMsg = `Failed to read directory ${dir}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMsg);
      errors.push(errorMsg);
    }
  };

  // Start cleanup from VIDEOS_DIR
  await cleanupDirectory(VIDEOS_DIR);

  // Return format expected by frontend: { deletedCount, errors? }
  res.status(200).json({
    deletedCount,
    ...(errors.length > 0 && { errors }),
  });
};
