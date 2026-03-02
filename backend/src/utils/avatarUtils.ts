import fs from "fs-extra";
import path from "path";
import sharp from "sharp";
import { AVATARS_DIR } from "../config/paths";
import { logger } from "./logger";
import { formatAvatarFilename } from "./helpers";

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
  if (fs.existsSync(avatarPath)) {
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

    // Resize image to 100x100px using sharp
    // cover: resize to fill 100x100, cropping if necessary to maintain aspect ratio
    await sharp(inputPath)
      .resize(100, 100, {
        fit: "cover",
        position: "center",
      })
      .jpeg({ quality: 90 }) // Convert to JPEG with good quality
      .toFile(outputPath);

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
  const isLocalFile = fs.existsSync(avatarUrl) && !avatarUrl.startsWith('http');
  
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
      if (!isLocalFile && fs.existsSync(tempAvatarPath)) {
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        fs.unlinkSync(tempAvatarPath);
      }
      return null;
    }

    // Clean up temp file (only if we created it)
    if (!isLocalFile && fs.existsSync(tempAvatarPath)) {
      fs.unlinkSync(tempAvatarPath);
    }

    logger.info(`Successfully processed avatar: ${finalAvatarPath}`);
    return finalAvatarPath;
  } catch (error) {
    logger.error(`Error processing avatar: ${error instanceof Error ? error.message : String(error)}`);
    // Clean up temp file on error (only if we created it)
    if (!isLocalFile && fs.existsSync(tempAvatarPath)) {
      try {
        fs.unlinkSync(tempAvatarPath);
      } catch (cleanupError) {
        logger.error(`Error cleaning up temp avatar: ${cleanupError}`);
      }
    }
    return null;
  }
}
