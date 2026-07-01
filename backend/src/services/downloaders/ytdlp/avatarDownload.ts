import fs from "fs-extra";
import path from "path";
import { AVATARS_DIR } from "../../../config/paths";
import { downloadAndProcessAvatar } from "../../../utils/avatarUtils";
import { isYouTubeUrl } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import {
  moveSafeSync,
  pathExistsSafeSync,
  resolveSafeChildPath,
  unlinkSafeSync,
} from "../../../utils/security";
import {
  downloadChannelAvatar,
  getAxiosProxyConfig,
  InvalidProxyError,
} from "../../../utils/ytDlpUtils";
import { YtDlpDownloaderHelper } from "./ytdlpDownloaderHelper";

export interface AvatarDownloadInput {
  channelUrl: string | null;
  videoUrl: string;
  videoAuthor: string;
  source: string;
  /** Incoming avatar URL (e.g. from Twitch Helix enrichment), if any. */
  authorAvatarUrl: string | null;
  /** yt-dlp info for avatar-URL fallbacks. */
  info: {
    channel_avatar?: string;
    uploader_avatar?: string;
  };
  networkConfig: Record<string, unknown>;
  downloadUserConfig: { proxy?: string };
  /** Downloader exposing the protected thumbnail helper. */
  downloader: YtDlpDownloaderHelper;
}

export interface AvatarDownloadResult {
  authorAvatarPath: string | null;
  authorAvatarSaved: boolean;
  /** Updated avatar URL (may be backfilled from info). */
  authorAvatarUrl: string | null;
  /** Final avatar filename, or undefined when no avatar was saved. */
  finalAuthorAvatarFilename: string | undefined;
}

/**
 * Download and process the author avatar for a yt-dlp video.
 *
 * Strategy: if we have a YouTube channel URL, fetch the channel avatar via
 * yt-dlp to a temp file and process it. Otherwise fall back to a direct avatar
 * URL (from Twitch enrichment or the info JSON) downloaded through the
 * thumbnail helper. Temp files are always cleaned up.
 */
export async function downloadVideoAvatar(
  input: AvatarDownloadInput,
): Promise<AvatarDownloadResult> {
  const {
    channelUrl,
    videoUrl,
    videoAuthor,
    source,
    authorAvatarUrl: incomingAvatarUrl,
    info,
    networkConfig,
    downloadUserConfig,
    downloader,
  } = input;

  let authorAvatarPath: string | null = null;
  let authorAvatarUrl = incomingAvatarUrl;
  let authorAvatarSaved = false;
  const platform =
    source === "youtube" || source === "twitch" ? source : "generic";

  if (channelUrl && isYouTubeUrl(videoUrl)) {
    logger.info("Downloading author avatar from channel:", {
      channelUrl: channelUrl,
      author: videoAuthor,
      platform: platform,
    });

    // Download channel avatar using yt-dlp to a temp file first
    const tempAvatarPath = resolveSafeChildPath(
      AVATARS_DIR,
      `temp_${Date.now()}.jpg`
    );
    fs.ensureDirSync(AVATARS_DIR);

    const downloaded = await downloadChannelAvatar(
      channelUrl,
      tempAvatarPath,
      networkConfig
    );

    if (downloaded && pathExistsSafeSync(tempAvatarPath, AVATARS_DIR)) {
      // Process the downloaded avatar (check if exists, resize)
      authorAvatarPath = await downloadAndProcessAvatar(
        tempAvatarPath, // Use temp file path as "URL" for processing
        platform,
        videoAuthor,
        async (url: string, savePath: string) => {
          // This function just moves the temp file
          if (pathExistsSafeSync(url, AVATARS_DIR)) {
            moveSafeSync(url, AVATARS_DIR, savePath, AVATARS_DIR, {
              overwrite: true,
            });
            return true;
          }
          return false;
        }
      );
      authorAvatarSaved = authorAvatarPath !== null;

      // Clean up temp file if it still exists (in case processing failed or file wasn't moved)
      if (pathExistsSafeSync(tempAvatarPath, AVATARS_DIR)) {
        try {
          unlinkSafeSync(tempAvatarPath, AVATARS_DIR);
          logger.info(`Cleaned up temp avatar file: ${tempAvatarPath}`);
        } catch (cleanupError) {
          logger.warn(
            `Failed to clean up temp avatar file: ${tempAvatarPath}`,
            cleanupError
          );
        }
      }
    } else if (pathExistsSafeSync(tempAvatarPath, AVATARS_DIR)) {
      // Clean up temp file if download failed
      try {
        unlinkSafeSync(tempAvatarPath, AVATARS_DIR);
        logger.info(
          `Cleaned up temp avatar file after failed download: ${tempAvatarPath}`
        );
      } catch (cleanupError) {
        logger.warn(
          `Failed to clean up temp avatar file: ${tempAvatarPath}`,
          cleanupError
        );
      }
    }
  } else {
    // Fallback: try to get avatar URL from info if available
    authorAvatarUrl =
      authorAvatarUrl || info.channel_avatar || info.uploader_avatar || null;
    if (authorAvatarUrl) {
      logger.info("Downloading author avatar from URL:", {
        url: authorAvatarUrl,
        author: videoAuthor,
        platform: platform,
      });

      // Prepare axios config with proxy if available
      let avatarAxiosConfig = {};
      if (downloadUserConfig.proxy) {
        try {
          avatarAxiosConfig = getAxiosProxyConfig(downloadUserConfig.proxy);
        } catch (error) {
          if (error instanceof InvalidProxyError) {
            logger.warn(
              "Invalid proxy configuration for avatar download, proceeding without proxy:",
              error.message
            );
          } else {
            throw error;
          }
        }
      }

      // Use the utility function to download and process avatar
      authorAvatarPath = await downloadAndProcessAvatar(
        authorAvatarUrl,
        platform,
        videoAuthor,
        downloader.downloadThumbnailPublic.bind(downloader),
        avatarAxiosConfig
      );
      authorAvatarSaved = authorAvatarPath !== null;
    } else {
      logger.info(
        "No channel URL or avatar URL available, skipping avatar download"
      );
    }
  }

  const finalAuthorAvatarFilename = authorAvatarPath
    ? path.basename(authorAvatarPath)
    : undefined;

  return { authorAvatarPath, authorAvatarSaved, authorAvatarUrl, finalAuthorAvatarFilename };
}
