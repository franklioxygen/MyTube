import { isBilibiliUrl } from "../../utils/helpers";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import type { Collection } from "../storageService";

/**
 * A collection resolved for a playlist subscription, including whether this
 * request created it. Callers use that fact to safely clean up a fresh empty
 * collection when subscription insertion fails after the collection write.
 */
export interface ResolvedPlaylistCollection {
  collection: Collection;
  created: boolean;
}

/**
 * Extract a YouTube playlist id (`list=` param) from a URL, or null if absent.
 */
export function extractYouTubePlaylistId(playlistUrl: string): string | null {
  const match = playlistUrl.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return match && match[1] ? match[1] : null;
}

/**
 * Detect the download platform for a playlist URL.
 */
export function detectPlaylistPlatform(playlistUrl: string): "Bilibili" | "YouTube" {
  return isBilibiliUrl(playlistUrl) ? "Bilibili" : "YouTube";
}

/**
 * Get-or-create a collection by name, mirroring the lookup-then-create
 * sequence used by createPlaylistSubscription. Returns the resolved
 * collection (existing or newly created).
 */
export function resolvePlaylistCollectionWithStatus(
  collectionName: string
): ResolvedPlaylistCollection {
  let collection = storageService.getCollectionByName(collectionName);

  if (!collection) {
    const uniqueCollectionName =
      storageService.generateUniqueCollectionName(collectionName);
    collection = {
      // Channel-playlist bulk creation can create several collections inside
      // the same millisecond. A UUID keeps those sequential storage writes
      // collision-free instead of relying on Date.now() uniqueness.
      id: uuidv4(),
      name: uniqueCollectionName,
      videos: [],
      createdAt: new Date().toISOString(),
      title: uniqueCollectionName,
    };
    storageService.saveCollection(collection);
    logger.info(
      `Created collection "${uniqueCollectionName}" with ID ${collection.id}`
    );
    return { collection, created: true };
  } else {
    logger.info(
      `Using existing collection "${collection.name}" with ID ${collection.id}`
    );
    return { collection, created: false };
  }
}

/**
 * Backward-compatible collection resolver for callers that only need the
 * collection. New subscription flows should use the status-aware variant so
 * they can avoid orphaning a collection on a later insert failure.
 */
export function resolvePlaylistCollection(collectionName: string): Collection {
  return resolvePlaylistCollectionWithStatus(collectionName).collection;
}

/**
 * Get-or-create a collection for a playlist, naming it from the playlist
 * title plus an optional cleaned channel name (the variant used by the
 * channel-playlists loop).
 */
export function resolveChannelPlaylistCollectionWithStatus(
  playlistTitle: string,
  channelName: string | null,
): ResolvedPlaylistCollection {
  const cleanChannelName =
    channelName && channelName !== "Unknown"
      ? channelName.replace(/[\/\\:*?"<>|]/g, "-").trim()
      : null;
  const collectionName = cleanChannelName
    ? `${playlistTitle} - ${cleanChannelName}`
    : playlistTitle;

  let collection = storageService.getCollectionByName(collectionName);
  if (!collection) {
    collection = storageService.getCollectionByName(playlistTitle);
  }

  if (!collection) {
    const uniqueCollectionName =
      storageService.generateUniqueCollectionName(collectionName);
    collection = {
      id: uuidv4(),
      name: uniqueCollectionName,
      videos: [],
      createdAt: new Date().toISOString(),
      title: uniqueCollectionName,
    };
    storageService.saveCollection(collection);
    logger.info(
      `Created collection "${uniqueCollectionName}" for playlist: ${playlistTitle}`
    );
    return { collection, created: true };
  }

  return { collection, created: false };
}

/**
 * Backward-compatible channel-playlist resolver. Prefer the status-aware
 * variant while creating a subscription so a fresh collection can be cleaned
 * up if that creation fails.
 */
export function resolveChannelPlaylistCollection(
  playlistTitle: string,
  channelName: string | null,
): Collection {
  return resolveChannelPlaylistCollectionWithStatus(
    playlistTitle,
    channelName
  ).collection;
}

/**
 * Remove a collection created by the current request only when it is still
 * provably unused. This is intentionally conservative: an existing
 * collection, one with videos, or one referenced by any subscription is never
 * deleted. Call only before a task can be created for the collection.
 */
export async function deleteCreatedCollectionIfUnused(
  resolution: ResolvedPlaylistCollection,
  listSubscriptions: () => Promise<Array<{ collectionId?: string | null }>>
): Promise<void> {
  if (!resolution.created) return;

  const current = storageService.getCollectionById(resolution.collection.id);
  if (!current || (current.videos?.length ?? 0) > 0) return;

  const subscriptions = await listSubscriptions();
  if (subscriptions.some((sub) => sub.collectionId === current.id)) return;

  if (storageService.deleteCollection(current.id)) {
    logger.info(
      `Deleted unused collection "${current.name}" after playlist subscription creation failed`
    );
  }
}

/**
 * Derive a channel display name from a yt-dlp channel-playlists result,
 * with multiple fallbacks (uploader → channel → first entry → URL handle).
 * Returns "Unknown" when nothing can be derived.
 */
export function deriveChannelName(
  result: {
    uploader?: string;
    channel?: string;
    channel_id?: string;
    entries?: Array<{ uploader?: string; channel?: string }>;
  },
  sourceUrl: string,
): string {
  let channelName = "Unknown";
  if (result.uploader) {
    channelName = result.uploader;
  } else if (result.channel) {
    channelName = result.channel;
  } else if (result.channel_id && result.entries && result.entries.length > 0) {
    const firstEntry = result.entries[0];
    if (firstEntry.uploader) {
      channelName = firstEntry.uploader;
    } else if (firstEntry.channel) {
      channelName = firstEntry.channel;
    }
  }

  // Fallback: try to extract from URL if still not found
  if (channelName === "Unknown") {
    const match = decodeURI(sourceUrl).match(/youtube\.com\/(@[^\/]+)/);
    if (match && match[1]) {
      channelName = match[1];
    }
  }

  return channelName;
}

/**
 * Adjust a channel URL to target its /playlists tab.
 */
export function toPlaylistsTabUrl(url: string): string {
  if (!url.includes("/playlists")) {
    return url.endsWith("/") ? `${url}playlists` : `${url}/playlists`;
  }
  return url;
}

/**
 * Sanitize a raw playlist title into a filesystem-safe label.
 */
export function sanitizePlaylistTitle(title: string): string {
  return (title || "Untitled Playlist")
    .replace(/[\/\\:*?"<>|]/g, "-")
    .trim();
}
