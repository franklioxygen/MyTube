import { logger } from "../../utils/logger";

/**
 * Resolve the display name for a YouTube channel subscription.
 *
 * Mirrors the legacy inline logic from SubscriptionService.subscribe: probe the
 * channel's videos playlist via yt-dlp and fall back to parsing the channel URL
 * (handle or last path segment) when metadata is unavailable. `authorUrl` is
 * expected to be already normalized.
 */
export async function resolveYouTubeAuthorName(
  authorUrl: string,
  providedAuthorName?: string
): Promise<string> {
  let authorName = providedAuthorName || "Unknown Author";

  try {
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const userConfig = getUserYtDlpConfig(authorUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    // Construct URL to get videos from the channel
    let targetUrl = authorUrl;
    if (
      !targetUrl.includes("/videos") &&
      !targetUrl.includes("/shorts") &&
      !targetUrl.includes("/streams")
    ) {
      // Append /videos to get the videos playlist
      if (targetUrl.endsWith("/")) {
        targetUrl = `${targetUrl}videos`;
      } else {
        targetUrl = `${targetUrl}/videos`;
      }
    }

    // Try to get channel info from the channel URL
    const info = await executeYtDlpJson(targetUrl, {
      ...networkConfig,
      noWarnings: true,
      flatPlaylist: true,
      playlistEnd: 1,
    });

    // Try to get uploader/channel name from the first video or channel info
    if (info.uploader) {
      authorName = info.uploader;
    } else if (info.channel) {
      authorName = info.channel;
    } else if (info.channel_id && info.entries && info.entries.length > 0) {
      // If we have entries, try to get info from the first video
      const firstVideo = info.entries[0];
      if (firstVideo && firstVideo.url) {
        try {
          const videoInfo = await executeYtDlpJson(firstVideo.url, {
            ...networkConfig,
            noWarnings: true,
          });
          if (videoInfo.uploader) {
            authorName = videoInfo.uploader;
          } else if (videoInfo.channel) {
            authorName = videoInfo.channel;
          }
        } catch (videoError) {
          logger.error(
            "Error fetching video info for channel name:",
            videoError
          );
        }
      }
    }

    // Fallback: try to extract from URL if still not found
    if (authorName === "Unknown Author" || authorName === providedAuthorName) {
      const match = decodeURI(authorUrl).match(/youtube\.com\/(@[^\/]+)/);
      if (match && match[1]) {
        authorName = match[1];
      } else {
        const parts = authorUrl.split("/");
        if (parts.length > 0) {
          const lastPart = parts[parts.length - 1];
          if (
            lastPart &&
            lastPart !== "videos" &&
            lastPart !== "about" &&
            lastPart !== "channel"
          ) {
            authorName = lastPart;
          }
        }
      }
    }
  } catch (error) {
    logger.error("Error fetching YouTube channel info:", error);
    // Fallback: try to extract from URL
    const match = decodeURI(authorUrl).match(/youtube\.com\/(@[^\/]+)/);
    if (match && match[1]) {
      authorName = match[1];
    } else {
      const parts = authorUrl.split("/");
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (
          lastPart &&
          lastPart !== "videos" &&
          lastPart !== "about" &&
          lastPart !== "channel"
        ) {
          authorName = lastPart;
        }
      }
    }
  }

  return authorName;
}
