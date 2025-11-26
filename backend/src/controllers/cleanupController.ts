import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { VIDEOS_DIR } from "../config/paths";
import * as storageService from "../services/storageService";

/**
 * Clean up temporary download files (.ytdl, .part)
 */
export const cleanupTempFiles = async (req: Request, res: Response): Promise<any> => {
  try {
    // Check if there are active downloads
    const downloadStatus = storageService.getDownloadStatus();
    if (downloadStatus.activeDownloads.length > 0) {
      return res.status(400).json({
        error: "Cannot clean up while downloads are active",
        activeDownloads: downloadStatus.activeDownloads.length,
      });
    }

    let deletedCount = 0;
    const errors: string[] = [];

    // Recursively find and delete .ytdl and .part files
    const cleanupDirectory = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Recursively clean subdirectories
            await cleanupDirectory(fullPath);
          } else if (entry.isFile()) {
            // Check if file has .ytdl or .part extension
            if (entry.name.endsWith('.ytdl') || entry.name.endsWith('.part')) {
              try {
                await fs.unlink(fullPath);
                deletedCount++;
                console.log(`Deleted temp file: ${fullPath}`);
              } catch (error) {
                const errorMsg = `Failed to delete ${fullPath}: ${error instanceof Error ? error.message : String(error)}`;
                console.error(errorMsg);
                errors.push(errorMsg);
              }
            }
          }
        }
      } catch (error) {
        const errorMsg = `Failed to read directory ${dir}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    };

    // Start cleanup from VIDEOS_DIR
    await cleanupDirectory(VIDEOS_DIR);

    res.status(200).json({
      success: true,
      deletedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error("Error cleaning up temp files:", error);
    res.status(500).json({
      error: "Failed to clean up temporary files",
      details: error.message,
    });
  }
};
