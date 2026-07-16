import { isBilibiliUrl } from "../../utils/helpers";
import {
  executeYtDlpJson,
  getEffectiveUserYtDlpConfig,
  getNetworkConfigFromUserConfig,
} from "../../utils/ytDlpUtils";
import { logger } from "../../utils/logger";
import { ValidationError } from "../../errors/DownloadErrors";

/**
 * Playlist source inspection boundary (design §6).
 *
 * This module is the single place that turns a playlist URL into either a
 * typed "current head" snapshot or a richer metadata inspection. It exists so
 * the baseline captured at subscription-creation time and the head observed at
 * scheduled poll time use the *same* normalization, so equality between the
 * stored cursor and a later probe is stable.
 *
 * Failure model (design §6.4):
 * - A successful playlist result with an empty `entries` array returns
 *   `headVideoUrl: null` (a *verified empty* playlist).
 * - Network / extractor / authentication errors propagate (throw). They are
 *   NOT converted to `null`, because that ambiguity previously allowed a
 *   failed probe to look like an empty playlist and seed an empty cursor.
 * - A non-playlist result or a non-empty first entry that cannot be converted
 *   to a playable URL is an error, not an empty playlist.
 */

export interface PlaylistHeadSnapshot {
  /** The current leading/latest playlist entry as a canonical URL, or null when the playlist is verified empty. */
  headVideoUrl: string | null;
  /** Timestamp (ms) at which the head was observed. */
  observedAt: number;
}

export interface PlaylistInspection extends PlaylistHeadSnapshot {
  title: string;
  videoCount: number;
  playlistId: string | null;
  author: string;
  platform: "YouTube" | "Bilibili";
}

export interface PlaylistFeedOptions {
  /** Optional per-subscription yt-dlp override layered on top of global config (issue #345). */
  subscriptionYtdlpConfig?: string | null;
}

/**
 * Normalize a flat-playlist entry into a canonical playable video URL
 * (design §6.3). Precedence:
 *   1. valid absolute `webpage_url`;
 *   2. valid absolute `url`;
 *   3. construct from `id` using the platform's canonical watch URL.
 *
 * Returns null only when no value can be derived. Exported so unit tests can
 * cover each branch without a network probe.
 */
