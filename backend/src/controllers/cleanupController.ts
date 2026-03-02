import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { VIDEOS_DIR } from "../config/paths";
import { ValidationError } from "../errors/DownloadErrors";
import * as storageService from "../services/storageService";
import { logger } from "../utils/logger";

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
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Check for temp_ folder
          if (entry.name.startsWith("temp_")) {
            try {
              await fs.remove(fullPath);
              deletedCount++;
              logger.debug(`Deleted temp directory: ${fullPath}`);
            } catch (error) {
              const errorMsg = `Failed to delete directory ${fullPath}: ${
                error instanceof Error ? error.message : String(error)
              }`;
              logger.warn(errorMsg);
              errors.push(errorMsg);
            }
          } else {
            // Recursively clean subdirectories
            await cleanupDirectory(fullPath);
          }
        } else if (entry.isFile()) {
          // Check if file has .ytdl or .part extension
          if (entry.name.endsWith(".ytdl") || entry.name.endsWith(".part")) {
            try {
              // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
              await fs.unlink(fullPath);
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
