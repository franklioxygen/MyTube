import { eq } from "drizzle-orm";
import cron, { ScheduledTask } from "node-cron";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { subscriptions } from "../db/schema";
import {
  DuplicateError,
  NotFoundError,
  ValidationError,
} from "../errors/DownloadErrors";
import {
    extractBilibiliMid,
    extractTwitchChannelLogin,
    isBilibiliSpaceUrl,
    isTwitchChannelUrl,
    isYouTubeUrl,
    normalizeTwitchChannelUrl,
    normalizeYouTubeAuthorUrl,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import {
    downloadSingleBilibiliPart,
    downloadYouTubeVideo,
} from "./downloadService";
import { BilibiliDownloader } from "./downloaders/BilibiliDownloader";
import {
  getTwitchChannelVideos,
  TwitchYtDlpVideoEntry,
} from "./downloaders/ytdlp/ytdlpTwitch";
import { YtDlpDownloader } from "./downloaders/YtDlpDownloader";
import { FilenameTemplateSourceOptions } from "./filenameTemplate/types";
import { recordEvent, bucketDownloadError, platformFromUrl } from "./statistics";
import * as storageService from "./storageService";
import { runSubscriptionRetentionCleanup } from "./subscriptionRetentionService";
import { TelegramService } from "./telegramService";
import { TwitchVideoInfo, twitchApiService } from "./twitchService";

const MAX_TWITCH_SUBSCRIPTION_PAGES_PER_CHECK = 5;
const MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS = 500;
const MAX_TWITCH_SUBSCRIPTION_DOWNLOADS_PER_CHECK = Math.max(
  Number.parseInt(
    process.env.TWITCH_SUBSCRIPTION_MAX_DOWNLOADS_PER_CHECK || "3",
    10
  ) || 3,
  1
);
const RETRYABLE_TWITCH_API_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ERR_NETWORK",
]);

function shouldFallbackToTwitchYtDlp(error: unknown): boolean {
  if (error instanceof ValidationError) {
    return (
      error.field === "twitchClientId" || error.field === "twitchClientSecret"
    );
  }

  if (error && typeof error === "object") {
    const errorWithResponse = error as {
      code?: unknown;
      message?: unknown;
      request?: unknown;
      response?: { status?: unknown };
    };

    if (typeof errorWithResponse.response?.status === "number") {
      return true;
    }

    if (
      typeof errorWithResponse.code === "string" &&
      RETRYABLE_TWITCH_API_ERROR_CODES.has(errorWithResponse.code)
    ) {
      return true;
    }

    if (errorWithResponse.request !== undefined) {
      return true;
    }
  }

  return (
    error instanceof Error &&
    error.message.includes("Twitch API is temporarily rate limited")
  );
}

function notifySubscriptionDownloadResult(context: {
  taskTitle: string;
  status: "success" | "fail";
  sourceUrl?: string;
  error?: string;
}): void {
  void TelegramService.notifyTaskComplete(context).catch((error) => {
    logger.error(
      "Subscription Telegram notification failed:",
      error instanceof Error ? error : new Error(String(error))
    );
  });
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const maybeError = error as { message?: unknown };
    if (typeof maybeError.message === "string") {
      return maybeError.message;
    }
  }

  return fallback;
}

function buildFilenameTemplateSourceOptions(
  sub: Subscription,
  mediaPlaylistIndex?: number
): FilenameTemplateSourceOptions {
  const isPlaylist =
    sub.subscriptionType === "playlist" || Boolean(sub.playlistId);

  return {
    sourceCustomName: sub.author,
    sourceCollectionName: sub.playlistTitle || sub.author,
    sourceCollectionId: sub.playlistId || sub.collectionId || "",
    sourceCollectionType: isPlaylist ? "playlist" : "channel",
    mediaPlaylistIndex,
  };
}

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

  // Shorts support
  downloadShorts?: number; // 0 or 1
  lastShortVideoLink?: string;

  // Twitch support
  twitchBroadcasterId?: string;
  twitchBroadcasterLogin?: string;
  lastTwitchVideoId?: string;

  // Retention
  retentionDays?: number | null;

  // Statistics-related durable state
  consecutiveFailureCount?: number;
  lastCheckStatus?: string | null;
  lastFailureReason?: string | null;
}

function getSubscriptionLogContext(
  sub: {
    id: string;
    author?: string | null;
    authorUrl?: string | null;
    platform?: string | null;
  },
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    subscriptionId: sub.id,
    author: sub.author,
    authorUrl: sub.authorUrl,
    platform: sub.platform,
    ...extras,
  };
}

