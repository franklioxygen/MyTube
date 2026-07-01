import { eq } from "drizzle-orm";
import { db } from "../../db";
import { subscriptions } from "../../db/schema";
import { logger } from "../../utils/logger";
import { getSubscriptionLogContext } from "./helpers";
import {
  extractYouTubePlaylistId,
  resolveChannelPlaylistCollection,
  sanitizePlaylistTitle,
} from "./playlistResolution";
import type { Subscription } from "./types";

/**
 * Dependencies the extracted watcher logic needs from the service. Kept
 * explicit so this module stays pure and testable in isolation.
 */
export interface ChannelPlaylistDeps {
  listSubscriptions: () => Promise<Subscription[]>;
  subscribePlaylist: (
    playlistUrl: string,
    interval: number,
    title: string,
    playlistId: string,
    channelName: string,
    platform: string,
    collectionId: string | null,
  ) => Promise<unknown>;
}

/**
 * Check a channel-playlists watcher subscription for new playlists and
 * auto-subscribe to any not yet tracked. Returns the count of newly created
 * subscriptions.
 *
 * Extracted from SubscriptionService.checkChannelPlaylists; the service still
 * exposes the instance method (which delegates here) so existing tests that
 * spy on the instance method keep working.
 */
export async function checkChannelPlaylistsForWatcher(
  sub: Subscription,
  deps: ChannelPlaylistDeps,
): Promise<number> {
  try {
    logger.info("Checking channel playlists", getSubscriptionLogContext(sub));

    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const { getProviderScript } = await import(
      "../downloaders/ytdlp/ytdlpHelpers"
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
    const existingSubscriptions = await deps.listSubscriptions();
    const subscribedUrls = new Set(
      existingSubscriptions.map((item) => item.authorUrl)
    );
    // Process each playlist
    for (const entry of result.entries) {
      if (!entry.url && !entry.id) continue;

      const playlistUrl =
        entry.url || `https://www.youtube.com/playlist?list=${entry.id}`;
      const title = sanitizePlaylistTitle(entry.title);

      if (subscribedUrls.has(playlistUrl)) {
        continue;
      }

      logger.info(`Watcher found new playlist: ${title} (${playlistUrl})`);

      // Determine channel name for collection naming and subscription
      // For channel_playlists subscriptions, author is already the clean channel name
      const channelName = sub.author;

      // Get or create collection
      const collectionId = resolveChannelPlaylistCollection(title, channelName).id;

      // Extract playlist ID
      const playlistId = entry.id ?? extractYouTubePlaylistId(playlistUrl);

      try {
        // Subscribe to the new playlist
        await deps.subscribePlaylist(
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
