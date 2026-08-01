import { DownloadOrder, VideoEntry } from "./types";
import { logger } from "../../utils/logger";

export type { VideoEntry };

/**
 * Raised when enumerating a source fails partway through. Treating a failed
 * listing page as end-of-list is indistinguishable from a genuinely exhausted
 * source, so the caller would freeze an empty or truncated plan and mark the
 * task complete having silently skipped every unenumerated video. Propagating
 * instead turns it into a retryable planning failure, while a source that really
 * does return zero entries still completes normally.
 */
export class SourceEnumerationFailedError extends Error {
  constructor(
    readonly platform: string,
    readonly page: number,
    readonly enumeratedCount: number,
    readonly cause: unknown
  ) {
    super(
      `Failed to enumerate ${platform} source at page ${page} after ${enumeratedCount} videos: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = "SourceEnumerationFailedError";
  }
}

export class OrderingMetadataUnavailableError extends Error {
  constructor(
    readonly platform: string,
    readonly downloadOrder: DownloadOrder,
    readonly entryCount: number
  ) {
    super(
      `Unable to prepare ${downloadOrder} ordering for ${platform}: no usable ${requiredFieldLabel(
        downloadOrder
      )} metadata was available for ${entryCount} videos.`
    );
    this.name = "OrderingMetadataUnavailableError";
  }
}

function requiredFieldLabel(order: DownloadOrder): "publication date" | "view count" {
  return order === "dateAsc" || order === "dateDesc"
    ? "publication date"
    : "view count";
}

function requiredValue(entry: VideoEntry, order: DownloadOrder): number | null {
  return order === "dateAsc" || order === "dateDesc"
    ? entry.publishedAtMs
    : entry.viewCount;
}

/**
 * Sort video entries by the requested order with deterministic tie-breaking.
 */
export function sortVideoEntries(
  entries: VideoEntry[],
  order: DownloadOrder,
  platform: string = "unknown"
): VideoEntry[] {
  if (entries.length > 0 && entries.every((entry) => requiredValue(entry, order) === null)) {
    throw new OrderingMetadataUnavailableError(platform, order, entries.length);
  }

  return [...entries].sort((a, b) => {
    const aPrimary = requiredValue(a, order);
    const bPrimary = requiredValue(b, order);

    if (aPrimary === null && bPrimary !== null) {
      return 1;
    }
    if (aPrimary !== null && bPrimary === null) {
      return -1;
    }

    let primary = 0;
    if (aPrimary !== null && bPrimary !== null) {
      primary =
        order === "dateDesc" || order === "viewsDesc"
          ? bPrimary - aPrimary
          : aPrimary - bPrimary;
    }

    if (primary === 0 && (order === "viewsDesc" || order === "viewsAsc")) {
      if (a.publishedAtMs === null && b.publishedAtMs !== null) {
        primary = 1;
      } else if (a.publishedAtMs !== null && b.publishedAtMs === null) {
        primary = -1;
      } else if (a.publishedAtMs !== null && b.publishedAtMs !== null) {
        primary =
          order === "viewsDesc"
            ? b.publishedAtMs - a.publishedAtMs
            : a.publishedAtMs - b.publishedAtMs;
      }
    }

    if (primary !== 0) {
      return primary;
    }

    const indexTie = a.sourceIndex - b.sourceIndex;
    return indexTie !== 0
      ? indexTie
      : a.sourceVideoId.localeCompare(b.sourceVideoId);
  });
}

const MAX_TWITCH_VIDEO_ENTRY_PAGES = 100;
const YOUTUBE_HYDRATE_METADATA_CONCURRENCY = 4;

async function runWithBoundedConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]);
    }
  });

  await Promise.all(workers);
}

const parsePublishedAt = (
  value: unknown
): { publishedAtMs: number | null; publishedDatePrecision: VideoEntry["publishedDatePrecision"] } => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{8}$/.test(trimmed)) {
      const year = Number.parseInt(trimmed.slice(0, 4), 10);
      const month = Number.parseInt(trimmed.slice(4, 6), 10);
      const day = Number.parseInt(trimmed.slice(6, 8), 10);
      if (year === 0 || month < 1 || month > 12 || day < 1 || day > 31) {
        return { publishedAtMs: null, publishedDatePrecision: "unknown" };
      }
      const ms = Date.UTC(year, month - 1, day);
      const parsedDate = new Date(ms);
      return Number.isNaN(ms) ||
        parsedDate.getUTCFullYear() !== year ||
        parsedDate.getUTCMonth() !== month - 1 ||
        parsedDate.getUTCDate() !== day
        ? { publishedAtMs: null, publishedDatePrecision: "unknown" }
        : { publishedAtMs: ms, publishedDatePrecision: "day" };
    }
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number.parseInt(trimmed, 10);
      if (Number.isFinite(numeric) && numeric > 0) {
        const asTime = numeric > 1e12 ? numeric : numeric * 1000;
        return parsePublishedAt(asTime);
      }
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return { publishedAtMs: parsed, publishedDatePrecision: "second" };
    }
    return { publishedAtMs: null, publishedDatePrecision: "unknown" };
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const milliseconds = value > 1e12 ? value : value * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) {
      return { publishedAtMs: milliseconds, publishedDatePrecision: "second" };
    }
  }

  return { publishedAtMs: null, publishedDatePrecision: "unknown" };
};

const toViewCount = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim().toLowerCase().replace(/,/g, "");
  if (!cleaned || cleaned === "--") {
    return null;
  }

  const unitMatch = cleaned.match(/^([\d.]+)\s*([kmb]|万|亿)?$/);
  if (unitMatch) {
    const numeric = Number.parseFloat(unitMatch[1]);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return null;
    }
    const unit = unitMatch[2];
    const multiplier =
      unit === "k"
        ? 1e3
        : unit === "m"
          ? 1e6
          : unit === "b"
            ? 1e9
            : unit === "万"
              ? 1e4
              : unit === "亿"
                ? 1e8
                : 1;
    return Math.floor(numeric * multiplier);
  }

  const digits = cleaned.replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

function createVideoEntry(input: {
  url: string;
  sourceVideoId?: string | null;
  publishedAt?: unknown;
  viewCount?: unknown;
  sourceIndex: number;
}): VideoEntry {
  const published = parsePublishedAt(input.publishedAt);
  return {
    url: input.url,
    sourceVideoId: input.sourceVideoId || input.url,
    publishedAtMs: published.publishedAtMs,
    publishedDatePrecision: published.publishedDatePrecision,
    viewCount: toViewCount(input.viewCount),
    sourceIndex: input.sourceIndex,
  };
}

function metadataRequired(order: DownloadOrder, entry: VideoEntry): boolean {
  return requiredValue(entry, order) === null;
}

function mergeEntryMetadata(base: VideoEntry, richer: VideoEntry): VideoEntry {
  return {
    ...base,
    sourceVideoId:
      base.sourceVideoId && base.sourceVideoId !== base.url
        ? base.sourceVideoId
        : richer.sourceVideoId,
    publishedAtMs: base.publishedAtMs ?? richer.publishedAtMs,
    publishedDatePrecision:
      base.publishedAtMs !== null
        ? base.publishedDatePrecision
        : richer.publishedDatePrecision,
    viewCount: base.viewCount ?? richer.viewCount,
  };
}

/**
 * Service for fetching video URLs from different platforms
 */
export class VideoUrlFetcher {
  /**
   * Get total video count without loading all URLs (memory efficient)
   */
  async getVideoCount(
    authorUrl: string,
    platform: string,
    subscriptionYtdlpConfig?: string | null
  ): Promise<number> {
    try {
      if (platform === "Bilibili" || platform === "Twitch") {
        // For Bilibili, we'd need to make a lightweight API call
        // For now, return 0 and let getAllVideoUrls handle it
        return 0;
      } else {
        // For YouTube playlists, get count from playlist info
        const {
          executeYtDlpJson,
          getNetworkConfigFromUserConfig,
          getEffectiveUserYtDlpConfig,
        } = await import("../../utils/ytDlpUtils");
        const { getProviderScript } = await import(
          "../downloaders/ytdlp/ytdlpHelpers"
        );
        const userConfig = getEffectiveUserYtDlpConfig(
          authorUrl,
          subscriptionYtdlpConfig
        );
        const networkConfig = getNetworkConfigFromUserConfig(userConfig);
        const PROVIDER_SCRIPT = getProviderScript();

        const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
        const isPlaylist = playlistRegex.test(authorUrl);

        if (isPlaylist) {
          // Get playlist count - fetch first page to get total count
          const result = await executeYtDlpJson(authorUrl, {
            ...networkConfig,
            noWarnings: true,
            flatPlaylist: true,
            playlistStart: 1,
            playlistEnd: 1, // Just get first entry to get metadata
            ...(PROVIDER_SCRIPT
              ? {
                  extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
                }
              : {}),
          });
          // playlist_count is the total count in the playlist
          return result.playlist_count || 0;
        } else {
          // For channels, we can't easily get count without fetching
          return 0;
        }
      }
    } catch (error) {
      logger.error("Error getting video count:", error);
      return 0;
    }
  }

  /**
   * Get video URLs incrementally (for large playlists to save memory)
   * Returns URLs for a specific range
   */
  async getVideoUrlsIncremental(
    authorUrl: string,
    platform: string,
    startIndex: number,
    batchSize: number = 50,
    subscriptionYtdlpConfig?: string | null
  ): Promise<string[]> {
    try {
      if (platform === "Bilibili") {
        return await this.getBilibiliVideoUrls(
          authorUrl,
          startIndex,
          batchSize,
          subscriptionYtdlpConfig
        );
      } else if (platform === "Twitch") {
        return await this.getTwitchVideoUrls(
          authorUrl,
          subscriptionYtdlpConfig
        );
      } else {
        return await this.getYouTubeVideoUrlsIncremental(
          authorUrl,
          startIndex,
          batchSize,
          subscriptionYtdlpConfig
        );
      }
    } catch (error) {
      logger.error("Error getting video URLs incrementally:", error);
      throw error;
    }
  }

  /**
   * Get all video URLs from a channel/author (for non-incremental mode)
   * This loads all URLs into memory - use with caution for large playlists
   */
  async getAllVideoUrls(
    authorUrl: string,
    platform: string,
    subscriptionYtdlpConfig?: string | null
  ): Promise<string[]> {
    try {
      if (platform === "Bilibili") {
        return await this.getBilibiliVideoUrls(
          authorUrl,
          0,
          undefined,
          subscriptionYtdlpConfig
        );
      } else if (platform === "Twitch") {
        return await this.getTwitchVideoUrls(
          authorUrl,
          subscriptionYtdlpConfig
        );
      } else {
        return await this.getYouTubeVideoUrls(
          authorUrl,
          subscriptionYtdlpConfig
        );
      }
    } catch (error) {
      logger.error("Error getting all video URLs:", error);
      throw error;
    }
  }

  /**
   * Get all video entries with metadata for deterministic historical ordering.
   * Used by the full-fetch + sort + freeze path for non-incremental tasks.
   */
  async getAllVideoEntries(
    authorUrl: string,
    platform: string,
    subscriptionYtdlpConfig?: string | null,
    downloadOrder: DownloadOrder = "dateDesc"
  ): Promise<VideoEntry[]> {
    try {
      if (platform === "Bilibili") {
        return await this.getBilibiliVideoEntries(
          authorUrl,
          subscriptionYtdlpConfig,
          downloadOrder
        );
      } else if (platform === "Twitch") {
        return await this.getTwitchVideoEntries(
          authorUrl,
          subscriptionYtdlpConfig
        );
      } else {
        return await this.getYouTubeVideoEntries(
          authorUrl,
          subscriptionYtdlpConfig,
          downloadOrder
        );
      }
    } catch (error) {
      logger.error("Error getting all video entries:", error);
      throw error;
    }
  }

  /**
   * Get YouTube video entries with metadata
   */
  private async getYouTubeVideoEntries(
    authorUrl: string,
    subscriptionYtdlpConfig?: string | null,
    downloadOrder: DownloadOrder = "dateDesc"
  ): Promise<VideoEntry[]> {
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getEffectiveUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const { getProviderScript } = await import(
      "../downloaders/ytdlp/ytdlpHelpers"
    );
    const userConfig = getEffectiveUserYtDlpConfig(
      authorUrl,
      subscriptionYtdlpConfig
    );
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const PROVIDER_SCRIPT = getProviderScript();

    const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
    const isPlaylist = playlistRegex.test(authorUrl);

    let targetUrl = authorUrl;
    if (!isPlaylist) {
      if (
        !targetUrl.includes("/videos") &&
        !targetUrl.includes("/shorts") &&
        !targetUrl.includes("/streams")
      ) {
        targetUrl = targetUrl.endsWith("/")
          ? `${targetUrl}videos`
          : `${targetUrl}/videos`;
      }
    }

    const entries: VideoEntry[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      try {
        const result = await executeYtDlpJson(targetUrl, {
          ...networkConfig,
          noWarnings: true,
          flatPlaylist: true,
          playlistStart: (page - 1) * pageSize + 1,
          playlistEnd: page * pageSize,
          ...(PROVIDER_SCRIPT
            ? { extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}` }
            : {}),
        });

        if (result.entries && result.entries.length > 0) {
          for (const entry of result.entries) {
            if (entry.id && !entry.id.startsWith("UC")) {
              const url = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;
              entries.push(createVideoEntry({
                url,
                sourceVideoId: entry.id,
                publishedAt: entry.upload_date ?? entry.timestamp ?? entry.release_timestamp,
                viewCount: entry.view_count,
                sourceIndex: entries.length,
              }));
            }
          }
          hasMore = result.entries.length === pageSize;
          page++;
        } else {
          hasMore = false;
        }
      } catch (error) {
        logger.error(`Error fetching YouTube video entries page ${page}:`, error);
        throw new SourceEnumerationFailedError(
          "YouTube",
          page,
          entries.length,
          error
        );
      }
    }

    const hydrated = await this.hydrateYouTubeEntriesForOrder(
      entries,
      downloadOrder,
      networkConfig,
      PROVIDER_SCRIPT
    );

    logger.info("Found video entries for source", {
      entryCount: hydrated.length,
      authorUrl,
    });
    return hydrated;
  }

  private async hydrateYouTubeEntriesForOrder(
    entries: VideoEntry[],
    downloadOrder: DownloadOrder,
    networkConfig: Record<string, unknown>,
    providerScript?: string | null
  ): Promise<VideoEntry[]> {
    if (!entries.some((entry) => metadataRequired(downloadOrder, entry))) {
      return entries;
    }

    const { executeYtDlpJson } = await import("../../utils/ytDlpUtils");
    const hydrated = [...entries];
    const targets = hydrated
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => metadataRequired(downloadOrder, entry));

    await runWithBoundedConcurrency(
      targets,
      YOUTUBE_HYDRATE_METADATA_CONCURRENCY,
      async ({ entry, index }) => {
        try {
          const info = await executeYtDlpJson(entry.url, {
            ...networkConfig,
            noWarnings: true,
            ...(providerScript
              ? {
                  extractorArgs: `youtubepot-bgutilscript:script_path=${providerScript}`,
                }
              : {}),
          });
          const richer = createVideoEntry({
            url:
              typeof info.webpage_url === "string" && info.webpage_url
                ? info.webpage_url
                : entry.url,
            sourceVideoId:
              typeof info.id === "string" && info.id ? info.id : entry.sourceVideoId,
            publishedAt:
              info.upload_date ?? info.timestamp ?? info.release_timestamp,
            viewCount: info.view_count,
            sourceIndex: entry.sourceIndex,
          });
          hydrated[index] = mergeEntryMetadata(entry, richer);
        } catch (error) {
          logger.warn("Unable to hydrate YouTube ordering metadata", {
            url: entry.url,
            order: downloadOrder,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );

    return hydrated;
  }

  /**
   * Get Bilibili video entries with metadata (preserves existing resolution behavior)
   */
  private async getBilibiliVideoEntries(
    authorUrl: string,
    subscriptionYtdlpConfig?: string | null,
    downloadOrder: DownloadOrder = "dateDesc"
  ): Promise<VideoEntry[]> {
    const entries: VideoEntry[] = [];
    const { extractBilibiliMid, extractBilibiliVideoId } = await import("../../utils/helpers");
    const { checkBilibiliCollectionOrSeries } = await import("../../services/downloadService");
    const { getCollectionVideos, getSeriesVideos } = await import("../../services/downloaders/bilibili/bilibiliCollection");

    // First, try to extract mid from space URL
    let mid = extractBilibiliMid(authorUrl);

    // If not a space URL, check if it's a video URL that belongs to a collection
    if (!mid) {
      const videoId = extractBilibiliVideoId(authorUrl);
      if (videoId) {
        const collectionInfo = await checkBilibiliCollectionOrSeries(videoId);
        if (
          collectionInfo.success &&
          collectionInfo.type !== "none" &&
          collectionInfo.mid &&
          collectionInfo.id
        ) {
          logger.info(
            `Detected Bilibili ${collectionInfo.type} from video URL, using collection API`
          );

          let videosResult;
          if (collectionInfo.type === "collection") {
            videosResult = await getCollectionVideos(collectionInfo.mid, collectionInfo.id);
          } else if (collectionInfo.type === "series") {
            videosResult = await getSeriesVideos(collectionInfo.mid, collectionInfo.id);
          } else {
            throw new Error(`Unsupported Bilibili type: ${collectionInfo.type}`);
          }

          if (!videosResult.success || videosResult.videos.length === 0) {
            throw new Error(`Failed to get videos from ${collectionInfo.type}`);
          }

          for (const video of videosResult.videos) {
            if (!video.bvid) {
              continue;
            }
            entries.push(createVideoEntry({
              url: `https://www.bilibili.com/video/${video.bvid}`,
              sourceVideoId: video.bvid,
              publishedAt: video.uploadDate,
              viewCount: video.viewCount,
              sourceIndex: entries.length,
            }));
          }

          logger.info("Found Bilibili video entries for source", {
            entryCount: entries.length,
            authorUrl,
          });
          return entries;
        }
      }

      // If we still don't have a mid, it's an invalid URL
      throw new Error("Invalid Bilibili space URL or collection URL");
    }

    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getEffectiveUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const userConfig = getEffectiveUserYtDlpConfig(
      authorUrl,
      subscriptionYtdlpConfig
    );
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const videosUrl = `https://space.bilibili.com/${mid}/video`;

    try {
      let hasMore = true;
      let page = 1;
      const pageSize = 100;

      while (hasMore) {
        try {
          const result = await executeYtDlpJson(videosUrl, {
            ...networkConfig,
            noWarnings: true,
            flatPlaylist: true,
            playlistStart: (page - 1) * pageSize + 1,
            playlistEnd: page * pageSize,
          });

          if (result.entries && result.entries.length > 0) {
            for (const entry of result.entries) {
              if (entry.id && entry.id.startsWith("BV")) {
                entries.push(createVideoEntry({
                  url: entry.url || `https://www.bilibili.com/video/${entry.id}`,
                  sourceVideoId: entry.id,
                  publishedAt:
                    entry.upload_date ?? entry.release_timestamp ?? entry.timestamp
                  ,
                  viewCount: entry.view_count,
                  sourceIndex: entries.length,
                }));
              }
            }
            hasMore = result.entries.length === pageSize;
            page++;
          } else {
            hasMore = false;
          }
        } catch (error) {
          logger.error(`Error fetching Bilibili video entries page ${page}:`, error);
          hasMore = false;
        }
      }

      // If yt-dlp didn't return entries or returned URL-only rows, fall back to
      // the public space API and merge richer metadata by BVID.
      if (
        entries.length === 0 ||
        entries.some((entry) => metadataRequired(downloadOrder, entry))
      ) {
        logger.info("yt-dlp returned no Bilibili entries, trying API fallback...");
        const apiEntries: VideoEntry[] = [];
        const axios = await import("axios");
        let pageNum = 1;
        const pageSize = 50;
        let hasMoreApi = true;
        let fetchedCount = 0;

        while (hasMoreApi) {
          try {
            const response = await axios.default.get(
              `https://api.bilibili.com/x/space/arc/search?mid=${mid}&pn=${pageNum}&ps=${pageSize}&order=pubdate`,
              {
                headers: {
                  Referer: "https://www.bilibili.com",
                  "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                },
              }
            );

            const data = response.data;
            if (
              data &&
              data.code === 0 &&
              data.data &&
              data.data.list &&
              data.data.list.vlist
            ) {
              const videos = data.data.list.vlist;
              for (const video of videos) {
                if (!video.bvid) {
                  continue;
                }
                apiEntries.push(createVideoEntry({
                  url: `https://www.bilibili.com/video/${video.bvid}`,
                  sourceVideoId: video.bvid,
                  publishedAt: video.created ?? video.pubdate,
                  viewCount: video.play,
                  sourceIndex: apiEntries.length,
                }));
              }

              fetchedCount += videos.length;
              const total = data.data.page?.count || 0;
              hasMoreApi = fetchedCount < total && videos.length === pageSize;
              pageNum++;
            } else {
              hasMoreApi = false;
            }
          } catch (error) {
            logger.error(
              `Error fetching Bilibili API fallback page ${pageNum}:`,
              error
            );
            hasMoreApi = false;
          }
        }

        if (entries.length === 0) {
          entries.push(...apiEntries);
        } else if (apiEntries.length > 0) {
          const apiById = new Map(
            apiEntries.map((entry) => [entry.sourceVideoId, entry])
          );
          for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            const richer = apiById.get(entry.sourceVideoId);
            if (richer) {
              entries[index] = mergeEntryMetadata(entry, richer);
            }
          }
        }
      }
    } catch (error) {
      logger.error("Error fetching Bilibili video entries:", error);
      throw error;
    }

    logger.info("Found Bilibili video entries for source", {
      entryCount: entries.length,
      authorUrl,
    });
    return entries;
  }

  private async getTwitchVideoEntries(
    authorUrl: string,
    subscriptionYtdlpConfig?: string | null
  ): Promise<VideoEntry[]> {
    const { extractTwitchChannelLogin, normalizeTwitchChannelUrl } =
      await import("../../utils/helpers");
    const { getTwitchChannelVideos } = await import(
      "../downloaders/ytdlp/ytdlpTwitch"
    );
    const { twitchApiService } = await import("../twitchService");

    const normalizedUrl = normalizeTwitchChannelUrl(authorUrl);
    const login = extractTwitchChannelLogin(normalizedUrl);
    if (!login) {
      throw new Error("Invalid Twitch channel URL");
    }

    if (!twitchApiService.isConfigured()) {
      const entries: VideoEntry[] = [];
      let page = 0;
      let hasMore = true;

      while (hasMore && page < MAX_TWITCH_VIDEO_ENTRY_PAGES) {
        const result = await getTwitchChannelVideos(normalizedUrl, {
          startIndex: page * 100,
          limit: 100,
          subscriptionYtdlpConfig,
        });

        if (result.videos.length === 0) {
          hasMore = false;
          continue;
        }

        for (const video of result.videos) {
          entries.push(createVideoEntry({
            url: video.url,
            sourceVideoId: video.id,
            publishedAt: video.uploadDate,
            viewCount: video.viewCount,
            sourceIndex: entries.length,
          }));
        }

        hasMore = result.videos.length === 100;
        page += 1;
      }

      if (hasMore) {
        logger.warn(
          `Stopped Twitch yt-dlp pagination early after ${MAX_TWITCH_VIDEO_ENTRY_PAGES} pages for ${authorUrl}`
        );
      }

      logger.info("Found Twitch video entries for source", {
        entryCount: entries.length,
        authorUrl,
      });
      return entries;
    }

    const channel = await twitchApiService.getChannelByLogin(login);
    if (!channel) {
      throw new Error(`Twitch channel not found: ${login}`);
    }

    const entries: VideoEntry[] = [];
    const fetchTypeEntries = async (type: "archive" | "upload") => {
      let after: string | undefined;
      let pageCount = 0;

      do {
        if (pageCount >= MAX_TWITCH_VIDEO_ENTRY_PAGES) {
          logger.warn(
            `Stopped Twitch API pagination early after ${MAX_TWITCH_VIDEO_ENTRY_PAGES} ${type} pages for ${authorUrl}`
          );
          break;
        }

        const response = await twitchApiService.listVideosByBroadcaster(
          channel.id,
          {
            after,
            first: 100,
            type,
          }
        );
        pageCount += 1;

        for (const video of response.videos) {
          entries.push(createVideoEntry({
            url: video.url,
            sourceVideoId: video.id,
            publishedAt: video.publishedAt,
            viewCount: video.viewCount,
            sourceIndex: entries.length,
          }));
        }

        after = response.cursor;
      } while (after);
    };

    await fetchTypeEntries("archive");
    await fetchTypeEntries("upload");

    logger.info("Found Twitch video entries for source", {
      entryCount: entries.length,
      authorUrl,
    });
    return entries;
  }

  private async getTwitchVideoUrls(
    authorUrl: string,
    subscriptionYtdlpConfig?: string | null
  ): Promise<string[]> {
    const entries = await this.getTwitchVideoEntries(
      authorUrl,
      subscriptionYtdlpConfig
    );
    return entries.map((entry) => entry.url);
  }

  /**
   * Get Bilibili video URLs (all or incremental)
   * Supports both space URLs and collection/series URLs
   */
  private async getBilibiliVideoUrls(
    authorUrl: string,
    startIndex: number = 0,
    batchSize?: number,
    subscriptionYtdlpConfig?: string | null
  ): Promise<string[]> {
    const videoUrls: string[] = [];
    const { extractBilibiliMid, extractBilibiliVideoId } = await import("../../utils/helpers");
    const { checkBilibiliCollectionOrSeries } = await import("../../services/downloadService");
    const { getCollectionVideos, getSeriesVideos } = await import("../../services/downloaders/bilibili/bilibiliCollection");
    
    // First, try to extract mid from space URL
    let mid = extractBilibiliMid(authorUrl);

    // If not a space URL, check if it's a video URL that belongs to a collection
    if (!mid) {
      const videoId = extractBilibiliVideoId(authorUrl);
      if (videoId) {
        // Check if this video belongs to a collection or series
        const collectionInfo = await checkBilibiliCollectionOrSeries(videoId);
        if (collectionInfo.success && collectionInfo.type !== "none" && collectionInfo.mid && collectionInfo.id) {
          // It's a collection or series, use the collection API
          logger.info(`Detected Bilibili ${collectionInfo.type} from video URL, using collection API`);
          let videosResult;
          if (collectionInfo.type === "collection") {
            videosResult = await getCollectionVideos(collectionInfo.mid, collectionInfo.id);
          } else if (collectionInfo.type === "series") {
            videosResult = await getSeriesVideos(collectionInfo.mid, collectionInfo.id);
          } else {
            throw new Error(`Unsupported Bilibili type: ${collectionInfo.type}`);
          }

          if (videosResult.success && videosResult.videos.length > 0) {
            // Convert Bilibili video items to URLs
            for (const video of videosResult.videos) {
              if (video.bvid) {
                videoUrls.push(`https://www.bilibili.com/video/${video.bvid}`);
              }
            }
            
            // Apply startIndex and batchSize if specified
            if (startIndex > 0 || batchSize) {
              const endIndex = batchSize ? startIndex + batchSize : videoUrls.length;
              return videoUrls.slice(startIndex, endIndex);
            }
            return videoUrls;
          } else {
            throw new Error(`Failed to get videos from ${collectionInfo.type}`);
          }
        }
      }
      
      // If we still don't have a mid, it's an invalid URL
      throw new Error("Invalid Bilibili space URL or collection URL");
    }

    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getEffectiveUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const userConfig = getEffectiveUserYtDlpConfig(
      authorUrl,
      subscriptionYtdlpConfig
    );
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    // Use yt-dlp to get all videos from the space
    const videosUrl = `https://space.bilibili.com/${mid}/video`;

    try {
      // Fetch all videos using flat playlist
      let hasMore = true;
      let page = 1;
      const pageSize = 100;

      while (hasMore) {
        try {
          const result = await executeYtDlpJson(videosUrl, {
            ...networkConfig,
            noWarnings: true,
            flatPlaylist: true,
            playlistStart: (page - 1) * pageSize + 1,
            playlistEnd: page * pageSize,
          });

          if (result.entries && result.entries.length > 0) {
            for (const entry of result.entries) {
              if (entry.id && entry.id.startsWith("BV")) {
                // Valid Bilibili video ID
                videoUrls.push(
                  entry.url || `https://www.bilibili.com/video/${entry.id}`
                );
              }
            }
            hasMore = result.entries.length === pageSize;
            page++;
          } else {
            hasMore = false;
          }
        } catch (error) {
          logger.error(
            `Error fetching Bilibili videos page ${page}:`,
            error
          );
          hasMore = false;
        }
      }

      // If yt-dlp didn't work, try API fallback
      if (videoUrls.length === 0) {
        logger.info("yt-dlp returned no videos, trying API fallback...");
        const axios = await import("axios");
        let pageNum = 1;
        const pageSize = 50;
        let hasMoreApi = true;

        while (hasMoreApi) {
          try {
            const response = await axios.default.get(
              `https://api.bilibili.com/x/space/arc/search?mid=${mid}&pn=${pageNum}&ps=${pageSize}&order=pubdate`,
              {
                headers: {
                  Referer: "https://www.bilibili.com",
                  "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                },
              }
            );

            const data = response.data;
            if (
              data &&
              data.code === 0 &&
              data.data &&
              data.data.list &&
              data.data.list.vlist
            ) {
              const videos = data.data.list.vlist;
              for (const video of videos) {
                if (video.bvid) {
                  videoUrls.push(
                    `https://www.bilibili.com/video/${video.bvid}`
                  );
                }
              }

              const total = data.data.page?.count || 0;
              hasMoreApi =
                videoUrls.length < total && videos.length === pageSize;
              pageNum++;
            } else {
              hasMoreApi = false;
            }
          } catch (error) {
            logger.error(
              `Error fetching Bilibili videos page ${pageNum}:`,
              error
            );
            hasMoreApi = false;
          }
        }

      }
    } catch (error) {
      logger.error("Error fetching Bilibili videos with yt-dlp:", error);
      throw error;
    }

    logger.info("Found videos for source", {
      videoCount: videoUrls.length,
      authorUrl,
    });
    return videoUrls;
  }

  /**
   * Get YouTube video URLs incrementally
   */
  private async getYouTubeVideoUrlsIncremental(
    authorUrl: string,
    startIndex: number,
    batchSize: number,
    subscriptionYtdlpConfig?: string | null
  ): Promise<string[]> {
    const videoUrls: string[] = [];
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getEffectiveUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const { getProviderScript } = await import(
      "../downloaders/ytdlp/ytdlpHelpers"
    );
    const userConfig = getEffectiveUserYtDlpConfig(
      authorUrl,
      subscriptionYtdlpConfig
    );
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const PROVIDER_SCRIPT = getProviderScript();

    // Check if it's a playlist URL
    const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
    const isPlaylist = playlistRegex.test(authorUrl);

    if (isPlaylist) {
      // For playlists, fetch only the batch we need
      const endIndex = startIndex + batchSize;
      try {
        const result = await executeYtDlpJson(authorUrl, {
          ...networkConfig,
          noWarnings: true,
          flatPlaylist: true,
          playlistStart: startIndex + 1, // yt-dlp is 1-indexed
          playlistEnd: endIndex,
          ...(PROVIDER_SCRIPT
            ? {
                extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
              }
            : {}),
        });

        if (result.entries && result.entries.length > 0) {
          for (const entry of result.entries) {
            if (entry.id && !entry.id.startsWith("UC")) {
              // Skip channel IDs
              videoUrls.push(
                entry.url || `https://www.youtube.com/watch?v=${entry.id}`
              );
            }
          }
        }
      } catch (error) {
        logger.error(
          `Error fetching playlist videos batch ${startIndex}-${startIndex + batchSize}:`,
          error
        );
      }
    } else {
      // For channels, we need to fetch all (can't do incremental easily)
      return await this.getYouTubeVideoUrls(
        authorUrl,
        subscriptionYtdlpConfig
      );
    }

    return videoUrls;
  }

  /**
   * Get all YouTube video URLs
   */
  private async getYouTubeVideoUrls(
    authorUrl: string,
    subscriptionYtdlpConfig?: string | null
  ): Promise<string[]> {
    const videoUrls: string[] = [];
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getEffectiveUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const { getProviderScript } = await import(
      "../downloaders/ytdlp/ytdlpHelpers"
    );
    const userConfig = getEffectiveUserYtDlpConfig(
      authorUrl,
      subscriptionYtdlpConfig
    );
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const PROVIDER_SCRIPT = getProviderScript();

    // Check if it's a playlist URL
    const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
    const isPlaylist = playlistRegex.test(authorUrl);

    if (isPlaylist) {
      // For playlists, fetch all videos directly from the playlist URL
      let hasMore = true;
      let page = 1;
      const pageSize = 100;

      while (hasMore) {
        try {
          const result = await executeYtDlpJson(authorUrl, {
            ...networkConfig,
            noWarnings: true,
            flatPlaylist: true,
            playlistStart: (page - 1) * pageSize + 1,
            playlistEnd: page * pageSize,
            ...(PROVIDER_SCRIPT
              ? {
                  extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
                }
              : {}),
          });

          if (result.entries && result.entries.length > 0) {
            for (const entry of result.entries) {
              if (entry.id && !entry.id.startsWith("UC")) {
                // Skip channel IDs
                videoUrls.push(
                  entry.url || `https://www.youtube.com/watch?v=${entry.id}`
                );
              }
            }
            hasMore = result.entries.length === pageSize;
            page++;
          } else {
            hasMore = false;
          }
        } catch (error) {
          logger.error(
            `Error fetching playlist videos page ${page}:`,
            error
          );
          hasMore = false;
        }
      }
    } else {
      // For channels, construct URL to get videos from the channel
      let targetUrl = authorUrl;
      if (
        !targetUrl.includes("/videos") &&
        !targetUrl.includes("/shorts") &&
        !targetUrl.includes("/streams")
      ) {
        if (targetUrl.endsWith("/")) {
          targetUrl = `${targetUrl}videos`;
        } else {
          targetUrl = `${targetUrl}/videos`;
        }
      }

      // Fetch all videos using flat playlist
      let hasMore = true;
      let page = 1;
      const pageSize = 100;

      while (hasMore) {
        try {
          const result = await executeYtDlpJson(targetUrl, {
            ...networkConfig,
            noWarnings: true,
            flatPlaylist: true,
            playlistStart: (page - 1) * pageSize + 1,
            playlistEnd: page * pageSize,
            ...(PROVIDER_SCRIPT
              ? {
                  extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
                }
              : {}),
          });

          if (result.entries && result.entries.length > 0) {
            for (const entry of result.entries) {
              if (entry.id && !entry.id.startsWith("UC")) {
                // Skip channel IDs
                videoUrls.push(
                  entry.url || `https://www.youtube.com/watch?v=${entry.id}`
                );
              }
            }
            hasMore = result.entries.length === pageSize;
            page++;
          } else {
            hasMore = false;
          }
        } catch (error) {
          logger.error(
            `Error fetching YouTube videos page ${page}:`,
            error
          );
          hasMore = false;
        }
      }
    }

    logger.info("Found videos for source", {
      videoCount: videoUrls.length,
      authorUrl,
    });
    return videoUrls;
  }
}
