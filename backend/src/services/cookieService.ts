import { DATA_DIR } from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { logger } from "../utils/logger";
import {
  ensureDirSafeSync,
  moveSafeSync,
  pathExistsSafeSync,
  resolveSafeChildPath,
  unlinkSafeSync,
  writeFileSafeSync,
} from "../utils/security";

const COOKIES_FILENAME = "cookies.txt";
const COOKIES_TEMP_FILENAME = "cookies.txt.tmp";
const COOKIES_PATH = resolveSafeChildPath(DATA_DIR, COOKIES_FILENAME);
const COOKIES_TEMP_PATH = resolveSafeChildPath(DATA_DIR, COOKIES_TEMP_FILENAME);

/**
 * Check if cookies file exists
 */
export function checkCookies(): { exists: boolean } {
  return { exists: pathExistsSafeSync(COOKIES_PATH, DATA_DIR) };
}

/**
 * Upload cookies file
 * @param fileBuffer - Uploaded file bytes
 */
export function uploadCookies(fileBuffer: Buffer): void {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new ValidationError("Invalid uploaded file", "file");
  }

  try {
    ensureDirSafeSync(DATA_DIR, DATA_DIR);
    writeFileSafeSync(COOKIES_TEMP_PATH, DATA_DIR, fileBuffer);
    moveSafeSync(COOKIES_TEMP_PATH, DATA_DIR, COOKIES_PATH, DATA_DIR, {
      overwrite: true,
    });
    logger.info(`Cookies uploaded and saved to ${COOKIES_PATH}`);
  } catch (error: unknown) {
    if (pathExistsSafeSync(COOKIES_TEMP_PATH, DATA_DIR)) {
      unlinkSafeSync(COOKIES_TEMP_PATH, DATA_DIR);
    }
    throw error;
  }
}

/**
 * Delete cookies file
 */
export function deleteCookies(): void {
  if (pathExistsSafeSync(COOKIES_PATH, DATA_DIR)) {
    unlinkSafeSync(COOKIES_PATH, DATA_DIR);
  } else {
    throw new NotFoundError("Cookies file", COOKIES_FILENAME);
  }
}
