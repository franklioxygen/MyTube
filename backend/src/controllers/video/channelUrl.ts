import * as storageService from "../../services/storageService";
import { twitchApiService } from "../../services/twitchService";
import {
  extractTwitchVideoId,
  isBilibiliUrl,
  isTwitchChannelUrl,
  isTwitchVideoUrl,
  isYouTubeUrl,
  normalizeTwitchChannelUrl,
} from "../../utils/helpers";
import { logger } from "../../utils/logger";

type ExistingVideoRecord = { id: string; channelUrl?: string };

const BILIBILI_REQUEST_HEADERS = {
  Referer: "https://www.bilibili.com",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

export const getExistingVideoBySourceUrl = (
  sourceUrl: string
): ExistingVideoRecord | null =>
  storageService.getVideoBySourceUrl(sourceUrl) as ExistingVideoRecord | null;

export const persistChannelUrlForVideo = (
  existingVideo: ExistingVideoRecord | null,
  channelUrl: string
): void => {
  if (!existingVideo) {
    return;
  }
  storageService.updateVideo(existingVideo.id, { channelUrl });
};

const getBilibiliApiUrl = (videoId: string): string => {
  if (videoId.startsWith("BV")) {
    return `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
  }
  return `https://api.bilibili.com/x/web-interface/view?aid=${videoId.replace(
    "av",
    ""
  )}`;
};

const fetchYouTubeChannelUrl = async (
  sourceUrl: string
): Promise<string | null> => {
  if (!isYouTubeUrl(sourceUrl)) {
    return null;
  }

  const { executeYtDlpJson, getNetworkConfigFromUserConfig, getUserYtDlpConfig } =
    await import("../../utils/ytDlpUtils");
  const userConfig = getUserYtDlpConfig(sourceUrl);
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);
  const info = await executeYtDlpJson(sourceUrl, {
    ...networkConfig,
    noWarnings: true,
  });

  return info.channel_url || info.uploader_url || null;
};

const fetchBilibiliChannelUrl = async (
  sourceUrl: string
): Promise<string | null> => {
  if (!isBilibiliUrl(sourceUrl)) {
    return null;
  }

  const { extractBilibiliVideoId } = await import("../../utils/helpers");
  const videoId = extractBilibiliVideoId(sourceUrl);
  if (!videoId) {
    return null;
  }

  try {
    const axios = (await import("axios")).default;
    const response = await axios.get(getBilibiliApiUrl(videoId), {
      headers: BILIBILI_REQUEST_HEADERS,
    });

    const ownerMid = response?.data?.data?.owner?.mid;
    if (!ownerMid) {
      return null;
    }
    return `https://space.bilibili.com/${ownerMid}`;
  } catch (error) {
    logger.error("Error fetching Bilibili video info:", error);
    return null;
  }
};

const fetchTwitchChannelUrl = async (
  sourceUrl: string
): Promise<string | null> => {
  if (isTwitchChannelUrl(sourceUrl)) {
    return normalizeTwitchChannelUrl(sourceUrl);
  }

  if (!isTwitchVideoUrl(sourceUrl)) {
    return null;
  }

  const twitchVideoId = extractTwitchVideoId(sourceUrl);
  if (!twitchVideoId) {
    return null;
  }

  try {
    const twitchVideo = await twitchApiService.getVideoById(twitchVideoId);
    if (twitchVideo) {
      return `https://www.twitch.tv/${twitchVideo.userLogin}`;
    }
  } catch (error) {
    logger.error("Error fetching Twitch video info:", error);
  }

  const {
    getChannelUrlFromVideo,
    getNetworkConfigFromUserConfig,
    getUserYtDlpConfig,
  } = await import("../../utils/ytDlpUtils");
  const userConfig = getUserYtDlpConfig(sourceUrl);
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);
  return getChannelUrlFromVideo(sourceUrl, networkConfig);
};

export const resolveChannelUrl = async (
  sourceUrl: string
): Promise<string | null> => {
  const youtubeChannelUrl = await fetchYouTubeChannelUrl(sourceUrl);
  if (youtubeChannelUrl) {
    return youtubeChannelUrl;
  }
  const bilibiliChannelUrl = await fetchBilibiliChannelUrl(sourceUrl);
  if (bilibiliChannelUrl) {
    return bilibiliChannelUrl;
  }
  return fetchTwitchChannelUrl(sourceUrl);
};
