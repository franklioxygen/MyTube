import { logger } from "../../../utils/logger";
import { isYouTubeUrl } from "../../../utils/helpers";
import {
    executeYtDlpJson,
    getNetworkConfigFromUserConfig,
    getUserYtDlpConfig,
} from "../../../utils/ytDlpUtils";
import { getProviderScript } from "./ytdlpHelpers";

function buildYouTubeTabUrl(channelUrl: string, tab: "videos" | "shorts"): string {
  if (!isYouTubeUrl(channelUrl)) {
    return channelUrl;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(channelUrl);
  } catch {
    return channelUrl;
  }

  const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "");
  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return channelUrl;
  }

  const firstSegment = segments[0];
  const isChannelLikePath =
    firstSegment.startsWith("@") ||
    firstSegment === "channel" ||
    firstSegment === "c" ||
    firstSegment === "user";

  if (!isChannelLikePath) {
    return channelUrl;
  }

  const lastSegment = segments[segments.length - 1];
  const hasKnownTab =
    lastSegment === "videos" || lastSegment === "shorts" || lastSegment === "streams";
  const baseSegments = hasKnownTab ? segments.slice(0, -1) : segments;
  const basePath = `/${baseSegments.join("/")}`;
  return `${parsedUrl.origin}${basePath}/${tab}${parsedUrl.search}`;
}

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
    const targetUrl = buildYouTubeTabUrl(channelUrl, "videos");
    if (targetUrl !== channelUrl) {
      logger.info("Modified channel URL to:", targetUrl);
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


/**
 * Returns the URL of the most recently listed Short for a YouTube channel.
 * "Latest" is defined as the first video entry in the channel's /shorts tab playlist.
 * YouTube's channel Shorts tab typically orders by newest first; we rely on that
 * order. If the platform changes ordering, this would need to sort by date or use
 * another strategy.
 */
export async function getLatestShortsUrl(
  channelUrl: string
): Promise<string | null> {
  try {
    logger.info("Fetching latest Shorts for channel:", channelUrl);

    // Get user config for network options
    const userConfig = getUserYtDlpConfig(channelUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const PROVIDER_SCRIPT = getProviderScript();

    // Construct Shorts URL
    const targetUrl = buildYouTubeTabUrl(channelUrl, "shorts");

    logger.info("Fetching Shorts from:", targetUrl);

    // First entry in the shorts playlist is treated as "latest" (see JSDoc above).
    const result = await executeYtDlpJson(targetUrl, {
      ...networkConfig,
      playlistEnd: 5,
      noWarnings: true,
      flatPlaylist: true,
      ...(PROVIDER_SCRIPT
        ? {
            extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
          }
        : {}),
    });

    if (result.entries && result.entries.length > 0) {
      for (const entry of result.entries) {
        if (entry.id && entry.id.startsWith("UC") && entry.id.length === 24) {
          continue;
        }

        const videoId = entry.id;
        if (videoId) {
          return `https://www.youtube.com/shorts/${videoId}`;
        }
        if (entry.url) {
          return entry.url;
        }
      }
    }
    return null;
  } catch (error) {
    logger.error("Error fetching latest Shorts URL:", error);
    return null;
  }
}
