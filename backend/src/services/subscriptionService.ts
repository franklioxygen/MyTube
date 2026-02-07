import { eq } from "drizzle-orm";
import cron, { ScheduledTask } from "node-cron";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { subscriptions } from "../db/schema";
import { DuplicateError, ValidationError } from "../errors/DownloadErrors";
import {
  extractBilibiliMid,
  isBilibiliSpaceUrl,
  normalizeYouTubeAuthorUrl,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import {
  downloadSingleBilibiliPart,
  downloadYouTubeVideo,
} from "./downloadService";
import { BilibiliDownloader } from "./downloaders/BilibiliDownloader";
import { YtDlpDownloader } from "./downloaders/YtDlpDownloader";
import * as storageService from "./storageService";

export interface Subscription {
  id: string;
  author: string;
  authorUrl: string;
  interval: number;
  lastVideoLink?: string;
  lastCheck?: number;
  downloadCount: number;
  createdAt: number;

  platform: string;
  paused?: number;

  // Playlist subscription fields
  playlistId?: string;
  playlistTitle?: string;
  subscriptionType?: string; // 'author' or 'playlist'
  collectionId?: string;
}

export class SubscriptionService {
  private static instance: SubscriptionService;
  private checkTask: ScheduledTask | null = null;

  private constructor() {}

  public static getInstance(): SubscriptionService {
    if (!SubscriptionService.instance) {
      SubscriptionService.instance = new SubscriptionService();
    }
    return SubscriptionService.instance;
  }

  async subscribe(
    authorUrl: string,
    interval: number,
    providedAuthorName?: string
  ): Promise<Subscription> {
    // Detect platform and validate URL
    let platform: string;
    let authorName = providedAuthorName || "Unknown Author";

    if (isBilibiliSpaceUrl(authorUrl)) {
      platform = "Bilibili";

      // If author name not provided, try to get it from Bilibili API
      if (!providedAuthorName) {
        // Extract mid from the space URL
        const mid = extractBilibiliMid(authorUrl);
        if (!mid) {
          throw ValidationError.invalidBilibiliSpaceUrl(authorUrl);
        }

        // Try to get author name from Bilibili API
        try {
          const authorInfo = await BilibiliDownloader.getAuthorInfo(mid);
          authorName = authorInfo.name;
        } catch (error) {
          logger.error("Error fetching Bilibili author info:", error);
          // Use mid as fallback author name
          authorName = `Bilibili User ${mid}`;
        }
      }
    } else if (authorUrl.includes("youtube.com")) {
      authorUrl = normalizeYouTubeAuthorUrl(authorUrl);
      platform = "YouTube";

      // If author name not provided, try to get it from channel URL using yt-dlp
      if (!providedAuthorName) {
        try {
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
          } else if (
            info.channel_id &&
            info.entries &&
            info.entries.length > 0
          ) {
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
          if (
            authorName === "Unknown Author" ||
            authorName === providedAuthorName
          ) {
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
      }
    } else {
      throw ValidationError.unsupportedPlatform(authorUrl);
    }

    // Check if already subscribed
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.authorUrl, authorUrl));
    if (existing.length > 0) {
      throw DuplicateError.subscription();
    }

    // We skip heavy getVideoInfo here to ensure fast response.
    // The scheduler will eventually fetch new videos and we can update author name then if needed.

    let lastVideoLink = "";

    const newSubscription: Subscription = {
      id: uuidv4(),
      author: authorName,
      authorUrl,
      interval,
      lastVideoLink,
      lastCheck: Date.now(),
      downloadCount: 0,
      createdAt: Date.now(),
      platform,
      paused: 0,
    };

    await db.insert(subscriptions).values(newSubscription);
    return newSubscription;
  }

  /**
   * Subscribe to a playlist to automatically download new videos
   */
  async subscribePlaylist(
    playlistUrl: string,
    interval: number,
    playlistTitle: string,
    playlistId: string,
    author: string,
    platform: string,
    collectionId: string | null
  ): Promise<Subscription> {
    // Check if already subscribed to this playlist
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.authorUrl, playlistUrl));
    if (existing.length > 0) {
      throw DuplicateError.subscription();
    }

    // Create display name as "playlistTitle - author"
    const displayName = `${playlistTitle} - ${author}`;

    const newSubscription: Subscription = {
      id: uuidv4(),
      author: displayName,
      authorUrl: playlistUrl,
      interval,
      lastVideoLink: "",
      lastCheck: Date.now(),
      downloadCount: 0,
      createdAt: Date.now(),
      platform,
      paused: 0,
      playlistId,
      playlistTitle,
      subscriptionType: "playlist",
      collectionId: collectionId || undefined,
    };

    await db.insert(subscriptions).values(newSubscription);
    logger.info(`Created playlist subscription: ${displayName} (${platform})`);
    return newSubscription;
  }

  /**
   * Create a watcher subscription that monitors a channel's playlists
   */
  async subscribeChannelPlaylistsWatcher(
    channelUrl: string,
    interval: number,
    channelName: string,
    platform: string
  ): Promise<Subscription> {
    // Check if watcher already exists
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.authorUrl, channelUrl));

    if (existing.length > 0) {
      // If it exists, just return it (idempotent)
      return existing[0] as unknown as Subscription;
    }

    const newSubscription: Subscription = {
      id: uuidv4(),
      author: channelName, // Store clean channel name, frontend will add translated suffix
      authorUrl: channelUrl,
      interval,
      lastVideoLink: "",
      lastCheck: Date.now(),
      downloadCount: 0,
      createdAt: Date.now(),
      platform,
      paused: 0,
      subscriptionType: "channel_playlists",
    };

    await db.insert(subscriptions).values(newSubscription);
    logger.info(`Created channel playlists watcher: ${newSubscription.author}`);
    return newSubscription;
  }

  /**
   * Check for new playlists on a channel and subscribe to them
   */
  async checkChannelPlaylists(sub: Subscription): Promise<void> {
    try {
      console.log(`Checking channel playlists for ${sub.author}...`);

      const {
        executeYtDlpJson,
        getNetworkConfigFromUserConfig,
        getUserYtDlpConfig,
      } = await import("../utils/ytDlpUtils");
      const { getProviderScript } = await import(
        "./downloaders/ytdlp/ytdlpHelpers"
      );

      const userConfig = getUserYtDlpConfig(sub.authorUrl);
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);
      const PROVIDER_SCRIPT = getProviderScript();

      // Use yt-dlp to get all playlists
      const result = await executeYtDlpJson(sub.authorUrl, {
        ...networkConfig,
        noWarnings: true,
        flatPlaylist: true,
        dumpSingleJson: true,
        playlistEnd: 100, // Limit to 100 playlists for safety
        ...(PROVIDER_SCRIPT
          ? {
              extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
            }
          : {}),
      });

      if (!result.entries || result.entries.length === 0) {
        logger.debug(`No playlists found for watcher ${sub.author}`);
        return;
      }

      // Extract channel name if needed (to update watcher name if generic?)
      // For now keep existing name.

      let newSubscriptionsCount = 0;

      // Process each playlist
      for (const entry of result.entries) {
        if (!entry.url && !entry.id) continue;

        const playlistUrl =
          entry.url || `https://www.youtube.com/playlist?list=${entry.id}`;
        const title = (entry.title || "Untitled Playlist")
          .replace(/[\/\\:*?"<>|]/g, "-")
          .trim();

        // Check if already subscribed to this playlist
        const existing = await this.listSubscriptions();
        const alreadySubscribed = existing.some(
          (s) => s.authorUrl === playlistUrl
        );

        if (alreadySubscribed) {
          continue;
        }

        logger.info(`Watcher found new playlist: ${title} (${playlistUrl})`);

        // Check settings to see if we should save to author collection instead of playlist collection
        const settings = storageService.getSettings();
        const saveAuthorFilesToCollection =
          settings.saveAuthorFilesToCollection || false;

        let collectionId: string | null = null;

        // Determine channel name for collection naming and subscription
        // For channel_playlists subscriptions, author is already the clean channel name
        const channelName = sub.author;

        if (!saveAuthorFilesToCollection) {
          // Get or create collection
          const cleanChannelName = channelName
            .replace(/[\/\\:*?"<>|]/g, "-")
            .trim();
          const collectionName = cleanChannelName
            ? `${title} - ${cleanChannelName}`
            : title;

          let collection = storageService.getCollectionByName(collectionName);
          if (!collection) {
            collection = storageService.getCollectionByName(title);
          }

          if (!collection) {
            const uniqueCollectionName =
              storageService.generateUniqueCollectionName(collectionName);
            collection = {
              id: Date.now().toString(),
              name: uniqueCollectionName,
              videos: [],
              createdAt: new Date().toISOString(),
              title: uniqueCollectionName,
            };
            storageService.saveCollection(collection);
          }
          collectionId = collection.id;
        }

        // Extract playlist ID
        let playlistId: string | null = null;
        if (entry.id) {
          playlistId = entry.id;
        } else {
          const match = playlistUrl.match(/[?&]list=([a-zA-Z0-9_-]+)/);
          if (match && match[1]) {
            playlistId = match[1];
          }
        }

        try {
          // Subscribe to the new playlist
          await this.subscribePlaylist(
            playlistUrl,
            sub.interval, // Use same interval as watcher
            title,
            playlistId || "",
            channelName,
            sub.platform,
            collectionId
          );
          newSubscriptionsCount++;
        } catch (error) {
          logger.error(`Error auto-subscribing to playlist ${title}:`, error);
        }
      }

      if (newSubscriptionsCount > 0) {
        logger.info(
          `Watcher ${sub.author} added ${newSubscriptionsCount} new playlists`
        );
      }

      // Update last check time
      await db
        .update(subscriptions)
        .set({ lastCheck: Date.now() })
        .where(eq(subscriptions.id, sub.id));
    } catch (error) {
      logger.error(`Error in playlists watcher for ${sub.author}:`, error);
    }
  }

  async unsubscribe(id: string): Promise<void> {
    // Verify subscription exists before deletion
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);

    if (existing.length === 0) {
      logger.warn(`Attempted to unsubscribe non-existent subscription: ${id}`);
      return; // Subscription doesn't exist, consider it already deleted
    }

    const subscription = existing[0];
    logger.info(
      `Unsubscribing from ${subscription.author} (${subscription.platform}) - ID: ${id}`
    );

    // Delete the subscription
    const result = await db
      .delete(subscriptions)
      .where(eq(subscriptions.id, id));

    // Verify deletion succeeded
    const verifyDeleted = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);

    if (verifyDeleted.length > 0) {
      logger.error(
        `Failed to delete subscription ${id} - still exists in database`
      );
      throw new Error(`Failed to delete subscription ${id}`);
    }

    logger.info(
      `Successfully unsubscribed from ${subscription.author} (${subscription.platform})`
    );
  }

  async pauseSubscription(id: string): Promise<void> {
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new Error(`Subscription ${id} not found`);
    }

    await db
      .update(subscriptions)
      .set({ paused: 1 })
      .where(eq(subscriptions.id, id));

    logger.info(`Paused subscription ${id} (${existing[0].author})`);
  }

  async resumeSubscription(id: string): Promise<void> {
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new Error(`Subscription ${id} not found`);
    }

    await db
      .update(subscriptions)
      .set({ paused: 0 })
      .where(eq(subscriptions.id, id));

    logger.info(`Resumed subscription ${id} (${existing[0].author})`);
  }

  async listSubscriptions(): Promise<Subscription[]> {
    // @ts-ignore - Drizzle type inference might be tricky with raw select sometimes, but this should be fine.
    // Actually, db.select().from(subscriptions) returns the inferred type.
    return await db.select().from(subscriptions);
  }

  async checkSubscriptions(): Promise<void> {
    // console.log('Checking subscriptions...'); // Too verbose
    const allSubs = await this.listSubscriptions();

    for (const sub of allSubs) {
      // Verify subscription still exists (in case it was deleted during processing)
      const stillExists = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, sub.id))
        .limit(1);

      if (stillExists.length === 0) {
        logger.debug(
          `Skipping deleted subscription: ${sub.id} (${sub.author})`
        );
        continue; // Subscription was deleted, skip it
      }

      // Skip if paused
      if (sub.paused) {
        // We can log this at debug level to avoid spamming logs
        logger.debug(`Skipping paused subscription: ${sub.id} (${sub.author})`);
        continue;
      }

      const now = Date.now();
      const lastCheck = sub.lastCheck || 0;
      const intervalMs = sub.interval * 60 * 1000;

      if (now - lastCheck >= intervalMs) {
        try {
          console.log(
            `Checking subscription for ${sub.author} (${sub.platform})...`
          );

          // 1. Fetch latest video link based on platform and subscription type
          if (sub.subscriptionType === "channel_playlists") {
            await this.checkChannelPlaylists(sub);
            continue; // Watcher handled, move to next subscription
          }

          const isPlaylistSubscription = sub.subscriptionType === "playlist";
          const latestVideoUrl = isPlaylistSubscription
            ? await this.getLatestPlaylistVideoUrl(sub.authorUrl, sub.platform)
            : await this.getLatestVideoUrl(sub.authorUrl, sub.platform);

          if (latestVideoUrl && latestVideoUrl !== sub.lastVideoLink) {
            console.log(`New video found for ${sub.author}: ${latestVideoUrl}`);

            // 2. Update lastCheck *before* download to prevent concurrent processing
            // Re-verify subscription exists before updating
            const subscriptionStillExists = await db
              .select()
              .from(subscriptions)
              .where(eq(subscriptions.id, sub.id))
              .limit(1);

            if (subscriptionStillExists.length === 0) {
              logger.warn(
                `Subscription ${sub.id} (${sub.author}) was deleted during processing, skipping update`
              );
              continue;
            }

            // Update lastCheck immediately to lock this subscription for this interval
            await db
              .update(subscriptions)
              .set({
                lastCheck: now,
              })
              .where(eq(subscriptions.id, sub.id));

            // 3. Download the video
            let downloadResult: any;
            try {
              if (sub.platform === "Bilibili") {
                downloadResult = await downloadSingleBilibiliPart(
                  latestVideoUrl,
                  1,
                  1,
                  ""
                );
              } else {
                downloadResult = await downloadYouTubeVideo(latestVideoUrl);
              }

              // Add to download history on success
              const videoData =
                downloadResult?.videoData || downloadResult || {};
              storageService.addDownloadHistoryItem({
                id: uuidv4(),
                title: videoData.title || `New video from ${sub.author}`,
                author: videoData.author || sub.author,
                sourceUrl: latestVideoUrl,
                finishedAt: Date.now(),
                status: "success",
                videoPath: videoData.videoPath,
                thumbnailPath: videoData.thumbnailPath,
                videoId: videoData.id,
                subscriptionId: sub.id,
              });

              // For playlist subscriptions, add video to the associated collection
              if (isPlaylistSubscription && sub.collectionId && videoData.id) {
                try {
                  storageService.addVideoToCollection(
                    sub.collectionId,
                    videoData.id
                  );
                  logger.info(
                    `Added video ${videoData.id} to collection ${sub.collectionId} from playlist subscription`
                  );
                } catch (collectionError) {
                  logger.error(
                    `Error adding video to collection ${sub.collectionId}:`,
                    collectionError
                  );
                  // Don't fail the subscription check if collection add fails
                }
              }

              // 4. Update subscription record with new video link and stats on success
              // Re-verify subscription exists before final update (race condition protection)
              const subscriptionStillExistsAfterDownload = await db
                .select()
                .from(subscriptions)
                .where(eq(subscriptions.id, sub.id))
                .limit(1);

              if (subscriptionStillExistsAfterDownload.length === 0) {
                logger.warn(
                  `Subscription ${sub.id} (${sub.author}) was deleted after download completed, skipping final update`
                );
                continue;
              }

              const updateResult = await db
                .update(subscriptions)
                .set({
                  lastVideoLink: latestVideoUrl,
                  downloadCount: (sub.downloadCount || 0) + 1,
                })
                .where(eq(subscriptions.id, sub.id))
                .returning();

              if (updateResult.length === 0) {
                logger.error(
                  `Failed to update subscription ${sub.id} (${sub.author}) after successful download - no rows affected`
                );
              } else {
                logger.debug(
                  `Successfully processed subscription ${sub.id} (${sub.author})`
                );
              }
            } catch (downloadError: any) {
              console.error(
                `Error downloading subscription video for ${sub.author}:`,
                downloadError
              );

              // Add to download history on failure
              storageService.addDownloadHistoryItem({
                id: uuidv4(),
                title: `Video from ${sub.author}`,
                author: sub.author,
                sourceUrl: latestVideoUrl,
                finishedAt: Date.now(),
                status: "failed",
                error: downloadError.message || "Download failed",
                subscriptionId: sub.id,
              });

              // Note: We already updated lastCheck, so we won't retry until next interval.
              // This acts as a "backoff" preventing retry loops for broken downloads.
            }
          } else {
            // Just update lastCheck
            // Re-verify subscription exists before updating (race condition protection)
            const subscriptionStillExists = await db
              .select()
              .from(subscriptions)
              .where(eq(subscriptions.id, sub.id))
              .limit(1);

            if (subscriptionStillExists.length === 0) {
              logger.debug(
                `Subscription ${sub.id} (${sub.author}) was deleted during check, skipping update`
              );
              continue;
            }

            const updateResult = await db
              .update(subscriptions)
              .set({ lastCheck: now })
              .where(eq(subscriptions.id, sub.id))
              .returning();

            if (updateResult.length === 0) {
              logger.warn(
                `Failed to update lastCheck for subscription ${sub.id} (${sub.author}) - no rows affected`
              );
            }
          }
        } catch (error) {
          console.error(
            `Error checking subscription for ${sub.author}:`,
            error
          );
        }
      }
    }
  }

  startScheduler() {
    if (this.checkTask) {
      this.checkTask.stop();
    }
    // Run every minute
    this.checkTask = cron.schedule("* * * * *", () => {
      this.checkSubscriptions();
    });
    console.log("Subscription scheduler started (node-cron).");
  }

  // Helper to get latest video URL based on platform
  private async getLatestVideoUrl(
    channelUrl: string,
    platform?: string
  ): Promise<string | null> {
    if (platform === "Bilibili" || isBilibiliSpaceUrl(channelUrl)) {
      return await BilibiliDownloader.getLatestVideoUrl(channelUrl);
    }

    // Default to YouTube/yt-dlp
    return await YtDlpDownloader.getLatestVideoUrl(channelUrl);
  }

  /**
   * Get the latest video URL from a playlist
   * For playlists, we check the first video (newest) in the playlist
   */
  private async getLatestPlaylistVideoUrl(
    playlistUrl: string,
    platform?: string
  ): Promise<string | null> {
    try {
      const {
        executeYtDlpJson,
        getNetworkConfigFromUserConfig,
        getUserYtDlpConfig,
      } = await import("../utils/ytDlpUtils");
      const userConfig = getUserYtDlpConfig(playlistUrl);
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);

      // Get the first video from the playlist
      const info = await executeYtDlpJson(playlistUrl, {
        ...networkConfig,
        noWarnings: true,
        flatPlaylist: true,
        playlistEnd: 1,
      });

      if (info.entries && info.entries.length > 0) {
        const firstVideo = info.entries[0];
        if (firstVideo.url) {
          return firstVideo.url;
        }
        if (firstVideo.id) {
          // Construct URL from ID
          if (platform === "YouTube") {
            return `https://www.youtube.com/watch?v=${firstVideo.id}`;
          }
          if (platform === "Bilibili") {
            return `https://www.bilibili.com/video/${firstVideo.id}`;
          }
        }
      }

      return null;
    } catch (error) {
      logger.error("Error getting latest playlist video:", error);
      return null;
    }
  }
}

export const subscriptionService = SubscriptionService.getInstance();
