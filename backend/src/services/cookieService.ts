import fs from "fs-extra";
import os from "os";
import path from "path";
import { DATA_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { logger } from "../utils/logger";
import { isPathWithinDirectories } from "../utils/security";

const COOKIES_PATH = path.join(DATA_DIR, "cookies.txt");
const TEMP_UPLOAD_DIRS = [os.tmpdir(), "/tmp"];
const RESOLVED_TEMP_UPLOAD_DIRS = TEMP_UPLOAD_DIRS.map((dir) => path.resolve(dir));

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
    const resolvedTempPath = path.resolve(tempFilePath);
    const isAllowedTempPath = isPathWithinDirectories(
      resolvedTempPath,
      RESOLVED_TEMP_UPLOAD_DIRS,
    );
    if (!isAllowedTempPath) {
      throw new ValidationError("Invalid temp file path", "file");
    }

    const targetPath = path.resolve(COOKIES_PATH);

    // Move the file to the target location
    fs.moveSync(resolvedTempPath, targetPath, { overwrite: true });
    logger.info(`Cookies uploaded and saved to ${targetPath}`);
  } catch (error: any) {
    // Clean up temp file if it exists
    try {
      const resolvedTempPath = path.resolve(tempFilePath);
      const isAllowedTempPath = isPathWithinDirectories(
        resolvedTempPath,
        RESOLVED_TEMP_UPLOAD_DIRS,
      );
      if (isAllowedTempPath && fs.existsSync(resolvedTempPath)) {
        fs.unlinkSync(resolvedTempPath);
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
  const safeCookiesPath = path.resolve(COOKIES_PATH);
  if (fs.existsSync(safeCookiesPath)) {
    fs.unlinkSync(safeCookiesPath);
  } else {
    throw new NotFoundError("Cookies file", "cookies.txt");
  }
}
