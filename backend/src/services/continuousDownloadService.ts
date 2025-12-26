import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { continuousDownloadTasks } from "../db/schema";
import { logger } from "../utils/logger";
import {
    downloadSingleBilibiliPart,
    downloadYouTubeVideo,
} from "./downloadService";
import * as storageService from "./storageService";

export interface ContinuousDownloadTask {
  id: string;
  subscriptionId?: string;
  collectionId?: string; // For playlist tasks
  playlistName?: string; // Name of the collection (playlist)
  authorUrl: string;
  author: string;
  platform: string;
  status: "active" | "paused" | "completed" | "cancelled";
  totalVideos: number;
  downloadedCount: number;
  skippedCount: number;
  failedCount: number;
  currentVideoIndex: number;
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  error?: string;
}

export class ContinuousDownloadService {
  private static instance: ContinuousDownloadService;
  private processingTasks: Set<string> = new Set();
  // Cache video URLs for tasks to avoid re-fetching large playlists
  // Use WeakMap to allow garbage collection when tasks are deleted
  private videoUrlCache: Map<string, string[]> = new Map();
  // Track which tasks are using incremental fetching (for large playlists)
  private incrementalFetchTasks: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): ContinuousDownloadService {
    if (!ContinuousDownloadService.instance) {
      ContinuousDownloadService.instance = new ContinuousDownloadService();
    }
    return ContinuousDownloadService.instance;
  }

  /**
   * Create a new continuous download task
   */
  async createTask(
    authorUrl: string,
    author: string,
    platform: string,
    subscriptionId?: string
  ): Promise<ContinuousDownloadTask> {
    const task: ContinuousDownloadTask = {
      id: uuidv4(),
      subscriptionId,
      authorUrl,
      author,
      platform,
      status: "active",
      totalVideos: 0,
      downloadedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      currentVideoIndex: 0,
      createdAt: Date.now(),
    };

    // Remove playlistName from the insert object as it's not in the table
    const { playlistName, ...taskToInsert } = task;
    await db.insert(continuousDownloadTasks).values(taskToInsert);
    logger.info(
      `Created continuous download task ${task.id} for ${author} (${platform})`
    );

    // Start processing the task asynchronously
    this.processTask(task.id).catch((error) => {
      logger.error(`Error processing task ${task.id}:`, error);
    });

    return task;
  }

  /**
   * Create a new continuous download task for a playlist
   */
  async createPlaylistTask(
    playlistUrl: string,
    author: string,
    platform: string,
    collectionId: string
  ): Promise<ContinuousDownloadTask> {
    const task: ContinuousDownloadTask = {
      id: uuidv4(),
      collectionId,
      authorUrl: playlistUrl,
      author,
      platform,
      status: "active",
      totalVideos: 0,
      downloadedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      currentVideoIndex: 0,
      createdAt: Date.now(),
    };

    // Remove playlistName from the insert object as it's not in the table
    const { playlistName, ...taskToInsert } = task;
    await db.insert(continuousDownloadTasks).values(taskToInsert);
    logger.info(
      `Created playlist download task ${task.id} for collection ${collectionId} (${platform})`
    );

    // Start processing the task asynchronously
    this.processTask(task.id).catch((error) => {
      logger.error(`Error processing task ${task.id}:`, error);
    });

    return task;
  }

  /**
   * Get all tasks
   */
  async getAllTasks(): Promise<ContinuousDownloadTask[]> {
    const { collections } = await import("../db/schema");
    const result = await db
      .select({
        task: continuousDownloadTasks,
        playlistName: collections.name,
      })
      .from(continuousDownloadTasks)
      .leftJoin(
        collections,
        eq(continuousDownloadTasks.collectionId, collections.id)
      );

    // Convert null to undefined for TypeScript compatibility and ensure status type
    return result.map(({ task, playlistName }) => ({
      ...task,
      subscriptionId: task.subscriptionId ?? undefined,
      collectionId: task.collectionId ?? undefined,
      playlistName: playlistName ?? undefined,
      updatedAt: task.updatedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
      error: task.error ?? undefined,
      status: task.status as "active" | "paused" | "completed" | "cancelled",
      totalVideos: task.totalVideos ?? 0,
      downloadedCount: task.downloadedCount ?? 0,
      skippedCount: task.skippedCount ?? 0,
      failedCount: task.failedCount ?? 0,
      currentVideoIndex: task.currentVideoIndex ?? 0,
    }));
  }

  /**
   * Get a task by ID
   */
  async getTaskById(id: string): Promise<ContinuousDownloadTask | null> {
    const { collections } = await import("../db/schema");
    const result = await db
      .select({
        task: continuousDownloadTasks,
        playlistName: collections.name,
      })
      .from(continuousDownloadTasks)
      .leftJoin(
        collections,
        eq(continuousDownloadTasks.collectionId, collections.id)
      )
      .where(eq(continuousDownloadTasks.id, id))
      .limit(1);

    if (result.length === 0) return null;
    
    const { task, playlistName } = result[0];
    
    // Convert null to undefined for TypeScript compatibility and ensure status type
    return {
      ...task,
      subscriptionId: task.subscriptionId ?? undefined,
      collectionId: task.collectionId ?? undefined,
      playlistName: playlistName ?? undefined,
      updatedAt: task.updatedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
      error: task.error ?? undefined,
      status: task.status as "active" | "paused" | "completed" | "cancelled",
      totalVideos: task.totalVideos ?? 0,
      downloadedCount: task.downloadedCount ?? 0,
      skippedCount: task.skippedCount ?? 0,
      failedCount: task.failedCount ?? 0,
      currentVideoIndex: task.currentVideoIndex ?? 0,
    };
  }

  /**
   * Cancel a task
   */
  async cancelTask(id: string): Promise<void> {
    const task = await this.getTaskById(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.status === "completed" || task.status === "cancelled") {
      return; // Already completed or cancelled
    }

    // Clean up temporary files for the current video being downloaded
    try {
      await this.cleanupCurrentVideoTempFiles(task);
    } catch (error) {
      logger.error(`Error cleaning up temp files for task ${id}:`, error);
      // Continue with cancellation even if cleanup fails
    }

    // Clear cached video URLs for this task
    const cacheKey = `${id}:${task.authorUrl}`;
    this.videoUrlCache.delete(cacheKey);

    await db
      .update(continuousDownloadTasks)
      .set({
        status: "cancelled",
        updatedAt: Date.now(),
      })
      .where(eq(continuousDownloadTasks.id, id));

    logger.info(`Cancelled continuous download task ${id}`);
  }

  /**
   * Clean up temporary files for the current video being downloaded in a task
   */
  private async cleanupCurrentVideoTempFiles(
    task: ContinuousDownloadTask
  ): Promise<void> {
    // If no videos have been processed yet, nothing to clean up
    if (task.currentVideoIndex === 0 || task.totalVideos === 0) {
      return;
    }

    try {
      // Get the video URL that's currently being downloaded
      const videoUrls = await this.getAllVideoUrls(
        task.authorUrl,
        task.platform
      );

      if (task.currentVideoIndex < videoUrls.length) {
        const currentVideoUrl = videoUrls[task.currentVideoIndex];
        logger.info(
          `Cleaning up temp files for current video: ${currentVideoUrl}`
        );

        // Get video info to determine the expected filename
        const { getVideoInfo } = await import("./downloadService");
        const videoInfo = await getVideoInfo(currentVideoUrl);

        if (videoInfo && videoInfo.title) {
          const { formatVideoFilename } = await import("../utils/helpers");
          const { VIDEOS_DIR } = await import("../config/paths");
          const path = await import("path");

          // Generate the expected base filename
          const baseFilename = formatVideoFilename(
            videoInfo.title,
            videoInfo.author || task.author,
            videoInfo.date ||
              new Date().toISOString().slice(0, 10).replace(/-/g, "")
          );

          // Clean up video artifacts (temp files, .part files, etc.)
          const { cleanupVideoArtifacts } = await import(
            "../utils/downloadUtils"
          );
          const deletedFiles = await cleanupVideoArtifacts(
            baseFilename,
            VIDEOS_DIR
          );

          if (deletedFiles.length > 0) {
            logger.info(
              `Cleaned up ${deletedFiles.length} temp files for cancelled task ${task.id}`
            );
          }

          // Also check active downloads and cancel any matching download
          const downloadStatus = storageService.getDownloadStatus();
          const activeDownloads = downloadStatus.activeDownloads || [];

          for (const download of activeDownloads) {
            if (
              download.sourceUrl === currentVideoUrl ||
              (download.filename && download.filename.includes(baseFilename))
            ) {
              // Cancel this download
              logger.info(
                `Cancelling active download ${download.id} for video ${currentVideoUrl}`
              );
              storageService.removeActiveDownload(download.id);

              // Clean up temp files for this download
              if (download.filename) {
                const { cleanupVideoArtifacts: cleanupArtifacts } =
                  await import("../utils/downloadUtils");
                const path = await import("path");
                // Extract base filename without extension
                const baseFilename = path.basename(
                  download.filename,
                  path.extname(download.filename)
                );
                await cleanupArtifacts(baseFilename, VIDEOS_DIR);
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(
        `Error in cleanupCurrentVideoTempFiles for task ${task.id}:`,
        error
      );
      // Don't throw - we want cancellation to proceed even if cleanup fails
    }
  }

  /**
   * Delete a task (remove from database)
   */
  async deleteTask(id: string): Promise<void> {
    const task = await this.getTaskById(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    // Clear cached video URLs for this task
    const cacheKey = `${id}:${task.authorUrl}`;
    this.videoUrlCache.delete(cacheKey);

    await db
      .delete(continuousDownloadTasks)
      .where(eq(continuousDownloadTasks.id, id));

    logger.info(`Deleted continuous download task ${id}`);
  }

  /**
   * Get total video count without loading all URLs (memory efficient)
   */
  private async getVideoCount(
    authorUrl: string,
    platform: string
  ): Promise<number> {
    try {
      if (platform === "Bilibili") {
        const { extractBilibiliMid } = await import("../utils/helpers");
        const mid = extractBilibiliMid(authorUrl);
        if (!mid) {
          throw new Error("Invalid Bilibili space URL");
        }
        // For Bilibili, we'd need to make a lightweight API call
        // For now, return 0 and let getAllVideoUrls handle it
        return 0;
      } else {
        // For YouTube playlists, get count from playlist info
        const {
          executeYtDlpJson,
          getNetworkConfigFromUserConfig,
          getUserYtDlpConfig,
        } = await import("../utils/ytDlpUtils");
        const { getProviderScript } = await import(
          "./downloaders/ytdlp/ytdlpHelpers"
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
  private async getVideoUrlsIncremental(
    authorUrl: string,
    platform: string,
    startIndex: number,
    batchSize: number = 50
  ): Promise<string[]> {
    const videoUrls: string[] = [];

    try {
      if (platform === "Bilibili") {
        // For Bilibili, use yt-dlp to get all videos (more reliable than API)
        const { extractBilibiliMid } = await import("../utils/helpers");
        const mid = extractBilibiliMid(authorUrl);

        if (!mid) {
          throw new Error("Invalid Bilibili space URL");
        }

        const {
          executeYtDlpJson,
          getNetworkConfigFromUserConfig,
          getUserYtDlpConfig,
        } = await import("../utils/ytDlpUtils");
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
      } else {
        // For YouTube, use yt-dlp to get all videos
        const {
          executeYtDlpJson,
          getNetworkConfigFromUserConfig,
          getUserYtDlpConfig,
        } = await import("../utils/ytDlpUtils");
        const { getProviderScript } = await import(
          "./downloaders/ytdlp/ytdlpHelpers"
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
              `Error fetching playlist videos batch ${startIndex}-${endIndex}:`,
              error
            );
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
      }
    } catch (error) {
      logger.error("Error getting all video URLs:", error);
      throw error;
    }

    logger.info(`Found ${videoUrls.length} videos for ${authorUrl}`);
    return videoUrls;
  }

  /**
   * Get all video URLs from a channel/author (for non-incremental mode)
   * This loads all URLs into memory - use with caution for large playlists
   */
  private async getAllVideoUrls(
    authorUrl: string,
    platform: string
  ): Promise<string[]> {
    const videoUrls: string[] = [];

    try {
      if (platform === "Bilibili") {
        // For Bilibili, use yt-dlp to get all videos (more reliable than API)
        const { extractBilibiliMid } = await import("../utils/helpers");
        const mid = extractBilibiliMid(authorUrl);

        if (!mid) {
          throw new Error("Invalid Bilibili space URL");
        }

        const {
          executeYtDlpJson,
          getNetworkConfigFromUserConfig,
          getUserYtDlpConfig,
        } = await import("../utils/ytDlpUtils");
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
        } catch (error) {
          logger.error("Error fetching Bilibili videos with yt-dlp:", error);
          throw error;
        }
      } else {
        // For YouTube, use yt-dlp to get all videos
        const {
          executeYtDlpJson,
          getNetworkConfigFromUserConfig,
          getUserYtDlpConfig,
        } = await import("../utils/ytDlpUtils");
        const { getProviderScript } = await import(
          "./downloaders/ytdlp/ytdlpHelpers"
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
      }
    } catch (error) {
      logger.error("Error getting all video URLs:", error);
      throw error;
    }

    logger.info(`Found ${videoUrls.length} videos for ${authorUrl}`);
    return videoUrls;
  }

  /**
   * Process a continuous download task
   */
  private async processTask(taskId: string): Promise<void> {
    // Prevent concurrent processing of the same task
    if (this.processingTasks.has(taskId)) {
      logger.debug(`Task ${taskId} is already being processed`);
      return;
    }

    this.processingTasks.add(taskId);

    try {
      const task = await this.getTaskById(taskId);
      if (!task) {
        logger.error(`Task ${taskId} not found`);
        return;
      }

      if (task.status !== "active") {
        logger.debug(`Task ${taskId} is not active, skipping`);
        return;
      }

      // For large playlists, use incremental fetching to save memory
      // Check if it's a playlist (likely to be large)
      const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
      const isPlaylist = playlistRegex.test(task.authorUrl);
      const useIncremental = isPlaylist && task.platform === "YouTube";

      // Get total count if not set
      if (task.totalVideos === 0) {
        if (useIncremental) {
          // For playlists, get count without loading all URLs
          const count = await this.getVideoCount(task.authorUrl, task.platform);
          if (count > 0) {
            await db
              .update(continuousDownloadTasks)
              .set({
                totalVideos: count,
                updatedAt: Date.now(),
              })
              .where(eq(continuousDownloadTasks.id, taskId));
            task.totalVideos = count;
          } else {
            // Fallback: get count from first batch
            const firstBatch = await this.getVideoUrlsIncremental(
              task.authorUrl,
              task.platform,
              0,
              1
            );
            // We'll need to fetch more to get accurate count, but for now use estimate
            // Actually, let's just fetch a larger initial batch to get count
            const testBatch = await this.getVideoUrlsIncremental(
              task.authorUrl,
              task.platform,
              0,
              100
            );
            const estimatedTotal =
              testBatch.length >= 100 ? 1000 : testBatch.length; // Estimate
            await db
              .update(continuousDownloadTasks)
              .set({
                totalVideos: estimatedTotal,
                updatedAt: Date.now(),
              })
              .where(eq(continuousDownloadTasks.id, taskId));
            task.totalVideos = estimatedTotal;
          }
        } else {
          // For channels or small lists, use traditional method
          logger.info(`Fetching video list for task ${taskId}...`);
          const videoUrls = await this.getAllVideoUrls(
            task.authorUrl,
            task.platform
          );
          await db
            .update(continuousDownloadTasks)
            .set({
              totalVideos: videoUrls.length,
              updatedAt: Date.now(),
            })
            .where(eq(continuousDownloadTasks.id, taskId));
          task.totalVideos = videoUrls.length;
        }
      }

      const totalVideos = task.totalVideos || 0;
      const fetchBatchSize = 50; // Fetch 50 URLs at a time
      const processBatchSize = 10; // Process 10 videos at a time

      // Process videos incrementally
      for (
        let i = task.currentVideoIndex;
        i < totalVideos;
        i += processBatchSize
      ) {
        // Check if task was cancelled
        const currentTask = await this.getTaskById(taskId);
        if (!currentTask || currentTask.status !== "active") {
          logger.info(`Task ${taskId} was cancelled or paused`);
          break;
        }

        // Fetch batch of URLs if using incremental mode
        let videoUrls: string[] = [];
        if (useIncremental) {
          // Fetch only the batch we need
          const batchStart = i;
          const batchEnd = Math.min(i + fetchBatchSize, totalVideos);
          videoUrls = await this.getVideoUrlsIncremental(
            task.authorUrl,
            task.platform,
            batchStart,
            batchEnd - batchStart
          );
        } else {
          // For non-incremental, get all URLs (cached)
          const cacheKey = `${taskId}:${task.authorUrl}`;
          if (this.videoUrlCache.has(cacheKey)) {
            videoUrls = this.videoUrlCache.get(cacheKey)!;
          } else {
            videoUrls = await this.getAllVideoUrls(
              task.authorUrl,
              task.platform
            );
            this.videoUrlCache.set(cacheKey, videoUrls);
          }
        }

        // Process videos in this batch
        for (let j = 0; j < videoUrls.length && i + j < totalVideos; j++) {
          const videoIndex = i + j;
          const videoUrl = videoUrls[j];
          logger.info(
            `Processing video ${
              videoIndex + 1
            }/${totalVideos} for task ${taskId}: ${videoUrl}`
          );

          try {
            // Check if video already exists
            const existingVideo = storageService.getVideoBySourceUrl(videoUrl);
            if (existingVideo) {
              logger.debug(`Video ${videoUrl} already exists, skipping`);
              await db
                .update(continuousDownloadTasks)
                .set({
                  skippedCount: (currentTask.skippedCount || 0) + 1,
                  currentVideoIndex: videoIndex + 1,
                  updatedAt: Date.now(),
                })
                .where(eq(continuousDownloadTasks.id, taskId));
              continue;
            }

            // Download the video
            let downloadResult: any;
            if (task.platform === "Bilibili") {
              downloadResult = await downloadSingleBilibiliPart(
                videoUrl,
                1,
                1,
                ""
              );
            } else {
              downloadResult = await downloadYouTubeVideo(videoUrl);
            }

            // Add to download history
            const videoData = downloadResult?.videoData || downloadResult || {};
            storageService.addDownloadHistoryItem({
              id: uuidv4(),
              title: videoData.title || `Video from ${task.author}`,
              author: videoData.author || task.author,
              sourceUrl: videoUrl,
              finishedAt: Date.now(),
              status: "success",
              videoPath: videoData.videoPath,
              thumbnailPath: videoData.thumbnailPath,
              videoId: videoData.id,
            });

            // If task has a collectionId, add video to collection
            if (task.collectionId && videoData.id) {
              try {
                storageService.addVideoToCollection(
                  task.collectionId,
                  videoData.id
                );
                logger.info(
                  `Added video ${videoData.id} to collection ${task.collectionId}`
                );
              } catch (error) {
                logger.error(
                  `Error adding video to collection ${task.collectionId}:`,
                  error
                );
                // Don't fail the task if collection add fails
              }
            }

            // Update task progress
            await db
              .update(continuousDownloadTasks)
              .set({
                downloadedCount: (currentTask.downloadedCount || 0) + 1,
                currentVideoIndex: videoIndex + 1,
                updatedAt: Date.now(),
              })
              .where(eq(continuousDownloadTasks.id, taskId));
          } catch (downloadError: any) {
            logger.error(
              `Error downloading video ${videoUrl} for task ${taskId}:`,
              downloadError
            );

            // Add to download history as failed
            storageService.addDownloadHistoryItem({
              id: uuidv4(),
              title: `Video from ${task.author}`,
              author: task.author,
              sourceUrl: videoUrl,
              finishedAt: Date.now(),
              status: "failed",
              error: downloadError.message || "Download failed",
            });

            // Update task progress
            const currentTask = await this.getTaskById(taskId);
            if (currentTask) {
              await db
                .update(continuousDownloadTasks)
                .set({
                  failedCount: (currentTask.failedCount || 0) + 1,
                  currentVideoIndex: videoIndex + 1,
                  updatedAt: Date.now(),
                })
                .where(eq(continuousDownloadTasks.id, taskId));
            }
          }

          // Small delay to avoid overwhelming the system
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Clear videoUrls reference after processing batch to help GC
        videoUrls = [];
      }

      // Mark task as completed
      const finalTask = await this.getTaskById(taskId);
      if (finalTask && finalTask.status === "active") {
        await db
          .update(continuousDownloadTasks)
          .set({
            status: "completed",
            completedAt: Date.now(),
            updatedAt: Date.now(),
          })
          .where(eq(continuousDownloadTasks.id, taskId));

        // Clear cached video URLs to free memory
        const cacheKey = `${taskId}:${finalTask.authorUrl}`;
        this.videoUrlCache.delete(cacheKey);

        logger.info(
          `Completed continuous download task ${taskId}: ${finalTask.downloadedCount} downloaded, ${finalTask.skippedCount} skipped, ${finalTask.failedCount} failed`
        );
      }
    } catch (error) {
      logger.error(`Error processing task ${taskId}:`, error);
      await db
        .update(continuousDownloadTasks)
        .set({
          status: "cancelled",
          error: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        })
        .where(eq(continuousDownloadTasks.id, taskId));

      // Clear cached video URLs on error to free memory
      const task = await this.getTaskById(taskId);
      if (task) {
        const cacheKey = `${taskId}:${task.authorUrl}`;
        this.videoUrlCache.delete(cacheKey);
      }
    } finally {
      this.processingTasks.delete(taskId);
    }
  }
}

export const continuousDownloadService =
  ContinuousDownloadService.getInstance();
