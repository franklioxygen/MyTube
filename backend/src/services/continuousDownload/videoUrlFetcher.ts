import { logger } from "../../utils/logger";

/**
 * Service for fetching video URLs from different platforms
 */
export class VideoUrlFetcher {
  /**
   * Get total video count without loading all URLs (memory efficient)
   */
  async getVideoCount(
    authorUrl: string,
    platform: string
  ): Promise<number> {
    try {
      if (platform === "Bilibili") {
        // For Bilibili, we'd need to make a lightweight API call
        // For now, return 0 and let getAllVideoUrls handle it
        return 0;
      } else {
        // For YouTube playlists, get count from playlist info
        const {
          executeYtDlpJson,
          getNetworkConfigFromUserConfig,
          getUserYtDlpConfig,
        } = await import("../../utils/ytDlpUtils");
        const { getProviderScript } = await import(
          "../downloaders/ytdlp/ytdlpHelpers"
        );
        const userConfig = getUserYtDlpConfig(authorUrl);
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
    batchSize: number = 50
  ): Promise<string[]> {
    const videoUrls: string[] = [];

    try {
      if (platform === "Bilibili") {
        return await this.getBilibiliVideoUrls(authorUrl, startIndex, batchSize);
      } else {
        return await this.getYouTubeVideoUrlsIncremental(
          authorUrl,
          startIndex,
          batchSize
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
    platform: string
  ): Promise<string[]> {
    try {
      if (platform === "Bilibili") {
        return await this.getBilibiliVideoUrls(authorUrl);
      } else {
        return await this.getYouTubeVideoUrls(authorUrl);
      }
    } catch (error) {
      logger.error("Error getting all video URLs:", error);
      throw error;
    }
  }

  /**
   * Get Bilibili video URLs (all or incremental)
   * Supports both space URLs and collection/series URLs
   */
  private async getBilibiliVideoUrls(
    authorUrl: string,
    startIndex: number = 0,
    batchSize?: number
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
      getUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const userConfig = getUserYtDlpConfig(authorUrl);
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

    logger.info(`Found ${videoUrls.length} videos for ${authorUrl}`);
    return videoUrls;
  }

  /**
   * Get YouTube video URLs incrementally
   */
  private async getYouTubeVideoUrlsIncremental(
    authorUrl: string,
    startIndex: number,
    batchSize: number
  ): Promise<string[]> {
    const videoUrls: string[] = [];
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const { getProviderScript } = await import(
      "../downloaders/ytdlp/ytdlpHelpers"
    );
    const userConfig = getUserYtDlpConfig(authorUrl);
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
      return await this.getYouTubeVideoUrls(authorUrl);
    }

    return videoUrls;
  }

  /**
   * Get all YouTube video URLs
   */
  private async getYouTubeVideoUrls(authorUrl: string): Promise<string[]> {
    const videoUrls: string[] = [];
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const { getProviderScript } = await import(
      "../downloaders/ytdlp/ytdlpHelpers"
    );
    const userConfig = getUserYtDlpConfig(authorUrl);
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

    logger.info(`Found ${videoUrls.length} videos for ${authorUrl}`);
    return videoUrls;
  }
}

