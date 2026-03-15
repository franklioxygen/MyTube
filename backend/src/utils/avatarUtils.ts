import fs from "fs-extra";
import path from "path";
import os from "os";
import { Jimp } from "jimp";
import { AVATARS_DIR } from "../config/paths";
import {
  pathEntryExistsSync,
  pathExistsSync,
  removeFileSync,
  writeFileData,
} from "./fileSystemAccess";
import { logger } from "./logger";
import { formatAvatarFilename } from "./helpers";

const AVATAR_ALLOWED_DIRS = [AVATARS_DIR, os.tmpdir(), "/tmp"];

/**
 * Check if avatar exists for a given platform and author
 * Returns the avatar path if it exists, null otherwise
 */
export function getExistingAvatarPath(
  platform: string,
  author: string
): string | null {
  const avatarFilename = formatAvatarFilename(platform, author);
  const avatarPath = path.join(AVATARS_DIR, avatarFilename);

  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (pathExistsSync(avatarPath, AVATAR_ALLOWED_DIRS)) {
    logger.info(`Avatar already exists for ${platform} author ${author}: ${avatarPath}`);
    return avatarPath;
  }

  return null;
}

/**
 * Resize image to 100x100px and save
 * Returns true if successful, false otherwise
 */
export async function resizeAvatar(
  inputPath: string,
  outputPath: string
): Promise<boolean> {
  try {
    // Ensure output directory exists
    fs.ensureDirSync(path.dirname(outputPath));

    // Pure-JS resize/encode to avoid native binary crashes on some Windows setups.
    const image = await Jimp.read(inputPath);
    image.cover({ w: 100, h: 100 });
    const imageBuffer = await image.getBuffer("image/jpeg", { quality: 90 });
    await writeFileData(outputPath, imageBuffer, AVATAR_ALLOWED_DIRS);

    logger.info(`Resized avatar to 100x100px: ${outputPath}`);
    return true;
  } catch (error) {
    logger.error(`Error resizing avatar: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Download and process avatar: check if exists, download if needed, resize to 100x100px
 * Returns the avatar path if successful, null otherwise
 * 
 * @param avatarUrl - URL to download from, or file path if already downloaded
 * @param platform - Platform name (e.g., "youtube", "bilibili")
 * @param author - Author name
 * @param downloadFunction - Function to download the avatar, or move file if already downloaded
 * @param axiosConfig - Optional axios config for downloads
 */
export async function downloadAndProcessAvatar(
  avatarUrl: string,
  platform: string,
  author: string,
  downloadFunction: (url: string, savePath: string, config?: any) => Promise<boolean>,
  axiosConfig?: any
): Promise<string | null> {
  // Check if avatar already exists
  const existingPath = getExistingAvatarPath(platform, author);
  if (existingPath) {
    logger.info(`Skipping avatar download - already exists: ${existingPath}`);
    return existingPath;
  }

  // Generate avatar filename
  const avatarFilename = formatAvatarFilename(platform, author);
  const finalAvatarPath = path.join(AVATARS_DIR, avatarFilename);

  // Check if the input is already a local file path (for yt-dlp downloaded avatars)
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  const isLocalFile = !avatarUrl.startsWith("http") &&
    pathExistsSync(avatarUrl, AVATAR_ALLOWED_DIRS);
  
  let tempAvatarPath: string;
  if (isLocalFile) {
    // If it's already a local file, use it directly
    tempAvatarPath = avatarUrl;
  } else {
    // Otherwise, download to temp path
    tempAvatarPath = path.join(AVATARS_DIR, `temp_${Date.now()}_${avatarFilename}`);
  }

  try {
    // Ensure avatars directory exists
    fs.ensureDirSync(AVATARS_DIR);

    // Download avatar to temporary path (if not already local)
    if (!isLocalFile) {
      const downloaded = await downloadFunction(avatarUrl, tempAvatarPath, axiosConfig);
      if (!downloaded) {
        logger.warn(`Failed to download avatar from ${avatarUrl}`);
        return null;
      }
    }

    // Resize to 100x100px
    const resized = await resizeAvatar(tempAvatarPath, finalAvatarPath);
    if (!resized) {
      logger.warn(`Failed to resize avatar: ${tempAvatarPath}`);
      // Clean up temp file (only if we created it)
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (!isLocalFile && pathEntryExistsSync(tempAvatarPath, AVATAR_ALLOWED_DIRS)) {
        removeFileSync(tempAvatarPath, AVATAR_ALLOWED_DIRS);
      }
      return null;
    }

    // Clean up temp file (only if we created it)
    if (!isLocalFile && pathEntryExistsSync(tempAvatarPath, AVATAR_ALLOWED_DIRS)) {
      removeFileSync(tempAvatarPath, AVATAR_ALLOWED_DIRS);
    }

    logger.info(`Successfully processed avatar: ${finalAvatarPath}`);
    return finalAvatarPath;
  } catch (error) {
    logger.error(`Error processing avatar: ${error instanceof Error ? error.message : String(error)}`);
    // Clean up temp file on error (only if we created it)
    if (!isLocalFile && pathEntryExistsSync(tempAvatarPath, AVATAR_ALLOWED_DIRS)) {
      try {
        removeFileSync(tempAvatarPath, AVATAR_ALLOWED_DIRS);
      } catch (cleanupError) {
        logger.error(`Error cleaning up temp avatar: ${cleanupError}`);
      }
    }
    return null;
  }
}