export function resolveEntryVideoUrl(
  entry: { url?: string; webpage_url?: string; id?: string },
  platform: string
): string | null {
  const isValidAbsolute = (value: string | undefined): boolean => {
    if (!value) return false;
    try {
      const parsed = new URL(value);
      // A bare video id like "dQw4w9WgXcQ" is not a valid absolute URL.
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  if (isValidAbsolute(entry.webpage_url)) {
    return entry.webpage_url as string;
  }
  if (isValidAbsolute(entry.url)) {
    return entry.url as string;
  }
  if (entry.id) {
    if (platform === "Bilibili") {
      return `https://www.bilibili.com/video/${entry.id}`;
    }
    // Default to YouTube canonical watch URL. Never store a bare video ID
    // because scheduled comparisons use full URLs (design §6.3).
    return `https://www.youtube.com/watch?v=${entry.id}`;
  }
  return null;
}

function detectPlatform(playlistUrl: string): "YouTube" | "Bilibili" {
  return isBilibiliUrl(playlistUrl) ? "Bilibili" : "YouTube";
}

/**
 * Build the yt-dlp flag set for a playlist probe, applying the effective
 * per-subscription yt-dlp override on top of the global network config and the
 * provider script, exactly as the existing channel/playlist probes do.
 */
async function buildProbeFlags(
  playlistUrl: string,
  options: PlaylistFeedOptions | undefined,
  probeEnd: number | null
): Promise<Record<string, any>> {
  const { getProviderScript } = await import(
    "../downloaders/ytdlp/ytdlpHelpers"
  );
  const userConfig = getEffectiveUserYtDlpConfig(
    playlistUrl,
    options?.subscriptionYtdlpConfig ?? null
  );
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);
  const PROVIDER_SCRIPT = getProviderScript();
  return {
    ...networkConfig,
    noWarnings: true,
    flatPlaylist: true,
    ...(probeEnd !== null ? { playlistEnd: probeEnd } : {}),
    ...(PROVIDER_SCRIPT
      ? {
          extractorArgs: `youtubepot-bgfuncscript:script_path=${PROVIDER_SCRIPT}`,
        }
      : {}),
  };
}

/**
 * Lightweight head snapshot: probe only the leading entry
 * (`playlistEnd: 1`). Used by the scheduler poll, channel-playlists preflight,
 * and watcher discovery (design §6.1).
 *
 * Throws on operational failure. Returns `headVideoUrl: null` for a verified
 * empty playlist.
 */
export async function getPlaylistHeadSnapshot(
  playlistUrl: string,
  platform: string,
  options?: PlaylistFeedOptions
): Promise<PlaylistHeadSnapshot> {
  const resolvedPlatform = platform || detectPlatform(playlistUrl);
  const flags = await buildProbeFlags(playlistUrl, options, 1);

  const info = await executeYtDlpJson(playlistUrl, flags);

  // Verified empty playlist: an explicit empty entries array. Check this
  // before the non-playlist rejection so a valid `_type: "playlist"` result
  // with zero entries is treated as empty rather than an error.
  if (Array.isArray(info?.entries) && info.entries.length === 0) {
    return { headVideoUrl: null, observedAt: Date.now() };
  }

  // A playlist result must either declare itself a playlist or carry entries.
  const isPlaylistResult =
    info?._type === "playlist" ||
    (Array.isArray(info?.entries) && info.entries.length > 0);

  if (!isPlaylistResult) {
    throw new ValidationError(
      "Source is not a valid playlist",
      "playlistUrl"
    );
  }

  const firstEntry = info.entries[0];
  const headVideoUrl = resolveEntryVideoUrl(firstEntry, resolvedPlatform);
  if (!headVideoUrl) {
    // Non-empty entry that cannot be converted to a playable URL is an error,
    // not an empty playlist (design §6.4).
    throw new ValidationError(
      "Could not resolve a playable URL for the latest playlist entry",
      "playlistUrl"
    );
  }
  return { headVideoUrl, observedAt: Date.now() };
}

/**
 * Rich inspection used at direct playlist-creation time, where title, count,
 * author and id are also needed (design §6.1). Throws on failure; returns
 * `headVideoUrl: null` for a verified empty playlist.
 */
export async function inspectPlaylist(
  playlistUrl: string,
  options?: PlaylistFeedOptions
): Promise<PlaylistInspection> {
  const platform = detectPlatform(playlistUrl);
  // Full flat playlist enumeration (no playlistEnd) so the reported
  // videoCount/title reflect the whole playlist, not just the head.
  const flags = await buildProbeFlags(playlistUrl, options, null);

  const info = await executeYtDlpJson(playlistUrl, flags);

  const isPlaylistResult =
    info?._type === "playlist" || Array.isArray(info?.entries);

  if (!isPlaylistResult) {
    throw new ValidationError("Source is not a valid playlist", "playlistUrl");
  }

  const entries = Array.isArray(info?.entries) ? info.entries : [];
  const videoCount =
    (typeof info?.playlist_count === "number" && info.playlist_count) ||
    entries.length;
  const title = info?.title || info?.playlist || "Playlist";
  const playlistId =
    (info?.id && String(info.id)) || info?.playlist_id || null;

  let author = "Playlist Author";
  if (entries.length > 0) {
    const first = entries[0];
    author = first?.uploader || first?.channel || info?.uploader || info?.channel || author;
  } else if (info?.uploader || info?.channel) {
    author = info.uploader || info.channel;
  }

  let headVideoUrl: string | null = null;
  if (entries.length > 0) {
    headVideoUrl = resolveEntryVideoUrl(entries[0], platform);
    if (!headVideoUrl) {
      throw new ValidationError(
        "Could not resolve a playable URL for the latest playlist entry",
        "playlistUrl"
      );
    }
  }
  // entries.length === 0 => verified empty => headVideoUrl stays null.

  logger.info("Inspected playlist for subscription baseline", {
    platform,
    videoCount,
    baselineState: headVideoUrl ? "item" : "empty",
  });

  return {
    headVideoUrl,
    observedAt: Date.now(),
    title,
    videoCount,
    playlistId,
    author,
    platform,
  };
}
