import {
  extractTwitchChannelLogin,
  extractTwitchVideoId,
  normalizeTwitchChannelUrl,
} from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import {
  executeYtDlpJson,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../../utils/ytDlpUtils";

export interface TwitchYtDlpVideoEntry {
  id: string;
  url: string;
  title: string;
  author: string | null;
  authorLogin: string | null;
  uploadDate: string | null;
  viewCount: number;
  sourceIndex: number;
}

type GetTwitchChannelVideosOptions = {
  startIndex?: number;
  limit?: number;
  flatPlaylist?: boolean;
};

type TwitchYtDlpChannelResult = {
  channelName: string | null;
  channelLogin: string | null;
  videos: TwitchYtDlpVideoEntry[];
};

function buildTwitchVideosUrl(channelUrl: string): string {
  const normalizedUrl = normalizeTwitchChannelUrl(channelUrl);
  return normalizedUrl.endsWith("/videos")
    ? normalizedUrl
    : `${normalizedUrl}/videos`;
}

function resolveTwitchVideoUrl(entry: any): string | null {
  if (typeof entry?.webpage_url === "string" && entry.webpage_url.includes("/videos/")) {
    return entry.webpage_url;
  }

  if (typeof entry?.url === "string" && entry.url.includes("/videos/")) {
    return entry.url;
  }

  if (typeof entry?.id === "string") {
    if (/^v\d+$/.test(entry.id)) {
      return `https://www.twitch.tv/videos/${entry.id.slice(1)}`;
    }
    if (/^\d+$/.test(entry.id)) {
      return `https://www.twitch.tv/videos/${entry.id}`;
    }
  }

  return null;
}

function resolveTwitchVideoId(entry: any, resolvedUrl: string | null): string | null {
  const fromUrl = resolvedUrl ? extractTwitchVideoId(resolvedUrl) : null;
  if (fromUrl) {
    return fromUrl;
  }

  if (typeof entry?.id === "string") {
    if (/^v\d+$/.test(entry.id)) {
      return entry.id.slice(1);
    }
    if (/^\d+$/.test(entry.id)) {
      return entry.id;
    }
  }

  return null;
}

export async function getTwitchChannelVideos(
  channelUrl: string,
  options: GetTwitchChannelVideosOptions = {}
): Promise<TwitchYtDlpChannelResult> {
  const startIndex = Math.max(options.startIndex ?? 0, 0);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const targetUrl = buildTwitchVideosUrl(channelUrl);
  const userConfig = getUserYtDlpConfig(targetUrl);
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);

  logger.info("Fetching Twitch channel videos via yt-dlp:", targetUrl);

  const result = await executeYtDlpJson(targetUrl, {
    ...networkConfig,
    noWarnings: true,
    playlistStart: startIndex + 1,
    playlistEnd: startIndex + limit,
    ...(options.flatPlaylist ? { flatPlaylist: true } : {}),
    dumpSingleJson: true,
  });

  const entries = Array.isArray(result?.entries) ? result.entries : [];
  const channelLogin =
    typeof result?.id === "string" && result.id.trim()
      ? result.id.trim().toLowerCase()
      : extractTwitchChannelLogin(targetUrl);

  const videos: TwitchYtDlpVideoEntry[] = [];
  for (const [index, entry] of entries.entries()) {
    const url = resolveTwitchVideoUrl(entry);
    const id = resolveTwitchVideoId(entry, url);

    if (!url || !id) {
      continue;
    }

    const title =
      typeof entry?.title === "string" && entry.title.trim()
        ? entry.title.trim()
        : "Twitch Video";
    const author =
      typeof entry?.uploader === "string" && entry.uploader.trim()
        ? entry.uploader.trim()
        : null;
    const authorLogin =
      typeof entry?.uploader_id === "string" && entry.uploader_id.trim()
        ? entry.uploader_id.trim().toLowerCase()
        : channelLogin;
    const uploadDate =
      typeof entry?.upload_date === "string" && /^\d{8}$/.test(entry.upload_date)
        ? entry.upload_date
        : null;
    const viewCount =
      typeof entry?.view_count === "number" && Number.isFinite(entry.view_count)
        ? Math.floor(entry.view_count)
        : 0;

    videos.push({
      id,
      url,
      title,
      author,
      authorLogin,
      uploadDate,
      viewCount,
      sourceIndex: startIndex + index,
    });
  }

  const channelName =
    videos.find((video) => video.author)?.author ||
    (typeof result?.title === "string" && channelLogin
      ? result.title.replace(new RegExp(`^${channelLogin}\\s*-\\s*`, "i"), "").trim()
      : null);

  return {
    channelName: channelName || null,
    channelLogin,
    videos,
  };
}

export async function getLatestTwitchVideoUrl(
  channelUrl: string
): Promise<string | null> {
  const result = await getTwitchChannelVideos(channelUrl, {
    startIndex: 0,
    limit: 1,
    flatPlaylist: true,
  });
  return result.videos[0]?.url || null;
}