export class SubscriptionService {
  private static instance: SubscriptionService;
  private checkTask: ScheduledTask | null = null;
  private retentionCleanupTask: ScheduledTask | null = null;
  private isCheckingSubscriptions = false;

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
    providedAuthorName?: string,
    downloadShorts: boolean = false
  ): Promise<Subscription> {
    // Detect platform and validate URL
    let platform: string;
    let authorName = providedAuthorName || "Unknown Author";
    let lastVideoLink = "";
    let twitchBroadcasterId: string | undefined;
    let twitchBroadcasterLogin: string | undefined;
    let lastTwitchVideoId: string | undefined;

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
    } else if (isYouTubeUrl(authorUrl)) {
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
    } else if (isTwitchChannelUrl(authorUrl)) {
      authorUrl = normalizeTwitchChannelUrl(authorUrl);
      platform = "Twitch";

      const channelLogin = extractTwitchChannelLogin(authorUrl);
      if (!channelLogin) {
        throw new ValidationError(`Invalid Twitch channel URL: ${authorUrl}`, "url");
      }

      if (twitchApiService.isConfigured()) {
        const channel = await twitchApiService.getChannelByLogin(channelLogin);
        if (!channel) {
          throw new ValidationError(
            `Twitch channel not found: ${channelLogin}`,
            "url"
          );
        }

        const { videos } = await twitchApiService.listVideosByBroadcaster(
          channel.id,
          {
            first: 20,
            type: "all",
          }
        );
        const newestEligibleVideo = videos.find((video) =>
          this.isEligibleTwitchVideo(video)
        );

        authorName = channel.displayName || providedAuthorName || channel.login;
        twitchBroadcasterId = channel.id;
        twitchBroadcasterLogin = channel.login;
        lastTwitchVideoId = newestEligibleVideo?.id;
        lastVideoLink = newestEligibleVideo?.url || "";
      } else {
        const fallbackResult = await getTwitchChannelVideos(authorUrl, {
          startIndex: 0,
          limit: 20,
        });
        const newestVideo = fallbackResult.videos[0];

        authorName =
          providedAuthorName ||
          fallbackResult.channelName ||
          fallbackResult.channelLogin ||
          channelLogin;
        twitchBroadcasterLogin = fallbackResult.channelLogin || channelLogin;
        lastTwitchVideoId = newestVideo?.id;
        lastVideoLink = newestVideo?.url || "";
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
    if (platform === "Twitch" && downloadShorts) {
      logger.info(
        "Ignoring downloadShorts for Twitch subscriptions because Twitch Shorts are not supported."
      );
    }

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
      downloadShorts: platform === "Twitch" ? 0 : downloadShorts ? 1 : 0,
      twitchBroadcasterId,
      twitchBroadcasterLogin,
      lastTwitchVideoId,
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
    logger.info("Created playlist subscription", getSubscriptionLogContext(newSubscription));
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
    logger.info(
      "Created channel playlists watcher",
      getSubscriptionLogContext(newSubscription)
    );
    return newSubscription;
  }

  /**
   * Check for new playlists on a channel and subscribe to them
   */
  async checkChannelPlaylists(sub: Subscription): Promise<number> {
    try {
      logger.info(
        "Checking channel playlists",
        getSubscriptionLogContext(sub)
      );

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
        logger.debug(
          "No playlists found for watcher",
          getSubscriptionLogContext(sub)
        );
        return 0;
      }

      // Extract channel name if needed (to update watcher name if generic?)
      // For now keep existing name.

      let newSubscriptionsCount = 0;
      const existingSubscriptions = await this.listSubscriptions();
      const subscribedUrls = new Set(
        existingSubscriptions.map((item) => item.authorUrl)
      );
      // Process each playlist
      for (const entry of result.entries) {
        if (!entry.url && !entry.id) continue;

        const playlistUrl =
          entry.url || `https://www.youtube.com/playlist?list=${entry.id}`;
        const title = (entry.title || "Untitled Playlist")
          .replace(/[\/\\:*?"<>|]/g, "-")
          .trim();

        if (subscribedUrls.has(playlistUrl)) {
          continue;
        }

        logger.info(`Watcher found new playlist: ${title} (${playlistUrl})`);

        let collectionId: string | null = null;

        // Determine channel name for collection naming and subscription
        // For channel_playlists subscriptions, author is already the clean channel name
        const channelName = sub.author;

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
          subscribedUrls.add(playlistUrl);
          newSubscriptionsCount++;
        } catch (error) {
          logger.error(`Error auto-subscribing to playlist ${title}:`, error);
        }
      }

      if (newSubscriptionsCount > 0) {
        logger.info(
          "Watcher added new playlists",
          getSubscriptionLogContext(sub, { newSubscriptionsCount })
        );
      }

      // Update last check time
      await db
        .update(subscriptions)
        .set({ lastCheck: Date.now() })
        .where(eq(subscriptions.id, sub.id));
      return newSubscriptionsCount;
    } catch (error) {
      logger.error(
        "Error in playlists watcher",
        error,
        getSubscriptionLogContext(sub)
      );
      return 0;
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
      "Unsubscribing from subscription",
      getSubscriptionLogContext(subscription)
    );

    // Delete the subscription
    await db.delete(subscriptions).where(eq(subscriptions.id, id));

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
      "Successfully unsubscribed from subscription",
      getSubscriptionLogContext(subscription)
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

    logger.info("Paused subscription", {
      subscriptionId: id,
      author: existing[0].author,
    });
  }

  async updateSubscriptionSettings(
    id: string,
    updates: { interval?: number; retentionDays?: number | null }
  ): Promise<void> {
    if (Object.keys(updates).length === 0) {
      throw new ValidationError(
        "At least one subscription setting is required",
        "body"
      );
    }

    const updated = await db
      .update(subscriptions)
      .set(updates)
      .where(eq(subscriptions.id, id))
      .returning({
        id: subscriptions.id,
        author: subscriptions.author,
      });

    if (updated.length === 0) {
      throw NotFoundError.subscription(id);
    }

    logger.info("Updated subscription settings", {
      subscriptionId: updated[0].id,
      author: updated[0].author,
      updates,
    });
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

    logger.info("Resumed subscription", {
      subscriptionId: id,
      author: existing[0].author,
    });
  }

  async listSubscriptions(): Promise<Subscription[]> {
    // @ts-ignore - Drizzle type inference might be tricky with raw select sometimes, but this should be fine.
    // Actually, db.select().from(subscriptions) returns the inferred type.
    return await db.select().from(subscriptions);
  }

  // Update durable subscription counters in-band with the statistics event so
  // streak state and event history cannot drift (design §6.5/§8.5).
  private async recordSubscriptionCheckCompleted(
    sub: Subscription,
    status: "success" | "fail",
    options: { newVideoCount?: number; failureReason?: string | null } = {}
  ): Promise<void> {
    try {
      if (status === "success") {
        await db
          .update(subscriptions)
          .set({
            consecutiveFailureCount: 0,
            lastCheckStatus: "success",
            lastFailureReason: null,
          })
          .where(eq(subscriptions.id, sub.id))
          .run();
      } else {
        const next = (sub.consecutiveFailureCount ?? 0) + 1;
        await db
          .update(subscriptions)
          .set({
            consecutiveFailureCount: next,
            lastCheckStatus: "fail",
            lastFailureReason: options.failureReason ?? "unknown",
          })
          .where(eq(subscriptions.id, sub.id))
          .run();
      }
    } catch (counterError) {
      logger.debug(
        "Failed to update subscription durable counters",
        counterError instanceof Error
          ? counterError
          : new Error(String(counterError))
      );
    }
    try {
      const subPlatform =
        typeof sub.platform === "string" ? sub.platform.toLowerCase() : null;
      recordEvent({
        eventType: "subscription_check_completed",
        actorRole: "system",
        surface: "background",
        sessionId: null,
        subscriptionId: sub.id,
        platform: subPlatform as any,
        payload: {
          status,
          subscriptionAuthor: sub.author,
          newVideoCount: options.newVideoCount ?? 0,
        },
      });
    } catch {
      // statistics is best-effort
    }
  }

  async checkSubscriptions(): Promise<void> {
    if (this.isCheckingSubscriptions) {
      logger.debug("Subscription check already running, skipping this tick");
      return;
    }

    this.isCheckingSubscriptions = true;
    try {
      const allSubs = await this.listSubscriptions();

      for (const sub of allSubs) {
        // Skip if paused
        if (sub.paused) {
          // We can log this at debug level to avoid spamming logs
          logger.debug(
            "Skipping paused subscription",
            getSubscriptionLogContext(sub)
          );
          continue;
        }

        const now = Date.now();
        const lastCheck = sub.lastCheck || 0;
        const intervalMs = sub.interval * 60 * 1000;

        if (now - lastCheck >= intervalMs) {
          let checkStatus: "success" | "fail" = "success";
          let checkFailureReason: string | null = null;
          let checkNewVideoCount = 0;
          try {
            logger.info(
              "Checking subscription",
              getSubscriptionLogContext(sub)
            );

          // 1. Fetch latest video link based on platform and subscription type
            if (sub.subscriptionType === "channel_playlists") {
              checkNewVideoCount = await this.checkChannelPlaylists(sub);
              continue; // Watcher handled, move to next subscription
            }

            if (sub.platform === "Twitch") {
              checkNewVideoCount = await this.checkTwitchSubscription(sub);
              continue;
            }

            const isPlaylistSubscription = sub.subscriptionType === "playlist";
            const latestVideoUrl = isPlaylistSubscription
              ? await this.getLatestPlaylistVideoUrl(
                  sub.authorUrl,
                  sub.platform
                )
              : await this.getLatestVideoUrl(sub.authorUrl, sub.platform);

            if (latestVideoUrl && latestVideoUrl !== sub.lastVideoLink) {
              logger.info(
                "New video found for subscription",
                getSubscriptionLogContext(sub, { latestVideoUrl })
              );

              // 2. Update lastCheck *before* download to prevent concurrent processing
              // If no rows were updated, the subscription was removed concurrently.
              const lockResult = await db
                .update(subscriptions)
                .set({
                  lastCheck: now,
                })
                .where(eq(subscriptions.id, sub.id))
                .returning({ id: subscriptions.id });

              if (lockResult.length === 0) {
                logger.warn(
                  "Subscription was deleted during processing, skipping download",
                  getSubscriptionLogContext(sub)
                );
                continue;
              }

              // 3. Download the video
              let downloadResult: any;
              let videoDownloaded = false;
              let downloadedVideoTitle = `New video from ${sub.author}`;
              try {
                if (sub.platform === "Bilibili") {
                  downloadResult = await downloadSingleBilibiliPart(
                    latestVideoUrl,
                    1,
                    1,
                    "",
                    undefined,
                    undefined,
                    undefined,
                    buildFilenameTemplateSourceOptions(sub)
                  );
                } else {
                  downloadResult = await downloadYouTubeVideo(
                    latestVideoUrl,
                    undefined,
                    undefined,
                    buildFilenameTemplateSourceOptions(sub)
                  );
                }

                // Add to download history on success
                const videoData =
                  downloadResult?.videoData || downloadResult || {};
                downloadedVideoTitle =
                  videoData.title || `New video from ${sub.author}`;
                videoDownloaded = true;
                checkNewVideoCount += 1;
                storageService.addDownloadHistoryItem({
                  id: uuidv4(),
                  title: downloadedVideoTitle,
                  author: videoData.author || sub.author,
                  sourceUrl: latestVideoUrl,
                  finishedAt: Date.now(),
                  status: "success",
                  videoPath: videoData.videoPath,
                  thumbnailPath: videoData.thumbnailPath,
                  videoId: videoData.id,
                  subscriptionId: sub.id,
                  platform:
                    typeof sub.platform === "string"
                      ? sub.platform.toLowerCase()
                      : undefined,
                  sourceKind: "subscription",
                  totalSize:
                    typeof videoData.fileSize === "string" ||
                    typeof videoData.fileSize === "number"
                      ? String(videoData.fileSize)
                      : undefined,
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
                const updateResult = await db
                  .update(subscriptions)
                  .set({
                    lastVideoLink: latestVideoUrl,
                    downloadCount: (sub.downloadCount || 0) + 1,
                  })
                  .where(eq(subscriptions.id, sub.id))
                  .returning({ id: subscriptions.id });

                if (updateResult.length === 0) {
                    logger.warn(
                      "Subscription was deleted after download completed",
                      getSubscriptionLogContext(sub, { latestVideoUrl })
                    );
                  continue;
                } else {
                  notifySubscriptionDownloadResult({
                    taskTitle: downloadedVideoTitle,
                    status: "success",
                    sourceUrl: latestVideoUrl,
                  });
                  logger.debug(
                    "Successfully processed subscription",
                    getSubscriptionLogContext(sub, { latestVideoUrl })
                  );
                }
              } catch (downloadError: any) {
                const errorMessage = getErrorMessage(
                  downloadError,
                  "Download failed"
                );

                if (videoDownloaded) {
                  logger.error(
                    "Error updating subscription after video download",
                    downloadError,
                    getSubscriptionLogContext(sub, { latestVideoUrl })
                  );

                  notifySubscriptionDownloadResult({
                    taskTitle: downloadedVideoTitle,
                    status: "fail",
                    sourceUrl: latestVideoUrl,
                    error: `Subscription processing failed after download: ${errorMessage}`,
                  });
                  continue;
                }

                logger.error(
                  "Error downloading subscription video",
                  downloadError,
                  getSubscriptionLogContext(sub, { latestVideoUrl })
                );
                notifySubscriptionDownloadResult({
                  taskTitle: `Video from ${sub.author}`,
                  status: "fail",
                  sourceUrl: latestVideoUrl,
                  error: errorMessage,
                });

                // Add to download history on failure
                storageService.addDownloadHistoryItem({
                  id: uuidv4(),
                  title: `Video from ${sub.author}`,
                  author: sub.author,
                  sourceUrl: latestVideoUrl,
                  finishedAt: Date.now(),
                  status: "failed",
                  error: errorMessage,
                  subscriptionId: sub.id,
                  platform:
                    typeof sub.platform === "string"
                      ? sub.platform.toLowerCase()
                      : undefined,
                  sourceKind: "subscription",
                });
                checkStatus = "fail";
                checkFailureReason = bucketDownloadError(errorMessage);

                // Note: We already updated lastCheck, so we won't retry until next interval.
                // This acts as a "backoff" preventing retry loops for broken downloads.
              }
            } else {
              // Just update lastCheck.
              const updateResult = await db
                .update(subscriptions)
                .set({ lastCheck: now })
                .where(eq(subscriptions.id, sub.id))
                .returning({ id: subscriptions.id });

              if (updateResult.length === 0) {
                logger.warn(
                  "Subscription was deleted before lastCheck update",
                  getSubscriptionLogContext(sub)
                );
                continue;
              }
            }

            // Check for Shorts if enabled
            if (sub.downloadShorts === 1 && sub.platform === "YouTube") {
              const shortCheckSubscription = await db
                .select({ id: subscriptions.id })
                .from(subscriptions)
                .where(eq(subscriptions.id, sub.id))
                .limit(1);

              if (shortCheckSubscription.length === 0) {
                logger.debug(
                  "Skipping shorts check for deleted subscription",
                  getSubscriptionLogContext(sub)
                );
                continue;
              }

              try {
                const latestShortUrl = await YtDlpDownloader.getLatestShortsUrl(
                  sub.authorUrl
                );

              if (latestShortUrl && latestShortUrl !== sub.lastShortVideoLink) {
                logger.info(
                  "New short found for subscription",
                  getSubscriptionLogContext(sub, { latestShortUrl })
                );

                // Download the short
                let shortDownloaded = false;
                let downloadedShortTitle = `New short from ${sub.author}`;
                try {
                  const downloadResult = await downloadYouTubeVideo(
                    latestShortUrl,
                    undefined,
                    undefined,
                    buildFilenameTemplateSourceOptions(sub)
                  );

                  // Add to download history on success
                  const videoData =
                    downloadResult?.videoData || downloadResult || {};
                  downloadedShortTitle =
                    videoData.title || `New short from ${sub.author}`;
                  shortDownloaded = true;
                  storageService.addDownloadHistoryItem({
                    id: uuidv4(),
                    title: downloadedShortTitle,
                    author: videoData.author || sub.author,
                    sourceUrl: latestShortUrl,
                    finishedAt: Date.now(),
                    status: "success",
                    videoPath: videoData.videoPath,
                    thumbnailPath: videoData.thumbnailPath,
                    videoId: videoData.id,
                    subscriptionId: sub.id,
                    platform:
                      typeof sub.platform === "string"
                        ? sub.platform.toLowerCase()
                        : undefined,
                    sourceKind: "subscription",
                    totalSize:
                      typeof videoData.fileSize === "string" ||
                      typeof videoData.fileSize === "number"
                        ? String(videoData.fileSize)
                        : undefined,
                  });
                  checkNewVideoCount += 1;

                  // Update subscription record with new short link
                  const shortUpdateResult = await db
                    .update(subscriptions)
                    .set({
                      lastShortVideoLink: latestShortUrl,
                      downloadCount: (sub.downloadCount || 0) + 1,
                    })
                    .where(eq(subscriptions.id, sub.id))
                    .returning({ id: subscriptions.id });

                  if (shortUpdateResult.length === 0) {
                    logger.warn(
                      "Subscription was deleted after short download completed",
                      getSubscriptionLogContext(sub, { latestShortUrl })
                    );
                    continue;
                  }

                  notifySubscriptionDownloadResult({
                    taskTitle: downloadedShortTitle,
                    status: "success",
                    sourceUrl: latestShortUrl,
                  });

                  logger.debug(
                    "Successfully processed subscription short",
                    getSubscriptionLogContext(sub, { latestShortUrl })
                  );
                } catch (downloadError: unknown) {
                  logger.error(
                    shortDownloaded
                      ? "Error updating subscription after short download"
                      : "Error downloading subscription short",
                    downloadError instanceof Error
                      ? downloadError
                      : new Error(String(downloadError)),
                    getSubscriptionLogContext(sub, { latestShortUrl })
                  );

                  const errorMessage = getErrorMessage(
                    downloadError,
                    "Download failed"
                  );
                  if (shortDownloaded) {
                    notifySubscriptionDownloadResult({
                      taskTitle: downloadedShortTitle,
                      status: "fail",
                      sourceUrl: latestShortUrl,
                      error: `Subscription processing failed after short download: ${errorMessage}`,
                    });
                    continue;
                  }

                  notifySubscriptionDownloadResult({
                    taskTitle: `Short from ${sub.author}`,
                    status: "fail",
                    sourceUrl: latestShortUrl,
                    error: errorMessage,
                  });

                  storageService.addDownloadHistoryItem({
                    id: uuidv4(),
                    title: `Short from ${sub.author}`,
                    author: sub.author,
                    sourceUrl: latestShortUrl,
                    finishedAt: Date.now(),
                    status: "failed",
                    error: errorMessage,
                    subscriptionId: sub.id,
                    platform:
                      typeof sub.platform === "string"
                        ? sub.platform.toLowerCase()
                        : undefined,
                    sourceKind: "subscription",
                  });
                  checkStatus = "fail";
                  checkFailureReason = bucketDownloadError(errorMessage);
                }
              }
              } catch (shortsError) {
                logger.error(
                  "Error checking subscription shorts",
                  shortsError,
                  getSubscriptionLogContext(sub)
                );
              }
            }
          } catch (error) {
            logger.error(
              "Error checking subscription",
              error,
              getSubscriptionLogContext(sub)
            );
            checkStatus = "fail";
            checkFailureReason = bucketDownloadError(
              error instanceof Error ? error.message : String(error)
            );
          } finally {
            try {
              await this.recordSubscriptionCheckCompleted(sub, checkStatus, {
                newVideoCount: checkNewVideoCount,
                failureReason: checkFailureReason,
              });
            } catch {
              // statistics is best-effort
            }
          }
        }
      }
    } finally {
      this.isCheckingSubscriptions = false;
    }
  }

  private isEligibleTwitchVideo(video: TwitchVideoInfo): boolean {
    return video.type === "archive" || video.type === "upload";
  }

  private async checkTwitchSubscription(sub: Subscription): Promise<number> {
    const now = Date.now();
    const lockResult = await db
      .update(subscriptions)
      .set({ lastCheck: now })
      .where(eq(subscriptions.id, sub.id))
      .returning({ id: subscriptions.id });

    if (lockResult.length === 0) {
      logger.warn(
        "Twitch subscription was deleted before polling",
        getSubscriptionLogContext(sub)
      );
      return 0;
    }

    if (!twitchApiService.isConfigured()) {
      return await this.checkTwitchSubscriptionWithYtDlp(sub);
    }

    try {
      return await this.checkTwitchSubscriptionWithApi(sub);
    } catch (error) {
      if (!shouldFallbackToTwitchYtDlp(error)) {
        throw error;
      }

      logger.warn(
        "Falling back to yt-dlp for Twitch subscription after Helix polling failed",
        error instanceof Error ? error : new Error(String(error)),
        getSubscriptionLogContext(sub)
      );
      return await this.checkTwitchSubscriptionWithYtDlp(sub);
    }
  }

  private async checkTwitchSubscriptionWithApi(
    sub: Subscription
  ): Promise<number> {
    twitchApiService.ensureConfigured();

    let channel = sub.twitchBroadcasterId
      ? await twitchApiService.getChannelById(sub.twitchBroadcasterId)
      : null;

    if (!channel) {
      const channelLogin =
        sub.twitchBroadcasterLogin || extractTwitchChannelLogin(sub.authorUrl);
      if (!channelLogin) {
        throw new ValidationError(
          `Invalid Twitch channel URL: ${sub.authorUrl}`,
          "authorUrl"
        );
      }
      channel = await twitchApiService.getChannelByLogin(channelLogin);
    }

    if (!channel) {
      logger.warn(
        `Twitch channel for subscription ${sub.id} could not be resolved`
      );
      return 0;
    }

    await db
      .update(subscriptions)
      .set({
        author: channel.displayName,
        authorUrl: channel.url,
        twitchBroadcasterId: channel.id,
        twitchBroadcasterLogin: channel.login,
      })
      .where(eq(subscriptions.id, sub.id));

    const unseenVideos: TwitchVideoInfo[] = [];
    let cursor: string | undefined;
    let pagesFetched = 0;
    let scannedVideos = 0;
    let foundMarker = false;

    while (
      pagesFetched < MAX_TWITCH_SUBSCRIPTION_PAGES_PER_CHECK &&
      scannedVideos < MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS
    ) {
      const response = await twitchApiService.listVideosByBroadcaster(
        channel.id,
        {
          after: cursor,
          first: 100,
          type: "all",
        }
      );
      pagesFetched += 1;

      if (response.videos.length === 0) {
        break;
      }

      for (const video of response.videos) {
        scannedVideos += 1;

        if (!this.isEligibleTwitchVideo(video)) {
          if (scannedVideos >= MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS) {
            break;
          }
          continue;
        }

        if (sub.lastTwitchVideoId && video.id === sub.lastTwitchVideoId) {
          foundMarker = true;
          break;
        }

        unseenVideos.push(video);
        if (scannedVideos >= MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS) {
          break;
        }
      }

      if (
        foundMarker ||
        !response.cursor ||
        scannedVideos >= MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS
      ) {
        break;
      }

      cursor = response.cursor;
    }

    if (unseenVideos.length === 0) {
      return 0;
    }

    return await this.processTwitchSubscriptionVideos(
      sub,
      unseenVideos
        .reverse()
        .slice(0, MAX_TWITCH_SUBSCRIPTION_DOWNLOADS_PER_CHECK)
        .map((video) => ({
        id: video.id,
        url: video.url,
        title: video.title,
        authorName: video.userName || channel.displayName,
      }))
    );
  }

  private async checkTwitchSubscriptionWithYtDlp(
    sub: Subscription
  ): Promise<number> {
    const fallbackLogin =
      sub.twitchBroadcasterLogin || extractTwitchChannelLogin(sub.authorUrl);
    if (!fallbackLogin) {
      throw new ValidationError(
        `Invalid Twitch channel URL: ${sub.authorUrl}`,
        "authorUrl"
      );
    }

    const normalizedUrl = normalizeTwitchChannelUrl(sub.authorUrl);
    const unseenVideos: TwitchYtDlpVideoEntry[] = [];
    let pagesFetched = 0;
    let scannedVideos = 0;
    let foundMarker = false;
    let resolvedAuthor = sub.author;
    let resolvedLogin = sub.twitchBroadcasterLogin || fallbackLogin;

    while (
      pagesFetched < MAX_TWITCH_SUBSCRIPTION_PAGES_PER_CHECK &&
      scannedVideos < MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS
    ) {
      const response = await getTwitchChannelVideos(normalizedUrl, {
        startIndex: pagesFetched * 100,
        limit: 100,
      });
      pagesFetched += 1;

      if (response.channelName) {
        resolvedAuthor = response.channelName;
      }
      if (response.channelLogin) {
        resolvedLogin = response.channelLogin;
      }

      if (pagesFetched === 1) {
        await db
          .update(subscriptions)
          .set({
            author: resolvedAuthor,
            authorUrl: normalizedUrl,
            twitchBroadcasterLogin: resolvedLogin,
          })
          .where(eq(subscriptions.id, sub.id));
      }

      if (response.videos.length === 0) {
        break;
      }

      for (const video of response.videos) {
        scannedVideos += 1;

        if (sub.lastTwitchVideoId && video.id === sub.lastTwitchVideoId) {
          foundMarker = true;
          break;
        }

        unseenVideos.push(video);
        if (scannedVideos >= MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS) {
          break;
        }
      }

      if (
        foundMarker ||
        response.videos.length < 100 ||
        scannedVideos >= MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS
      ) {
        break;
      }
    }

    if (unseenVideos.length === 0) {
      return 0;
    }

    return await this.processTwitchSubscriptionVideos(
      sub,
      unseenVideos
        .reverse()
        .slice(0, MAX_TWITCH_SUBSCRIPTION_DOWNLOADS_PER_CHECK)
        .map((video) => ({
        id: video.id,
        url: video.url,
        title: video.title,
        authorName: video.author || resolvedAuthor,
      }))
    );
  }

  private async processTwitchSubscriptionVideos(
    sub: Subscription,
    videosToProcess: Array<{
      id: string;
      url: string;
      title: string;
      authorName?: string | null;
    }>
  ): Promise<number> {
    let currentLastVideoLink = sub.lastVideoLink || "";
    let currentLastTwitchVideoId = sub.lastTwitchVideoId;
    let currentDownloadCount = sub.downloadCount || 0;
    let newVideoCount = 0;

    for (const video of videosToProcess) {
      const existingDownload = storageService.checkVideoDownloadBySourceId(
        video.id,
        "twitch"
      );

      if (existingDownload.found) {
        currentLastTwitchVideoId = video.id;
        currentLastVideoLink = video.url;

        await db
          .update(subscriptions)
          .set({
            lastTwitchVideoId: currentLastTwitchVideoId,
            lastVideoLink: currentLastVideoLink,
          })
          .where(eq(subscriptions.id, sub.id));
        continue;
      }

      let twitchVideoDownloaded = false;
      let downloadedTwitchTitle = video.title || `Video from ${sub.author}`;
      try {
        const downloadResult = await downloadYouTubeVideo(
          video.url,
          undefined,
          undefined,
          buildFilenameTemplateSourceOptions(sub)
        );
        const videoData = downloadResult?.videoData || downloadResult || {};
        downloadedTwitchTitle = videoData.title || video.title;
        twitchVideoDownloaded = true;

        storageService.addDownloadHistoryItem({
          id: uuidv4(),
          title: downloadedTwitchTitle,
          author: videoData.author || video.authorName || sub.author,
          sourceUrl: video.url,
          finishedAt: Date.now(),
          status: "success",
          videoPath: videoData.videoPath,
          thumbnailPath: videoData.thumbnailPath,
          videoId: videoData.id,
          subscriptionId: sub.id,
          platform: platformFromUrl(video.url),
          sourceKind: "subscription",
          totalSize:
            typeof videoData.fileSize === "string" ||
            typeof videoData.fileSize === "number"
              ? String(videoData.fileSize)
              : undefined,
        });
        newVideoCount += 1;

        currentLastTwitchVideoId = video.id;
        currentLastVideoLink = video.url;
        currentDownloadCount += 1;

        const updateResult = await db
          .update(subscriptions)
          .set({
            lastTwitchVideoId: currentLastTwitchVideoId,
            lastVideoLink: currentLastVideoLink,
            downloadCount: currentDownloadCount,
          })
          .where(eq(subscriptions.id, sub.id))
          .returning({ id: subscriptions.id });

        if (updateResult.length === 0) {
          logger.warn(
            "Twitch subscription was deleted after download completed",
            getSubscriptionLogContext(sub, { latestVideoUrl: video.url })
          );
          break;
        }

        notifySubscriptionDownloadResult({
          taskTitle: downloadedTwitchTitle,
          status: "success",
          sourceUrl: video.url,
        });
      } catch (downloadError: any) {
        const errorMessage = getErrorMessage(
          downloadError,
          "Download failed"
        );

        if (twitchVideoDownloaded) {
          logger.error(
            "Error updating Twitch subscription after video download",
            downloadError,
            getSubscriptionLogContext(sub, { latestVideoUrl: video.url })
          );

          notifySubscriptionDownloadResult({
            taskTitle: downloadedTwitchTitle,
            status: "fail",
            sourceUrl: video.url,
            error: `Subscription processing failed after download: ${errorMessage}`,
          });
          break;
        }

        logger.error(
          "Error downloading Twitch subscription video",
          downloadError,
          getSubscriptionLogContext(sub, { latestVideoUrl: video.url })
        );
        storageService.addDownloadHistoryItem({
          id: uuidv4(),
          title: video.title || `Video from ${sub.author}`,
          author: video.authorName || sub.author,
          sourceUrl: video.url,
          finishedAt: Date.now(),
          status: "failed",
          error: errorMessage,
          subscriptionId: sub.id,
          platform: platformFromUrl(video.url),
          sourceKind: "subscription",
        });
        notifySubscriptionDownloadResult({
          taskTitle: video.title || `Video from ${sub.author}`,
          status: "fail",
          sourceUrl: video.url,
          error: errorMessage,
        });
        break;
      }
    }

    return newVideoCount;
  }

  startScheduler() {
    if (this.checkTask) {
      this.checkTask.stop();
    }
    if (this.retentionCleanupTask) {
      this.retentionCleanupTask.stop();
    }

    // Run every minute
    this.checkTask = cron.schedule("* * * * *", () => {
      this.checkSubscriptions().catch((error) => {
        logger.error("Subscription scheduler tick failed:", error);
      });
    });
    logger.info("Subscription scheduler started (node-cron).");

    // Run subscription retention cleanup once per hour
    this.retentionCleanupTask = cron.schedule("0 * * * *", () => {
      runSubscriptionRetentionCleanup().catch((error) => {
        logger.error(
          "Subscription retention cleanup failed:",
          error instanceof Error ? error : new Error(String(error))
        );
      });
    });
    logger.info("Subscription retention scheduler started (node-cron).");
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
