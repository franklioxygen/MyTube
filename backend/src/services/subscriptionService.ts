import { eq } from "drizzle-orm";
import cron, { ScheduledTask } from "node-cron";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { subscriptions } from "../db/schema";
import { DuplicateError, ValidationError } from "../errors/DownloadErrors";
import { extractBilibiliMid, isBilibiliSpaceUrl } from "../utils/helpers";
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

  async subscribe(authorUrl: string, interval: number): Promise<Subscription> {
    // Detect platform and validate URL
    let platform: string;
    let authorName = "Unknown Author";

    if (isBilibiliSpaceUrl(authorUrl)) {
      platform = "Bilibili";

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
    } else if (authorUrl.includes("youtube.com")) {
      platform = "YouTube";

      // Extract author from YouTube URL if possible
      const match = authorUrl.match(/youtube\.com\/(@[^\/]+)/);
      if (match && match[1]) {
        authorName = match[1];
      } else {
        // Fallback: try to extract from other URL formats
        const parts = authorUrl.split("/");
        if (parts.length > 0) {
          const lastPart = parts[parts.length - 1];
          if (lastPart) authorName = lastPart;
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
    };

    await db.insert(subscriptions).values(newSubscription);
    return newSubscription;
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

      const now = Date.now();
      const lastCheck = sub.lastCheck || 0;
      const intervalMs = sub.interval * 60 * 1000;

      if (now - lastCheck >= intervalMs) {
        try {
          console.log(
            `Checking subscription for ${sub.author} (${sub.platform})...`
          );

          // 1. Fetch latest video link based on platform
          const latestVideoUrl = await this.getLatestVideoUrl(
            sub.authorUrl,
            sub.platform
          );

          if (latestVideoUrl && latestVideoUrl !== sub.lastVideoLink) {
            console.log(`New video found for ${sub.author}: ${latestVideoUrl}`);

            // 2. Download the video based on platform
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
              });
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
              });

              // Don't update lastVideoLink on failure so we retry next time
              await db
                .update(subscriptions)
                .set({ lastCheck: now })
                .where(eq(subscriptions.id, sub.id));
              continue;
            }

            // 3. Update subscription record
            await db
              .update(subscriptions)
              .set({
                lastVideoLink: latestVideoUrl,
                lastCheck: now,
                downloadCount: (sub.downloadCount || 0) + 1,
              })
              .where(eq(subscriptions.id, sub.id));
          } else {
            // Just update lastCheck
            await db
              .update(subscriptions)
              .set({ lastCheck: now })
              .where(eq(subscriptions.id, sub.id));
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
}

export const subscriptionService = SubscriptionService.getInstance();
