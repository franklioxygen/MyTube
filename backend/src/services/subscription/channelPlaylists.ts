import { eq } from "drizzle-orm";
import { db } from "../../db";
import { subscriptions } from "../../db/schema";
import { logger } from "../../utils/logger";
import { getSubscriptionLogContext } from "./helpers";
import {
  deleteCreatedCollectionIfUnused,
  extractYouTubePlaylistId,
  resolveChannelPlaylistCollectionWithStatus,
  sanitizePlaylistTitle,
} from "./playlistResolution";
import type { Subscription } from "./types";
import type { SubscribePlaylistOptions } from "../subscriptionService";
import { getPlaylistHeadSnapshot } from "./playlistFeed";

/**
 * Dependencies the extracted watcher logic needs from the service. Kept
 * explicit so this module stays pure and testable in isolation.
 */
export interface ChannelPlaylistDeps {
  listSubscriptions: () => Promise<Subscription[]>;
  subscribePlaylist: (options: SubscribePlaylistOptions) => Promise<unknown>;
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
      getEffectiveUserYtDlpConfig,
    } = await import("../../utils/ytDlpUtils");
    const { getProviderScript } = await import(
      "../downloaders/ytdlp/ytdlpHelpers"
    );

    // Layer any per-subscription override on top of the global config (#345) so
    // the proxy/cookies/rate-limit settings needed to enumerate the channel's
    // playlists apply to this watcher listing, not just eventual downloads.
    const userConfig = getEffectiveUserYtDlpConfig(
      sub.authorUrl,
      sub.ytdlpConfig
    );
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

      // Extract playlist ID
      const playlistId = entry.id ?? extractYouTubePlaylistId(playlistUrl);

      try {
        // Capture the head baseline BEFORE creating any persistent side effect
        // (design §8.2 / F7). The watcher is always subscribe-only (no
        // historical task); the baseline ensures existing entries in a newly
        // discovered playlist are not implicitly downloaded on the first poll.
        // Capture the head with the watcher's effective yt-dlp config.
        const snapshot = await getPlaylistHeadSnapshot(
          playlistUrl,
          sub.platform,
          { subscriptionYtdlpConfig: sub.ytdlpConfig }
        );

        // Resolve the destination collection only after a successful snapshot
        // (design §8.2) so a failed probe leaves no orphan collection.
        const collectionResolution = resolveChannelPlaylistCollectionWithStatus(
          title,
          channelName
        );
        const collectionId = collectionResolution.collection.id;

        // Create the child subscription with the head and observation timestamp.
        try {
          await deps.subscribePlaylist({
            playlistUrl,
            interval: sub.interval, // Use same interval as watcher
            playlistTitle: title,
            playlistId: playlistId || "",
            author: channelName,
            platform: sub.platform,
            collectionId,
            initialHeadVideoUrl: snapshot.headVideoUrl,
            baselineObservedAt: snapshot.observedAt,
            filenameTemplate: sub.filenameTemplate ?? null,
          });
        } catch (error) {
          // The watcher has no task-creation path, so a freshly-created,
          // empty, unreferenced collection is safe to remove on an insertion
          // failure (design §7.3 / §8.2).
          try {
            await deleteCreatedCollectionIfUnused(
              collectionResolution,
              deps.listSubscriptions
            );
          } catch (cleanupError) {
            logger.error(
              `Failed to clean up collection for playlist ${title}:`,
              cleanupError
            );
          }
          throw error;
        }
        // Add the URL only after insertion succeeds (design §8.2).
        subscribedUrls.add(playlistUrl);
        newSubscriptionsCount++;
      } catch (error) {
        // A failed baseline probe (or insert) does not subscribe and does not
        // add the URL to the set; the next watcher interval will retry
        // (design §8.2).
        logger.error(
          `Error auto-subscribing to playlist ${title}:`,
          error
        );
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
