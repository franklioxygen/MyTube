import { isBilibiliUrl } from "../../utils/helpers";
import { executeYtDlpJson, getNetworkConfigFromUserConfig, getUserYtDlpConfig } from "../../utils/ytDlpUtils";
import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import type { Collection } from "../storageService";

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
export function resolvePlaylistCollection(collectionName: string): Collection {
  let collection = storageService.getCollectionByName(collectionName);

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
    logger.info(
      `Created collection "${uniqueCollectionName}" with ID ${collection.id}`
    );
  } else {
    logger.info(
      `Using existing collection "${collection.name}" with ID ${collection.id}`
    );
  }

  return collection;
}

/**
 * Get-or-create a collection for a playlist, naming it from the playlist
 * title plus an optional cleaned channel name (the variant used by the
 * channel-playlists loop).
 */
export function resolveChannelPlaylistCollection(
  playlistTitle: string,
  channelName: string | null,
): Collection {
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
      id: Date.now().toString(),
      name: uniqueCollectionName,
      videos: [],
      createdAt: new Date().toISOString(),
      title: uniqueCollectionName,
    };
    storageService.saveCollection(collection);
    logger.info(
      `Created collection "${uniqueCollectionName}" for playlist: ${playlistTitle}`
    );
  }

  return collection;
}

/**
 * Extract a playlist ID from Bilibili playlist info via yt-dlp, when it
 * wasn't already available from the request. Best-effort: returns null on
 * failure (the caller logs and continues).
 */
export async function extractBilibiliPlaylistId(
  playlistUrl: string,
): Promise<string | null> {
  try {
    const userConfig = getUserYtDlpConfig(playlistUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    const info = await executeYtDlpJson(playlistUrl, {
      ...networkConfig,
      noWarnings: true,
      flatPlaylist: true,
      playlistEnd: 1,
    });

    if (info.id) {
      return info.id;
    } else if (info.extractor_key === "bilibili:playlist") {
      // For Bilibili playlists, the ID might be in the URL or extractor info
      return info.playlist_id || info.id || null;
    }
  } catch (error) {
    logger.warn(
      "Could not extract playlist ID, continuing without it:",
      error
    );
  }
  return null;
}

/**
 * Best-effort extraction of an author name from a playlist's first entry /
 * uploader / channel metadata via yt-dlp. Returns "Playlist Author" when no
 * author can be determined or the probe fails.
 */
export async function extractPlaylistAuthor(
  playlistUrl: string,
): Promise<string> {
  let author = "Playlist Author";

  try {
    const userConfig = getUserYtDlpConfig(playlistUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    const info = await executeYtDlpJson(playlistUrl, {
      ...networkConfig,
      noWarnings: true,
      flatPlaylist: true,
      playlistEnd: 1,
    });

    if (info.entries && info.entries.length > 0) {
      const firstEntry = info.entries[0];
      if (firstEntry.uploader) {
        author = firstEntry.uploader;
      } else if (firstEntry.channel) {
        author = firstEntry.channel;
      }
    } else if (info.uploader) {
      author = info.uploader;
    } else if (info.channel) {
      author = info.channel;
    }
  } catch (error) {
    logger.warn(
      "Could not extract author from playlist, using default:",
      error
    );
  }

  return author;
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
