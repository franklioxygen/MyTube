import axios from "axios";
import { logger } from "../../../utils/logger";
import {
  executeYtDlpJson,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../../utils/ytDlpUtils";
import { VideoInfo } from "../BaseDownloader";
import {
  BilibiliCollectionCheckResult,
  BilibiliPartsCheckResult,
} from "./types";

/**
 * Get video info from Bilibili (tries yt-dlp first, falls back to API)
 */
export async function getVideoInfo(videoId: string): Promise<VideoInfo> {
  try {
    const videoUrl = `https://www.bilibili.com/video/${videoId}`;

    // Get user config for network options
    const userConfig = getUserYtDlpConfig(videoUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const info = await executeYtDlpJson(videoUrl, {
      ...networkConfig,
      noWarnings: true,
    });

    return {
      title: info.title || "Bilibili Video",
      author: info.uploader || info.channel || "Bilibili User",
      date:
        info.upload_date ||
        info.release_date ||
        new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      thumbnailUrl: info.thumbnail || null,
      description: info.description,
    };
  } catch (error) {
    logger.error("Error fetching Bilibili video info with yt-dlp:", error);
    // Fallback to API
    try {
      const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
      const response = await axios.get(apiUrl);

      if (response.data && response.data.data) {
        const videoInfo = response.data.data;
        return {
          title: videoInfo.title || "Bilibili Video",
          author: videoInfo.owner?.name || "Bilibili User",
          date: new Date(videoInfo.pubdate * 1000)
            .toISOString()
            .slice(0, 10)
            .replace(/-/g, ""),
          thumbnailUrl: videoInfo.pic || null,
          description: videoInfo.desc,
        };
      }
    } catch (apiError) {
      logger.error("Error fetching Bilibili video info from API:", apiError);
    }
    return {
      title: "Bilibili Video",
      author: "Bilibili User",
      date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      thumbnailUrl: null,
    };
  }
}

/**
 * Get author info from Bilibili space URL
 */
export async function getAuthorInfo(mid: string): Promise<{
  name: string;
  mid: string;
}> {
  try {
    // Use the card API which doesn't require WBI signing
    const apiUrl = `https://api.bilibili.com/x/web-interface/card?mid=${mid}`;
    logger.info("Fetching Bilibili author info from:", apiUrl);

    const response = await axios.get(apiUrl, {
      headers: {
        Referer: "https://www.bilibili.com",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (response.data && response.data.data && response.data.data.card) {
      const card = response.data.data.card;
      return {
        name: card.name || "Bilibili User",
        mid: mid,
      };
    }

    return { name: "Bilibili User", mid };
  } catch (error) {
    logger.error("Error fetching Bilibili author info:", error);
    return { name: "Bilibili User", mid };
  }
}

/**
 * Get the latest video URL from a Bilibili author's space
 */
export async function getLatestVideoUrl(
  spaceUrl: string
): Promise<string | null> {
  try {
    logger.info("Fetching latest video for Bilibili space:", spaceUrl);

    // Extract mid from the space URL
    const { extractBilibiliMid } = await import("../../../utils/helpers");
    const mid = extractBilibiliMid(spaceUrl);

    if (!mid) {
      logger.error("Could not extract mid from Bilibili space URL:", spaceUrl);
      return null;
    }

    logger.info("Extracted mid:", mid);

    // Get user config for network options (cookies, proxy, etc.)
    const userConfig = getUserYtDlpConfig(spaceUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    // Use yt-dlp to get the latest video from the user's space
    // Bilibili space URL format: https://space.bilibili.com/{mid}/video
    const videosUrl = `https://space.bilibili.com/${mid}/video`;

    try {
      const result = await executeYtDlpJson(videosUrl, {
        ...networkConfig,
        playlistEnd: 1, // Only get the first (latest) video
        flatPlaylist: true, // Don't download, just get info
        noWarnings: true,
      });

      // If it's a playlist/channel, 'entries' will contain the videos
      if (result.entries && result.entries.length > 0) {
        const latestVideo = result.entries[0];
        const bvid = latestVideo.id;

        if (bvid) {
          const videoUrl = `https://www.bilibili.com/video/${bvid}`;
          logger.info("Found latest Bilibili video:", videoUrl);
          return videoUrl;
        }

        // Fallback to url if id is not available
        if (latestVideo.url) {
          logger.info("Found latest Bilibili video:", latestVideo.url);
          return latestVideo.url;
        }
      }
    } catch (ytdlpError) {
      logger.error("yt-dlp failed, trying API fallback:", ytdlpError);

      // Fallback: Try the non-WBI API endpoint
      const apiUrl = `https://api.bilibili.com/x/space/arc/search?mid=${mid}&pn=1&ps=1&order=pubdate`;

      const response = await axios.get(apiUrl, {
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (
        response.data &&
        response.data.data &&
        response.data.data.list &&
        response.data.data.list.vlist
      ) {
        const videos = response.data.data.list.vlist;

        if (videos.length > 0) {
          const latestVideo = videos[0];
          const bvid = latestVideo.bvid;

          if (bvid) {
            const videoUrl = `https://www.bilibili.com/video/${bvid}`;
            logger.info(
              "Found latest Bilibili video (API fallback):",
              videoUrl
            );
            return videoUrl;
          }
        }
      }
    }

    logger.info("No videos found for Bilibili space:", spaceUrl);
    return null;
  } catch (error) {
    logger.error("Error fetching latest Bilibili video:", error);
    return null;
  }
}

/**
 * Check if a Bilibili video has multiple parts
 */
export async function checkVideoParts(
  videoId: string
): Promise<BilibiliPartsCheckResult> {
  try {
    // Try to get video info from Bilibili API
    // Handle both BV and av formats
    const isBvId = videoId.startsWith("BV");
    const apiUrl = isBvId
      ? `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`
      : `https://api.bilibili.com/x/web-interface/view?aid=${videoId.replace(
          "av",
          ""
        )}`;
    logger.info("Fetching video info from API to check parts:", apiUrl);

    const response = await axios.get(apiUrl, {
      headers: {
        Referer: "https://www.bilibili.com",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (response.data && response.data.data) {
      const videoInfo = response.data.data;
      const videosNumber = videoInfo.videos || 1;

      logger.info(`Bilibili video has ${videosNumber} parts`);

      return {
        success: true,
        videosNumber,
        title: videoInfo.title || "Bilibili Video",
      };
    }

    return { success: false, videosNumber: 1 };
  } catch (error) {
    logger.error("Error checking Bilibili video parts:", error);
    return { success: false, videosNumber: 1 };
  }
}

/**
 * Check if a Bilibili video belongs to a collection or series
 */
export async function checkCollectionOrSeries(
  videoId: string
): Promise<BilibiliCollectionCheckResult> {
  try {
    const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
    logger.info("Checking if video belongs to collection/series:", apiUrl);

    const response = await axios.get(apiUrl, {
      headers: {
        Referer: "https://www.bilibili.com",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (response.data && response.data.data) {
      const videoInfo = response.data.data;
      const mid = videoInfo.owner?.mid;

      // Check for collection (ugc_season)
      if (videoInfo.ugc_season) {
        const season = videoInfo.ugc_season;
        logger.info(`Video belongs to collection: ${season.title}`);
        return {
          success: true,
          type: "collection",
          id: season.id,
          title: season.title,
          count: season.ep_count || 0,
          mid: mid,
        };
      }

      // If no collection found, return none
      return { success: true, type: "none" };
    }

    return { success: false, type: "none" };
  } catch (error) {
    logger.error("Error checking collection/series:", error);
    return { success: false, type: "none" };
  }
}
