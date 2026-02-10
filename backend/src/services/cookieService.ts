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
 * @param fileBuffer - Uploaded file bytes
 */
export function uploadCookies(fileBuffer: Buffer): void {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new ValidationError("Invalid uploaded file", "file");
  }

  const targetPath = path.resolve(COOKIES_PATH);
  const tempPath = `${targetPath}.tmp`;

  try {
    fs.ensureDirSync(path.dirname(targetPath));
    fs.writeFileSync(tempPath, fileBuffer);
    fs.moveSync(tempPath, targetPath, { overwrite: true });
    logger.info(`Cookies uploaded and saved to ${targetPath}`);
  } catch (error: any) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
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
