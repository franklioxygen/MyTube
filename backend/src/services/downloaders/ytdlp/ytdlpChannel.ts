import { logger } from "../../../utils/logger";
import {
  executeYtDlpJson,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../../utils/ytDlpUtils";
import { getProviderScript } from "./ytdlpHelpers";

/**
 * Get the latest video URL from a channel
 */
export async function getLatestVideoUrl(
  channelUrl: string
): Promise<string | null> {
  try {
    logger.info("Fetching latest video for channel:", channelUrl);

    // Get user config for network options
    const userConfig = getUserYtDlpConfig(channelUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const PROVIDER_SCRIPT = getProviderScript();

    // Append /videos to channel URL to ensure we get videos and not the channel tab
    let targetUrl = channelUrl;
    if (
      channelUrl.includes("youtube.com/") &&
      !channelUrl.includes("/videos") &&
      !channelUrl.includes("/shorts") &&
      !channelUrl.includes("/streams")
    ) {
      // Check if it looks like a channel URL
      if (
        channelUrl.includes("/@") ||
        channelUrl.includes("/channel/") ||
        channelUrl.includes("/c/") ||
        channelUrl.includes("/user/")
      ) {
        targetUrl = `${channelUrl}/videos`;
        logger.info("Modified channel URL to:", targetUrl);
      }
    }

    // Use yt-dlp to get the first video in the channel (playlist)
    const result = await executeYtDlpJson(targetUrl, {
      ...networkConfig,
      playlistEnd: 5,
      noWarnings: true,
      flatPlaylist: true, // We only need the ID/URL, not full info
      ...(PROVIDER_SCRIPT
        ? {
            extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
          }
        : {}),
    });

    // If it's a playlist/channel, 'entries' will contain the videos
    if (result.entries && result.entries.length > 0) {
      // Iterate through entries to find a valid video
      // Sometimes the first entry is the channel/tab itself (e.g. id starts with UC)
      for (const entry of result.entries) {
        // Skip entries that look like channel IDs (start with UC and are 24 chars)
        // or entries without a title/url that look like metadata
        if (entry.id && entry.id.startsWith("UC") && entry.id.length === 24) {
          continue;
        }

        const videoId = entry.id;
        if (videoId) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
        if (entry.url) {
          return entry.url;
        }
      }
    }
    return null;
  } catch (error) {
    logger.error("Error fetching latest video URL:", error);
    return null;
  }
}

