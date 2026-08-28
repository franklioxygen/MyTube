import crypto from "crypto";
import {
  replaceSegmentSeparators,
  sanitizeSegment,
} from "../filenameTemplate/sanitize";

/**
 * Pure identity, naming, and metadata-normalization helpers for the managed
 * playlist-TV mirror (issue #411). Nothing here touches the database or the
 * filesystem, so every rule below is directly unit-testable.
 */

export const UNKNOWN_SHOW_TITLE = "Unknown Author";
export const SEASON_ZERO_TITLE = "Specials / Unassigned";

/**
 * Upper bound for a persisted description. Keeps a pathological channel or
 * playlist description from bloating the database and the generated NFO.
 * Counted in code points so the cut never splits a surrogate pair.
 */
export const MAX_DESCRIPTION_LENGTH = 100_000;

export type ShowIdentityQuality =
  | "channel_id"
  | "channel_url"
  | "author_fallback";

export interface ShowIdentityInput {
  platform?: string | null;
  channelId?: string | null;
  channelUrl?: string | null;
  author?: string | null;
}

export interface ResolvedShowIdentity {
  identityKey: string;
  platform: string;
  quality: ShowIdentityQuality;
  channelId?: string;
  /** Normalized, comparable form of the source channel URL. */
  channelUrl?: string;
  /** Normalized, comparable form of the author/channel display name. */
  authorKey?: string;
}

const PLATFORM_ALIASES: Record<string, string> = {
  yt: "youtube",
  "youtube.com": "youtube",
  bili: "bilibili",
  "bilibili.com": "bilibili",
};

export function normalizePlatform(value: string | null | undefined): string {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) {
    return "unknown";
  }
  return PLATFORM_ALIASES[trimmed] || trimmed;
}

/**
 * Normalize a channel URL so trivially different spellings of the same channel
 * collapse onto one identity. The path case is preserved: YouTube channel ids
 * are case sensitive, so lowercasing it would merge distinct channels.
 */
export function normalizeChannelUrl(
  value: string | null | undefined
): string | undefined {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }

  const host = parsed.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${host}${pathname}`;
}

export function normalizeAuthorIdentity(
  value: string | null | undefined
): string | undefined {
  const normalized = (value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Resolve the strongest available identity for a show. Returns null when the
 * input carries no usable channel id, channel URL, or author name.
 */
export function resolveShowIdentity(
  input: ShowIdentityInput
): ResolvedShowIdentity | null {
  const platform = normalizePlatform(input.platform);
  const channelId = (input.channelId || "").trim() || undefined;
  const channelUrl = normalizeChannelUrl(input.channelUrl);
  const authorKey = normalizeAuthorIdentity(input.author);
  const shared = { platform, channelId, channelUrl, authorKey };

  if (channelId) {
    return {
      ...shared,
      identityKey: `${platform}:channel-id:${channelId}`,
      quality: "channel_id",
    };
  }
  if (channelUrl) {
    return {
      ...shared,
      identityKey: `${platform}:channel-url:${channelUrl}`,
      quality: "channel_url",
    };
  }
  if (authorKey) {
    return {
      ...shared,
      identityKey: `${platform}:author:${authorKey}`,
      quality: "author_fallback",
    };
  }
  return null;
}

const IDENTITY_QUALITY_RANK: Record<ShowIdentityQuality, number> = {
  channel_id: 3,
  channel_url: 2,
  author_fallback: 1,
};

export function getIdentityKeyQuality(
  identityKey: string
): ShowIdentityQuality {
  if (identityKey.includes(":channel-id:")) {
    return "channel_id";
  }
  if (identityKey.includes(":channel-url:")) {
    return "channel_url";
  }
  return "author_fallback";
}

export function isStrongerIdentity(
  candidate: ShowIdentityQuality,
  current: ShowIdentityQuality
): boolean {
  return IDENTITY_QUALITY_RANK[candidate] > IDENTITY_QUALITY_RANK[current];
}

/**
 * Sanitize one mirror path segment. `sanitizeSegment()` alone is not enough:
 * the filename-template pipeline calls `replaceSegmentSeparators()` first, so
 * without it a title containing a slash would introduce an extra directory
 * level. Leading dots are dropped so a title can never produce a hidden entry
 * or a traversal component.
 */
export function sanitizeMirrorSegment(value: string): string {
  return sanitizeSegment(replaceSegmentSeparators(value)).replace(/^\.+/, "").trim();
}

function padSeasonNumber(seasonNumber: number): string {
  return String(seasonNumber).padStart(2, "0");
}

function padEpisodeNumber(episodeNumber: number): string {
  return String(episodeNumber).padStart(3, "0");
}

export function buildSeasonDirectoryName(seasonNumber: number): string {
  return `Season ${padSeasonNumber(seasonNumber)}`;
}

function buildEpisodeToken(
  seasonNumber: number,
  episodeNumber: number
): string {
  return `S${padSeasonNumber(seasonNumber)}E${padEpisodeNumber(episodeNumber)}`;
}

/**
 * Build the persisted filename stem for one occurrence. The `SxxExxx` token is
 * authoritative for media servers that ignore `season.nfo`, so it always leads.
 */
export function buildExportStem(
  seasonNumber: number,
  episodeNumber: number,
  title: string
): string {
  const token = buildEpisodeToken(seasonNumber, episodeNumber);
  const sanitizedTitle = sanitizeMirrorSegment(title);
  return sanitizedTitle
    ? sanitizeMirrorSegment(`${token} - ${sanitizedTitle}`)
    : token;
}

/**
 * Allocate a collision-free show directory name. The suffix is derived from the
 * identity key rather than a counter so the same show always lands on the same
 * directory, whatever order shows are created in.
 */
export function buildShowDirectoryName(
  title: string,
  identityKey: string,
  isTaken: (candidate: string) => boolean
): string {
  const base = sanitizeMirrorSegment(title) || UNKNOWN_SHOW_TITLE;
  if (!isTaken(base)) {
    return base;
  }

  const digest = crypto.createHash("sha1").update(identityKey).digest("hex");
  for (const length of [8, 16, 40]) {
    const candidate = `${base} (${digest.slice(0, length)})`;
    if (!isTaken(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not allocate a unique media-server directory name for "${base}".`
  );
}

export function normalizeDescription(
  value: string | null | undefined
): string {
  const codePoints = Array.from((value || "").trim());
  return codePoints.length <= MAX_DESCRIPTION_LENGTH
    ? codePoints.join("")
    : codePoints.slice(0, MAX_DESCRIPTION_LENGTH).join("");
}

export interface RawChannelMetadata {
  channelId?: string;
  channelUrl?: string;
  channelName?: string;
  channelDescription?: string;
}

function readRawString(
  raw: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Map the documented yt-dlp channel keys out of a raw info object. Only these
 * keys are read: an extractor-specific field must not silently become part of
 * the persisted show contract.
 */
export function extractRawChannelMetadata(
  rawSourceInfo: unknown
): RawChannelMetadata {
  if (
    typeof rawSourceInfo !== "object" ||
    rawSourceInfo === null ||
    Array.isArray(rawSourceInfo)
  ) {
    return {};
  }

  const raw = rawSourceInfo as Record<string, unknown>;
  return {
    channelId: readRawString(raw, "channel_id", "uploader_id"),
    channelUrl: readRawString(raw, "channel_url", "uploader_url"),
    channelName: readRawString(raw, "channel", "uploader"),
    channelDescription: readRawString(raw, "channel_description"),
  };
}
