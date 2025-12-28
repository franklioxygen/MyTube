import fs from "fs-extra";
import path from "path";
import { DATA_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { logger } from "../utils/logger";

const COOKIES_PATH = path.join(DATA_DIR, "cookies.txt");

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
    // Move the file to the target location
    fs.moveSync(tempFilePath, COOKIES_PATH, { overwrite: true });
    logger.info(`Cookies uploaded and saved to ${COOKIES_PATH}`);
  } catch (error: any) {
    // Clean up temp file if it exists
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
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


