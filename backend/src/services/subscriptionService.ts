import { eq } from "drizzle-orm";
import { ScheduledTask } from "node-cron";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { subscriptions } from "../db/schema";
import {
  DuplicateError,
  NotFoundError,
  ValidationError,
} from "../errors/DownloadErrors";
import {
    extractBilibiliVideoId,
    extractBilibiliMid,
    extractTwitchChannelLogin,
    isBilibiliSpaceUrl,
    isTwitchChannelUrl,
    isYouTubeUrl,
    normalizeTwitchChannelUrl,
    normalizeYouTubeAuthorUrl,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import { runWithConcurrencyLimit } from "../utils/concurrency";
import { isMembersOnlyError } from "../utils/ytdlp/errorClassification";
import { getEffectiveUserYtDlpConfig } from "../utils/ytDlpUtils";
import { resolveDownloadAudioMode } from "./downloaders/ytdlp/ytdlpConfig";
import downloadManager from "./downloadManager";
import {
    downloadSingleBilibiliPart,
    downloadYouTubeVideo,
} from "./downloadService";
import { BilibiliDownloader } from "./downloaders/BilibiliDownloader";
import { getTwitchChannelVideos } from "./downloaders/ytdlp/ytdlpTwitch";
import { YtDlpDownloader } from "./downloaders/YtDlpDownloader";
import { recordEvent, bucketDownloadError } from "./statistics";
import * as storageService from "./storageService";
import { twitchApiService } from "./twitchService";
import {
  buildFilenameTemplateSourceOptions,
  getErrorMessage,
  getSubscriptionLogContext,
  notifySubscriptionDownloadResult,
} from "./subscription/helpers";
import {
  listVideoRetries,
  markVideoRetryAttempted,
  queueVideoRetry,
  removeVideoRetry,
} from "./subscription/videoRetries";
import { Subscription } from "./subscription/types";
import {
  createSubscriptionSchedulerTasks,
  stopSubscriptionSchedulerTasks,
} from "./subscription/scheduler";
import { checkChannelPlaylistsForWatcher } from "./subscription/channelPlaylists";
import {
  getBilibiliCollectionHeadSnapshot,
  getPlaylistHeadSnapshot,
} from "./subscription/playlistFeed";
import { saveBilibiliCollectionSourceIfCompatible } from "./subscription/playlistResolution";
import { resolveYouTubeAuthorName } from "./subscription/youtubeAuthor";
import {
  checkTwitchSubscription as checkTwitchSubscriptionImpl,
  isEligibleTwitchVideo,
  processTwitchSubscriptionVideos as processTwitchSubscriptionVideosImpl,
} from "./subscription/twitchSubscription";

export type { Subscription } from "./subscription/types";

/** Bucketed reason for a check whose only failure was collection membership. */
const COLLECTION_LINK_FAILURE_REASON = "Collection update failed";

/**
 * Options for creating a playlist subscription (design §7.2 / §18).
 *
 * `initialHeadVideoUrl` + `baselineObservedAt` form the required server-side
 * baseline; `filenameTemplate` stores an optional per-subscription naming
 * override for downloads created from the subscription.
 */
export interface SubscribePlaylistOptions {
  playlistUrl: string;
  interval: number;
  playlistTitle: string;
  playlistId: string;
  author: string;
  platform: string;
  collectionId: string | null;
  initialHeadVideoUrl: string | null;
  baselineObservedAt: number;
  ytdlpConfig?: string | null;
  filenameTemplate?: string | null;
}

export class SubscriptionService {
  private static instance: SubscriptionService;
  // How many due subscriptions may be checked at once. Bounded so a sweep
  // cannot fan out into an unbounded burst of yt-dlp probes/downloads, while
  // still keeping one stalled subscription from serializing all the rest.
  private static readonly CHECK_CONCURRENCY = 3;
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
    downloadShorts: boolean = false,
    ytdlpConfig?: string | null,
    filenameTemplate?: string | null
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

        // Try to get author name from Bilibili API. The subscription's own
        // proxy is not persisted yet, so pass the requested config directly —
        // otherwise this lookup goes out over the global settings alone.
        try {
          const authorInfo = await BilibiliDownloader.getAuthorInfo(
            mid,
            ytdlpConfig
          );
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
        authorName = await resolveYouTubeAuthorName(authorUrl, providedAuthorName);
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
          isEligibleTwitchVideo(video)
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
          // Apply the (about-to-be-saved) override to the initial probe too, so
          // subscribing works when the override carries the proxy/cookies needed
          // to list the channel (issue #345).
          subscriptionYtdlpConfig: ytdlpConfig ?? null,
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
      ytdlpConfig: ytdlpConfig ?? null,
      filenameTemplate: filenameTemplate ?? null,
    };

    await db.insert(subscriptions).values(newSubscription);
    return newSubscription;
  }

  /**
   * Subscribe to a playlist to automatically download new videos.
   *
   * Requires an explicit baseline (design §7.2): the server-observed current
   * playlist head (or null for a verified empty playlist) plus the observation
   * timestamp. The baseline is captured by the caller via playlistFeed before
   * any persistent side effect, so the scheduler's first poll has a real
   * comparison cursor and an item that already existed at subscription time is
   * not treated as new. Requiring the value at the type boundary prevents
   * future callers from accidentally reintroducing `lastVideoLink: ""` for a
   * non-empty playlist.
   */
  async subscribePlaylist(
    options: SubscribePlaylistOptions
  ): Promise<Subscription> {
    const {
      playlistUrl,
      interval,
      playlistTitle,
      playlistId,
      author,
      platform,
      collectionId,
      initialHeadVideoUrl,
      baselineObservedAt,
      ytdlpConfig,
      filenameTemplate,
    } = options;

    // Check if already subscribed to this playlist. Kept in the service as the
    // final race-safe guard even when the controller performs an early duplicate
    // check for user experience (design §7.2).
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
      // Store the captured head (or "" for a verified empty playlist) as the
      // scheduler cursor. lastCheck is the observation timestamp, not an
      // unrelated earlier time (design §4.3 / §7.2).
      lastVideoLink: initialHeadVideoUrl ?? "",
      lastCheck: baselineObservedAt,
      downloadCount: 0,
      createdAt: Date.now(),
      platform,
      paused: 0,
      playlistId,
      playlistTitle,
      channelName: author,
      subscriptionType: "playlist",
      collectionId: collectionId || undefined,
      ytdlpConfig: ytdlpConfig ?? null,
      filenameTemplate: filenameTemplate ?? null,
    };

    await db.insert(subscriptions).values(newSubscription);
    logger.info(
      "Created playlist subscription",
      getSubscriptionLogContext(newSubscription, {
        baselineState: initialHeadVideoUrl ? "item" : "empty",
        baselineObservedAt,
      })
    );
    return newSubscription;
  }

  /**
   * Create a watcher subscription that monitors a channel's playlists
   */
  async subscribeChannelPlaylistsWatcher(
    channelUrl: string,
    interval: number,
    channelName: string,
    platform: string,
    filenameTemplate?: string | null
  ): Promise<Subscription> {
    // Check if watcher already exists
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.authorUrl, channelUrl));

    if (existing.length > 0) {
      const existingSubscription = existing[0] as unknown as Subscription;
      if (
        filenameTemplate !== undefined &&
        (existingSubscription.filenameTemplate ?? null) !== filenameTemplate
      ) {
        await db
          .update(subscriptions)
          .set({ filenameTemplate })
          .where(eq(subscriptions.id, existingSubscription.id));

        return {
          ...existingSubscription,
          filenameTemplate,
        };
      }

      // If it exists, just return it (idempotent)
      return existingSubscription;
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
      filenameTemplate: filenameTemplate ?? null,
    };

    await db.insert(subscriptions).values(newSubscription);
    logger.info(
      "Created channel playlists watcher",
      getSubscriptionLogContext(newSubscription)
    );
    return newSubscription;
  }

  /**
   * Check for new playlists on a channel and subscribe to them.
   *
   * Retained as an instance method because tests spy on it directly; it now
   * delegates to the extracted module function, passing the service's own
   * subscribe/list methods as dependencies.
   */
  async checkChannelPlaylists(sub: Subscription): Promise<number> {
    return checkChannelPlaylistsForWatcher(sub, {
      listSubscriptions: () => this.listSubscriptions(),
      subscribePlaylist: (options) => this.subscribePlaylist(options),
    });
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

    // Delete the subscription. better-sqlite3's run() reports the affected row
    // count in `.changes`, so we can confirm the deletion took effect without a
    // follow-up SELECT.
    const result = await db
      .delete(subscriptions)
      .where(eq(subscriptions.id, id))
      .run();

    if (result.changes === 0) {
      logger.error(
        `Failed to delete subscription ${id} - no rows affected`
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
    updates: {
      interval?: number;
      retentionDays?: number | null;
      ytdlpConfig?: string | null;
      filenameTemplate?: string | null;
    }
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

  async updatePlaylistSubscriptionCollection(
    id: string,
    collectionId: string
  ): Promise<void> {
    const updated = await db
      .update(subscriptions)
      .set({ collectionId })
      .where(eq(subscriptions.id, id))
      .returning({
        id: subscriptions.id,
        author: subscriptions.author,
      });

    if (updated.length === 0) {
      throw NotFoundError.subscription(id);
    }

    logger.info("Linked playlist subscription to collection", {
      subscriptionId: updated[0].id,
      author: updated[0].author,
      collectionId,
    });
  }

  async updatePlaylistSubscriptionCursor(
    id: string,
    lastVideoLink: string,
    lastCheck: number
  ): Promise<void> {
    const updated = await db
      .update(subscriptions)
      .set({ lastVideoLink, lastCheck })
      .where(eq(subscriptions.id, id))
      .returning({
        id: subscriptions.id,
        author: subscriptions.author,
      });

    if (updated.length === 0) {
      throw NotFoundError.subscription(id);
    }

    logger.info("Updated playlist subscription cursor", {
      subscriptionId: updated[0].id,
      author: updated[0].author,
      lastVideoLink,
      lastCheck,
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

  async getSubscriptionById(id: string): Promise<Subscription | null> {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);
    // @ts-ignore - Drizzle infers `string | null` for nullable columns while the
    // Subscription interface uses `string | undefined`; same shim as listSubscriptions.
    return rows[0] ?? null;
  }

  // Update durable subscription counters in-band with the statistics event so
  // streak state and event history cannot drift (design §6.5/§8.5).
  private async recordSubscriptionCheckCompleted(
    sub: Subscription,
    status: "success" | "fail",
    options: {
      newVideoCount?: number;
      /** Media actually downloaded, which `newVideoCount` is not for a watcher. */
      downloadedCount?: number;
      failureReason?: string | null;
    } = {}
  ): Promise<void> {
    // Carried on this last write as well as on each per-target one. Both
    // compute the same total from the same pre-check base, so restating it here
    // is a no-op after a clean check - but when a per-target update threw after
    // its download had already succeeded, that increment would otherwise be
    // lost for good: the next check finds the media present and settles the
    // retry through the existing-video path, which has no increment to make up.
    const settledDownloadCount =
      options.downloadedCount && options.downloadedCount > 0
        ? { downloadCount: (sub.downloadCount || 0) + options.downloadedCount }
        : {};

    try {
      if (status === "success") {
        await db
          .update(subscriptions)
          .set({
            ...settledDownloadCount,
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
            ...settledDownloadCount,
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

      // Due-ness is evaluated once per sweep; checks then run with bounded
      // concurrency so one stalled probe or long inline download no longer
      // delays every later subscription by its full duration.
      const now = Date.now();
      const dueSubs = allSubs.filter((sub) => {
        if (sub.paused) {
          // We can log this at debug level to avoid spamming logs
          logger.debug(
            "Skipping paused subscription",
            getSubscriptionLogContext(sub)
          );
          return false;
        }
        const lastCheck = sub.lastCheck || 0;
        const intervalMs = sub.interval * 60 * 1000;
        return now - lastCheck >= intervalMs;
      });

      await runWithConcurrencyLimit(
        dueSubs,
        SubscriptionService.CHECK_CONCURRENCY,
        (sub) => this.checkSingleSubscription(sub)
      );
    } finally {
      this.isCheckingSubscriptions = false;
    }
  }

  /**
   * Check one due subscription end-to-end: dispatch to the platform/type
   * handler or probe for the latest video, download inline, and record
   * history plus the statistics outcome. Extracted from the former
   * checkSubscriptions loop body (`continue` became `return`); never throws —
   * failures land in the finally-recorded check outcome.
   */
  private async checkSingleSubscription(sub: Subscription): Promise<void> {
    const now = Date.now();
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
        return; // Watcher handled, move to next subscription
      }

      // Twitch tracks its own feed by broadcast id, so it takes none of the
      // head/cursor handling below - but a Twitch backfill queues targeted
      // retries like any other, and returning here would leave every one of
      // them unconsumed. Its feed read happens with the other probes instead,
      // so a failure there is recorded without skipping the retry batch.
      const isTwitchSubscription = sub.platform === "Twitch";

      const isPlaylistSubscription = sub.subscriptionType === "playlist";

      // Playlist polls use the typed, fail-closed head snapshot (design §9.1).
      // The old nullable/error-swallowing probe could not distinguish a valid
      // empty playlist from an extraction/network failure, which let a failed
      // probe look like an empty playlist and update lastCheck as if it
      // succeeded. Now a probe throw marks the check failed and leaves the
      // cursor unchanged; a verified-empty result updates only lastCheck
      // (design §9.2) and never clears a previously non-empty cursor.
      // Shared by both probe shapes: mark the check failed, leave the cursor
      // alone, and advance lastCheck so a persistent failure backs off to the
      // configured interval instead of retrying every tick.
      const recordProbeFailure = async (
        probeError: unknown,
        message: string
      ): Promise<void> => {
        logger.error(
          message,
          probeError instanceof Error
            ? probeError
            : new Error(String(probeError)),
          getSubscriptionLogContext(sub)
        );
        checkStatus = "fail";
        checkFailureReason = bucketDownloadError(
          probeError instanceof Error ? probeError.message : String(probeError)
        );
        const updateResult = await db
          .update(subscriptions)
          .set({ lastCheck: now })
          .where(eq(subscriptions.id, sub.id))
          .returning({ id: subscriptions.id });

        if (updateResult.length === 0) {
          logger.warn(
            "Subscription was deleted before failed probe backoff update",
            getSubscriptionLogContext(sub)
          );
        }
      };

      let latestVideoUrl: string | null = null;
      if (isTwitchSubscription) {
        // Twitch has no URL head to compare; its own handler tracks the feed.
        try {
          checkNewVideoCount = await this.checkTwitchSubscription(sub);
        } catch (probeError) {
          await recordProbeFailure(
            probeError,
            "Twitch check failed during subscription check"
          );
        }
      } else if (isPlaylistSubscription) {
        try {
          const snapshot = await this.getPlaylistSubscriptionHeadSnapshot(sub);
          latestVideoUrl = snapshot.headVideoUrl;
        } catch (probeError) {
          await recordProbeFailure(
            probeError,
            "Playlist probe failed during subscription check"
          );
        }
      } else {
        // The channel/space probe is fail-closed for the same reason: a failure
        // that returned null was indistinguishable from "no new video".
        try {
          latestVideoUrl = await this.getLatestVideoUrl(
            sub.authorUrl,
            sub.platform,
            sub.ytdlpConfig
          );
        } catch (probeError) {
          await recordProbeFailure(
            probeError,
            "Channel probe failed during subscription check"
          );
        }
      }

      const retries = listVideoRetries(sub.id);
      const retryUrls = retries.map((retry) => retry.videoUrl);
      // The backfill position the target was queued with, so a recovered item
      // is named like the siblings it was queued alongside instead of falling
      // back to the renderer's index-less "00".
      const retryIndexByUrl = new Map(
        retries.map((retry) => [
          retry.videoUrl,
          retry.mediaPlaylistIndex ?? undefined,
        ])
      );
      const targets = [
        ...new Set([
          ...retryUrls,
          ...(latestVideoUrl && latestVideoUrl !== sub.lastVideoLink
            ? [latestVideoUrl]
            : []),
        ]),
      ];
      // What this check has already put a download attempt behind, so the
      // Shorts probe below can tell "nothing has touched this URL" from "the
      // retry batch already tried it and it failed".
      const attemptedTargets = new Set<string>();
      // Each target is attempted once per interval, independently of the feed head.
      for (const videoUrl of targets) {
        attemptedTargets.add(videoUrl);
        markVideoRetryAttempted(sub.id, videoUrl);
        const isHead = videoUrl === latestVideoUrl;
        const mediaPlaylistIndex = retryIndexByUrl.get(videoUrl);
        const existingVideo = this.getExistingSubscriptionVideo(sub, videoUrl);
        if (existingVideo) {
          if (!this.linkSubscriptionVideoToCollection(sub, existingVideo.id, videoUrl)) {
            this.queueRetryForUnsettledVideo(sub, videoUrl);
            checkStatus = "fail";
            checkFailureReason = bucketDownloadError(
              COLLECTION_LINK_FAILURE_REASON
            );
            continue;
          }
          if (isHead) await this.advanceVideoCursor(sub, videoUrl);
          removeVideoRetry(sub.id, videoUrl);
          continue;
        }

        logger.info(
          "New video found for subscription",
          getSubscriptionLogContext(sub, { videoUrl })
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
          return;
        }

        // 3. Download the video through the queue so it is visible and
        // cancellable in the downloads UI, counts against the global
        // concurrency limit, and gains cloud upload / hooks / dedupe
        // tracking. addDownload resolves with the download result on
        // completion; the manager's own history rows, Telegram notification,
        // and auto-retry are suppressed because this check owns those
        // (subscription-stamped history below, notifySubscriptionDownloadResult,
        // and the check interval as backoff).
        let downloadResult: any;
        let videoDownloaded = false;
        let downloadedVideoTitle = `New video from ${sub.author}`;
        try {
          downloadResult = await this.enqueueSubscriptionDownload(
            sub,
            videoUrl,
            downloadedVideoTitle,
            mediaPlaylistIndex
          );

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
            sourceUrl: videoUrl,
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

          // 4. Update subscription record with new video link and stats on
          // success. Recorded before the collection link is attempted: the
          // media and its success-history row are already saved, so a failure
          // to link must not cost the download its count - the next check would
          // find the media present, repair the membership through the
          // existing-video path, and never make up the increment.
          const updateResult = await db
            .update(subscriptions)
            .set({
              ...(isHead ? { lastVideoLink: videoUrl } : {}),
              downloadCount: (sub.downloadCount || 0) + checkNewVideoCount,
            })
            .where(eq(subscriptions.id, sub.id))
            .returning({ id: subscriptions.id });

          if (updateResult.length === 0) {
              logger.warn(
                "Subscription was deleted after download completed",
                getSubscriptionLogContext(sub, { videoUrl })
              );
            return;
          } else {
            // Only a linked video is fully settled; otherwise the targeted
            // retry stays queued until the membership can be repaired.
            if (
              this.linkSubscriptionVideoToCollection(sub, videoData.id, videoUrl)
            ) {
              removeVideoRetry(sub.id, videoUrl);
            } else {
              this.queueRetryForUnsettledVideo(sub, videoUrl);
              checkStatus = "fail";
              checkFailureReason = bucketDownloadError(
                COLLECTION_LINK_FAILURE_REASON
              );
            }
            notifySubscriptionDownloadResult({
              taskTitle: downloadedVideoTitle,
              status: "success",
              sourceUrl: videoUrl,
            });
            logger.debug(
              "Successfully processed subscription",
              getSubscriptionLogContext(sub, { videoUrl })
            );
          }
        } catch (downloadError: unknown) {
          const errorMessage = getErrorMessage(
            downloadError,
            "Download failed"
          );

          if (videoDownloaded) {
            // The media is saved but nothing after it ran - no collection
            // membership, and for a fresh head no retry row either. Queue it,
            // or a newer head arriving before the next check would leave this
            // one untargeted and its membership never repaired.
            this.queueRetryForUnsettledVideo(sub, videoUrl);
            checkStatus = "fail";
            checkFailureReason = bucketDownloadError(errorMessage);
            logger.error(
              "Error updating subscription after video download",
              downloadError,
              getSubscriptionLogContext(sub, { videoUrl })
            );

            notifySubscriptionDownloadResult({
              taskTitle: downloadedVideoTitle,
              status: "fail",
              sourceUrl: videoUrl,
              error: `Subscription processing failed after download: ${errorMessage}`,
            });
            continue;
          }

          // Members-only uploads can't be fetched without a channel membership,
          // so retrying every check is pointless. Treat them as skipped and
          // advance the cursor instead of failing the check (issue #393). Fall
          // through (no return) so an independent new Short is still checked
          // this cycle, matching the ordinary-failure path below.
          if (isMembersOnlyError(downloadError)) {
            await this.markSubscriptionVideoSkipped(
              sub,
              videoUrl,
              "video",
              "members-only",
              isHead
            );
            removeVideoRetry(sub.id, videoUrl);
          } else {
            logger.error(
              "Error downloading subscription video",
              downloadError,
              getSubscriptionLogContext(sub, { videoUrl })
            );
            notifySubscriptionDownloadResult({
              taskTitle: `Video from ${sub.author}`,
              status: "fail",
              sourceUrl: videoUrl,
              error: errorMessage,
            });

            // Add to download history on failure
            storageService.addDownloadHistoryItem({
              id: uuidv4(),
              title: `Video from ${sub.author}`,
              author: sub.author,
              sourceUrl: videoUrl,
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
        }
      }
      {
        // Also back off checks that only settled existing retry targets.
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
          return;
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
          return;
        }

        try {
          const latestShortUrl = await YtDlpDownloader.getLatestShortsUrl(
            sub.authorUrl,
            sub.ytdlpConfig
          );

        if (latestShortUrl && latestShortUrl !== sub.lastShortVideoLink) {
          // The Shorts backfill task runs under this same subscription id, so a
          // Short it failed on is queued as a plain URL with nothing to mark it
          // as a Short - and the retry batch above, which only ever moves the
          // video cursor, may already have downloaded it earlier in this very
          // check. Settling media we hold, rather than fetching a second copy,
          // is what the main loop does for its own head and is what keeps that
          // recovery from landing twice.
          if (this.getExistingSubscriptionVideo(sub, latestShortUrl)) {
            logger.info(
              "Subscription short is already downloaded; advancing cursor without re-downloading",
              getSubscriptionLogContext(sub, { latestShortUrl })
            );
            await this.advanceVideoCursor(sub, latestShortUrl, "short");
            return;
          }

          // Attempted just above and it did not produce media - it failed, or
          // it was skipped as unfetchable. Downloading again in the same check
          // buys nothing and doubles the failure history and notifications; the
          // interval is the backoff, as it is for every other target.
          if (attemptedTargets.has(latestShortUrl)) {
            logger.info(
              "Subscription short was already attempted in this check; leaving it for the next one",
              getSubscriptionLogContext(sub, { latestShortUrl })
            );
            return;
          }

          logger.info(
            "New short found for subscription",
            getSubscriptionLogContext(sub, { latestShortUrl })
          );

          // Download the short (queue-routed; see the main-video comment).
          let shortDownloaded = false;
          let downloadedShortTitle = `New short from ${sub.author}`;
          try {
            const downloadResult = await this.enqueueSubscriptionDownload(
              sub,
              latestShortUrl,
              downloadedShortTitle
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
                downloadCount: (sub.downloadCount || 0) + checkNewVideoCount,
              })
              .where(eq(subscriptions.id, sub.id))
              .returning({ id: subscriptions.id });

            if (shortUpdateResult.length === 0) {
              logger.warn(
                "Subscription was deleted after short download completed",
                getSubscriptionLogContext(sub, { latestShortUrl })
              );
              return;
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
            // Members-only shorts can't be fetched without a channel
            // membership; skip and advance the cursor rather than failing
            // and retrying every check (issue #393).
            if (!shortDownloaded && isMembersOnlyError(downloadError)) {
              await this.markSubscriptionVideoSkipped(
                sub,
                latestShortUrl,
                "short",
                "members-only"
              );
              return;
            }

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
              return;
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
          // A playlists watcher counts the child subscriptions it discovered,
          // which is a meaningful event count but not a download of anything.
          downloadedCount:
            sub.subscriptionType === "channel_playlists"
              ? 0
              : checkNewVideoCount,
          failureReason: checkFailureReason,
        });
      } catch {
        // statistics is best-effort
      }
    }
  }

  /** Find existing media using the subscription's effective download format. */
  private getExistingSubscriptionVideo(sub: Subscription, videoUrl: string) {
    const { audioOnly } = resolveDownloadAudioMode({
      userConfig: getEffectiveUserYtDlpConfig(videoUrl, sub.ytdlpConfig),
    });
    return storageService.getVideoBySourceUrl(
      videoUrl,
      audioOnly ? "audio" : "video"
    );
  }

  /**
   * Queue the video for another attempt after something left it unsettled -
   * its collection membership could not be created, or the bookkeeping that
   * follows the download threw.
   *
   * A feed head reaches these paths without a retry row of its own, and its
   * cursor may already have advanced, so the next check would filter it out as
   * "not new" and the collection would be permanently short one video it
   * actually holds. Queuing is idempotent, so a target that arrived from the
   * retry table simply stays.
   */
  private queueRetryForUnsettledVideo(sub: Subscription, videoUrl: string): void {
    try {
      queueVideoRetry(sub.id, videoUrl);
    } catch (error) {
      logger.error(
        "Could not queue a retry for an unlinked subscription video",
        error,
        getSubscriptionLogContext(sub, { videoUrl })
      );
    }
  }

  /**
   * Link a subscription's video into its collection.
   *
   * Returns false when the membership was not created, which keeps the
   * targeted retry queued. A deleted collection is the case worth saying out
   * loud: `addVideoToCollection` answers `null` for it rather than throwing, so
   * treating the call as settled would drop the retry for a video the playlist
   * never received, leaving nothing to reconsider it if the subscription is
   * pointed at another collection later.
   */
  private linkSubscriptionVideoToCollection(
    sub: Subscription,
    videoId: string | undefined,
    videoUrl: string
  ): boolean {
    if (sub.subscriptionType !== "playlist" || !sub.collectionId) {
      return true;
    }
    if (!videoId) {
      // Membership is required here and cannot be created without an id, so
      // this is a failure to link, not a case with nothing to do.
      logger.error(
        "Subscription video has no id to link into its collection",
        getSubscriptionLogContext(sub, {
          videoUrl,
          collectionId: sub.collectionId,
        })
      );
      return false;
    }

    try {
      const linked = storageService.addVideoToCollection(
        sub.collectionId,
        videoId
      );
      if (!linked) {
        logger.error(
          "Subscription collection is missing; keeping the targeted retry",
          getSubscriptionLogContext(sub, {
            videoUrl,
            collectionId: sub.collectionId,
          })
        );
        return false;
      }
      logger.info(
        `Added video ${videoId} to collection ${sub.collectionId} from playlist subscription`
      );
      return true;
    } catch (error) {
      logger.error(
        `Error adding video to collection ${sub.collectionId}:`,
        error,
        getSubscriptionLogContext(sub, { videoUrl })
      );
      return false;
    }
  }

  /** Move the feed cursor without recording a download. */
  private async advanceVideoCursor(
    sub: Subscription,
    videoUrl: string,
    kind: "video" | "short" = "video"
  ): Promise<void> {
    await db
      .update(subscriptions)
      .set({
        ...(kind === "short"
          ? { lastShortVideoLink: videoUrl }
          : { lastVideoLink: videoUrl }),
        lastCheck: Date.now(),
      })
      .where(eq(subscriptions.id, sub.id));
  }

  /**
   * Record a subscription upload that cannot be downloaded (currently only
   * members-only YouTube videos) as skipped and advance the subscription's
   * cursor so the same upload isn't retried on every check (issue #393).
   *
   * The download genuinely failed at yt-dlp, but retrying is pointless without
   * a channel membership, so we treat it as a benign skip rather than a
   * failure: an informational log, a "skipped" history row, and a cursor bump.
   * The subscription's downloadCount is intentionally left unchanged since
   * nothing was downloaded.
   */
  private async markSubscriptionVideoSkipped(
    sub: Subscription,
    videoUrl: string,
    kind: "video" | "short",
    reason: string,
    advanceCursor = true
  ): Promise<void> {
    logger.info(
      `Skipping members-only ${kind} for subscription; marking as processed`,
      getSubscriptionLogContext(sub, { videoUrl, reason })
    );

    const cursorUpdate =
      kind === "short"
        ? { lastShortVideoLink: videoUrl }
        : { lastVideoLink: videoUrl };

    const updateResult = await db
      .update(subscriptions)
      .set(advanceCursor ? cursorUpdate : { lastCheck: Date.now() })
      .where(eq(subscriptions.id, sub.id))
      .returning({ id: subscriptions.id });

    if (updateResult.length === 0) {
      logger.warn(
        "Subscription was deleted before members-only skip could be recorded",
        getSubscriptionLogContext(sub, { videoUrl })
      );
      return;
    }

    storageService.addDownloadHistoryItem({
      id: uuidv4(),
      title: `${kind === "short" ? "Short" : "Video"} from ${sub.author}`,
      author: sub.author,
      sourceUrl: videoUrl,
      finishedAt: Date.now(),
      status: "skipped",
      error: `Skipped ${reason} content`,
      subscriptionId: sub.id,
      platform:
        typeof sub.platform === "string"
          ? sub.platform.toLowerCase()
          : undefined,
      sourceKind: "subscription",
    });
  }

  /**
   * Run one subscription download through downloadManager's queue and await
   * its completion. The queue provides UI visibility, cancellation, the
   * global concurrency limit, cloud upload, hooks, and dedupe tracking; the
   * manager's duplicate side effects (history rows, Telegram notification,
   * auto-retry) are suppressed because the calling check owns them.
   */
  private enqueueSubscriptionDownload(
    sub: Subscription,
    videoUrl: string,
    initialTitle: string,
    mediaPlaylistIndex?: number
  ): Promise<any> {
    const downloadTaskId = uuidv4();
    const isBilibili = sub.platform === "Bilibili";
    return downloadManager.addDownload(
      (registerCancel) =>
        isBilibili
          ? downloadSingleBilibiliPart(
              videoUrl,
              1,
              1,
              "",
              downloadTaskId,
              registerCancel,
              undefined,
              buildFilenameTemplateSourceOptions(sub, mediaPlaylistIndex),
              {
                subscriptionYtdlpConfig: sub.ytdlpConfig,
                subscriptionFilenameTemplate: sub.filenameTemplate,
              }
            )
          : downloadYouTubeVideo(videoUrl, {
              downloadId: downloadTaskId,
              onStart: registerCancel,
              filenameTemplateSourceOptions:
                buildFilenameTemplateSourceOptions(sub, mediaPlaylistIndex),
              subscriptionYtdlpConfig: sub.ytdlpConfig,
              subscriptionFilenameTemplate: sub.filenameTemplate,
            }),
      downloadTaskId,
      initialTitle,
      videoUrl,
      isBilibili ? "bilibili" : "youtube",
      {
        actorRole: "system",
        surface: "background",
        sourceKind: "subscription",
      },
      undefined,
      {
        suppressHistory: true,
        suppressCompletionNotification: true,
        disableAutoRetry: true,
      }
    );
  }

  /**
   * Whether `sub` is the only subscription pointing at this collection.
   *
   * A source-less collection can be shared - subscriptions get-or-create it by
   * name - and once it carries a source key, every subscription on it prefers
   * the collection's type/mid/id over its own `playlistId`. Stamping one
   * subscription's source therefore repoints the others, and checks run
   * concurrently, so two of them could also race to stamp different sources.
   * A Bilibili source is the compound (platform, type, mid, id) the collections
   * table is keyed on, but a subscription row stores only the id half, so two
   * subscribers cannot be shown to be equivalent without resolving each one's
   * full source against Bilibili. Exclusivity is the condition that can be
   * decided from the rows in hand.
   */
  private collectionIsExclusiveToSubscription(
    collectionId: string,
    sub: Subscription
  ): boolean {
    // Synchronous (better-sqlite3) and called from inside the collection write,
    // so this cannot observe membership that changes before the stamp lands.
    const referencing = db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.collectionId, collectionId))
      .all();

    // Not `every`: an empty set would pass it, and the only way this
    // subscription is missing from its own collection's referrers is that it
    // was repointed or removed while the probe was in flight - in which case
    // this poll has no business stamping the collection it left behind.
    return referencing.length === 1 && referencing[0].id === sub.id;
  }

  private async getPlaylistSubscriptionHeadSnapshot(
    sub: Subscription
  ): Promise<{ headVideoUrl: string | null }> {
    if (sub.platform === "Bilibili") {
      const collection = sub.collectionId
        ? storageService.getCollectionById(sub.collectionId)
        : undefined;
      const sourceType =
        collection?.sourcePlatform === "bilibili" &&
        (collection.sourceType === "collection" ||
          collection.sourceType === "series")
          ? collection.sourceType
          : undefined;
      const hasCollectionSource =
        Boolean(sourceType && collection?.sourceMid) &&
        Boolean(collection?.sourceId || sub.playlistId);

      if (hasCollectionSource || extractBilibiliVideoId(sub.authorUrl)) {
        const snapshot = await getBilibiliCollectionHeadSnapshot(
          sub.authorUrl,
          {
            type: sourceType,
            mid: collection?.sourceMid,
            id: collection?.sourceId ?? sub.playlistId,
          },
          { subscriptionYtdlpConfig: sub.ytdlpConfig }
        );

        // Subscriptions created before the collection carried a source key have
        // to re-derive it from the video URL on every poll, and that derivation
        // goes through Bilibili's risk-controlled view endpoint. Stamp what we
        // just resolved so the next poll addresses the collection directly.
        if (collection && !hasCollectionSource) {
          saveBilibiliCollectionSourceIfCompatible(
            collection,
            snapshot.bilibiliSource,
            () => this.collectionIsExclusiveToSubscription(collection.id, sub)
          );
        }

        return snapshot;
      }
    }

    return getPlaylistHeadSnapshot(sub.authorUrl, sub.platform, {
      subscriptionYtdlpConfig: sub.ytdlpConfig,
    });
  }

  /**
   * Thin delegations to the extracted Twitch implementation. Retained as
   * instance methods because tests spy on / exercise them directly.
   */
  private checkTwitchSubscription(sub: Subscription): Promise<number> {
    return checkTwitchSubscriptionImpl(sub);
  }

  private processTwitchSubscriptionVideos(
    sub: Subscription,
    videosToProcess: Array<{
      id: string;
      url: string;
      title: string;
      authorName?: string | null;
    }>
  ): Promise<number> {
    return processTwitchSubscriptionVideosImpl(sub, videosToProcess);
  }

  startScheduler() {
    stopSubscriptionSchedulerTasks({
      checkTask: this.checkTask,
      retentionCleanupTask: this.retentionCleanupTask,
    });

    const tasks = createSubscriptionSchedulerTasks(() =>
      this.checkSubscriptions()
    );
    this.checkTask = tasks.checkTask;
    this.retentionCleanupTask = tasks.retentionCleanupTask;
  }

  // Helper to get latest video URL based on platform
  private async getLatestVideoUrl(
    channelUrl: string,
    platform?: string,
    subscriptionYtdlpConfig?: string | null
  ): Promise<string | null> {
    if (platform === "Bilibili" || isBilibiliSpaceUrl(channelUrl)) {
      return await BilibiliDownloader.getLatestVideoUrl(
        channelUrl,
        subscriptionYtdlpConfig
      );
    }

    // Default to YouTube/yt-dlp
    return await YtDlpDownloader.getLatestVideoUrl(
      channelUrl,
      subscriptionYtdlpConfig
    );
  }
}

export const subscriptionService = SubscriptionService.getInstance();
