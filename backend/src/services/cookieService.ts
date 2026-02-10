import fs from "fs-extra";
import os from "os";
import path from "path";
import { DATA_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { logger } from "../utils/logger";
import { resolveSafePathInDirectories } from "../utils/security";

const COOKIES_PATH = path.join(DATA_DIR, "cookies.txt");
const TEMP_UPLOAD_DIRS = [os.tmpdir(), "/tmp"];

/**
 * Check if cookies file exists
 */
export function checkCookies(): { exists: boolean } {
  return { exists: fs.existsSync(COOKIES_PATH) };
}

/**
 * Upload cookies file
 * @param tempFilePath - Path to the temporary uploaded file
 */
export function uploadCookies(tempFilePath: string): void {
  try {
    const safeTempFilePath = resolveSafePathInDirectories(
      tempFilePath,
      TEMP_UPLOAD_DIRS
    );

    // Move the file to the target location
    fs.moveSync(safeTempFilePath, COOKIES_PATH, { overwrite: true });
    logger.info(`Cookies uploaded and saved to ${COOKIES_PATH}`);
  } catch (error: any) {
    // Clean up temp file if it exists
    try {
      const safeTempFilePath = resolveSafePathInDirectories(
        tempFilePath,
        TEMP_UPLOAD_DIRS
      );
      if (fs.existsSync(safeTempFilePath)) {
        fs.unlinkSync(safeTempFilePath);
      }
    } catch {
      // Ignore cleanup path validation failures.
    }
    throw error;
  }
}

/**
 * Delete cookies file
 */
export function deleteCookies(): void {
  if (fs.existsSync(COOKIES_PATH)) {
    fs.unlinkSync(COOKIES_PATH);
  } else {
    throw new NotFoundError("Cookies file", "cookies.txt");
  }
}

