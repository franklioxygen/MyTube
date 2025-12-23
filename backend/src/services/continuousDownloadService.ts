import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { continuousDownloadTasks } from "../db/schema";
import { logger } from "../utils/logger";
import {
  downloadSingleBilibiliPart,
  downloadYouTubeVideo,
} from "./downloadService";
import { BilibiliDownloader } from "./downloaders/BilibiliDownloader";
import { YtDlpDownloader } from "./downloaders/YtDlpDownloader";
import * as storageService from "./storageService";

export interface ContinuousDownloadTask {
  id: string;
  subscriptionId?: string;
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

    await db.insert(continuousDownloadTasks).values(task);
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
   * Get all tasks
   */
  async getAllTasks(): Promise<ContinuousDownloadTask[]> {
    const tasks = await db.select().from(continuousDownloadTasks);
    // Convert null to undefined for TypeScript compatibility and ensure status type
    return tasks.map((task) => ({
      ...task,
      subscriptionId: task.subscriptionId ?? undefined,
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
    const tasks = await db
      .select()
      .from(continuousDownloadTasks)
      .where(eq(continuousDownloadTasks.id, id))
      .limit(1);
    if (tasks.length === 0) return null;
    const task = tasks[0];
    // Convert null to undefined for TypeScript compatibility and ensure status type
    return {
      ...task,
      subscriptionId: task.subscriptionId ?? undefined,
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
   * Delete a task (remove from database)
   */
  async deleteTask(id: string): Promise<void> {
    const task = await this.getTaskById(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    await db
      .delete(continuousDownloadTasks)
      .where(eq(continuousDownloadTasks.id, id));

    logger.info(`Deleted continuous download task ${id}`);
  }

  /**
   * Get all video URLs from a channel/author
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
              logger.error(`Error fetching Bilibili videos page ${page}:`, error);
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
                      videoUrls.push(`https://www.bilibili.com/video/${video.bvid}`);
                    }
                  }

                  const total = data.data.page?.count || 0;
                  hasMoreApi = videoUrls.length < total && videos.length === pageSize;
                  pageNum++;
                } else {
                  hasMoreApi = false;
                }
              } catch (error) {
                logger.error(`Error fetching Bilibili videos page ${pageNum}:`, error);
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
        const userConfig = getUserYtDlpConfig(authorUrl);
        const networkConfig = getNetworkConfigFromUserConfig(userConfig);

        // Construct URL to get videos from the channel
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
            logger.error(`Error fetching YouTube videos page ${page}:`, error);
            hasMore = false;
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

      // Fetch video list if we haven't already
      let videoUrls: string[] = [];
      if (task.totalVideos === 0) {
        logger.info(`Fetching video list for task ${taskId}...`);
        videoUrls = await this.getAllVideoUrls(
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
      } else {
        // Fetch video URLs again (we could optimize this by storing URLs, but for now this works)
        videoUrls = await this.getAllVideoUrls(
          task.authorUrl,
          task.platform
        );
      }

      for (
        let i = task.currentVideoIndex;
        i < videoUrls.length;
        i++
      ) {
        // Check if task was cancelled
        const currentTask = await this.getTaskById(taskId);
        if (!currentTask || currentTask.status !== "active") {
          logger.info(`Task ${taskId} was cancelled or paused`);
          break;
        }

        const videoUrl = videoUrls[i];
        logger.info(
          `Processing video ${i + 1}/${videoUrls.length} for task ${taskId}: ${videoUrl}`
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
                currentVideoIndex: i + 1,
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
          const videoData =
            downloadResult?.videoData || downloadResult || {};
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

          // Update task progress
          await db
            .update(continuousDownloadTasks)
            .set({
              downloadedCount: (currentTask.downloadedCount || 0) + 1,
              currentVideoIndex: i + 1,
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
                currentVideoIndex: i + 1,
                updatedAt: Date.now(),
              })
              .where(eq(continuousDownloadTasks.id, taskId));
          }
        }

        // Small delay to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 1000));
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
    } finally {
      this.processingTasks.delete(taskId);
    }
  }
}

export const continuousDownloadService =
  ContinuousDownloadService.getInstance();

