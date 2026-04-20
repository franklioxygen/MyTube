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

type TwitchYtDlpEntry = {
  webpage_url?: unknown;
  url?: unknown;
  id?: unknown;
  title?: unknown;
  uploader?: unknown;
  uploader_id?: unknown;
  upload_date?: unknown;
  view_count?: unknown;
};

function buildTwitchVideosUrl(channelUrl: string): string {
  const normalizedUrl = normalizeTwitchChannelUrl(channelUrl);
  return normalizedUrl.endsWith("/videos")
    ? normalizedUrl
    : `${normalizedUrl}/videos`;
}

function stripChannelLoginPrefix(
  title: string,
  channelLogin: string | null,
): string {
  if (!channelLogin) {
    return title;
  }

  const separatorIndex = title.indexOf("-");
  if (separatorIndex < 0) {
    return title;
  }

  const leadingSegment = title.slice(0, separatorIndex).trim().toLowerCase();
  return leadingSegment === channelLogin
    ? title.slice(separatorIndex + 1).trim()
    : title;
}

function resolveTwitchVideoUrl(entry: TwitchYtDlpEntry): string | null {
  if (typeof entry.webpage_url === "string" && entry.webpage_url.includes("/videos/")) {
    return entry.webpage_url;
  }

  if (typeof entry.url === "string" && entry.url.includes("/videos/")) {
    return entry.url;
  }

  if (typeof entry.id === "string") {
    if (/^v\d+$/.test(entry.id)) {
      return `https://www.twitch.tv/videos/${entry.id.slice(1)}`;
    }
    if (/^\d+$/.test(entry.id)) {
      return `https://www.twitch.tv/videos/${entry.id}`;
    }
  }

  return null;
}

function resolveTwitchVideoId(
  entry: TwitchYtDlpEntry,
  resolvedUrl: string | null
): string | null {
  const fromUrl = resolvedUrl ? extractTwitchVideoId(resolvedUrl) : null;
  if (fromUrl) {
    return fromUrl;
  }

  if (typeof entry.id === "string") {
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
    const candidate = entry as TwitchYtDlpEntry;
    const url = resolveTwitchVideoUrl(candidate);
    const id = resolveTwitchVideoId(candidate, url);

    if (!url || !id) {
      continue;
    }

    const title =
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : "Twitch Video";
    const author =
      typeof candidate.uploader === "string" && candidate.uploader.trim()
        ? candidate.uploader.trim()
        : null;
    const authorLogin =
      typeof candidate.uploader_id === "string" && candidate.uploader_id.trim()
        ? candidate.uploader_id.trim().toLowerCase()
        : channelLogin;
    const uploadDate =
      typeof candidate.upload_date === "string" &&
      /^\d{8}$/.test(candidate.upload_date)
        ? candidate.upload_date
        : null;
    const viewCount =
      typeof candidate.view_count === "number" &&
      Number.isFinite(candidate.view_count)
        ? Math.floor(candidate.view_count)
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
      ? stripChannelLoginPrefix(result.title, channelLogin)
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
