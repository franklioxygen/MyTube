import type { Collection, Video } from "../storageService/types";
import {
  normalizeAuthorIdentity,
  normalizePlatform,
  resolveShowIdentity,
  type ResolvedShowIdentity,
} from "./identity";

/**
 * Normalizes raw yt-dlp / subscription / collection / video metadata into show
 * and season metadata candidates (issue #411, design §7.4).
 *
 * Pure: no database, no filesystem, no network. Precedence is applied field by
 * field — never by spreading an untrusted raw object over persisted state,
 * which would let one extractor-specific key overwrite a curated description.
 */

/**
 * Upper bound on any persisted description. Playlist and channel descriptions
 * are unbounded upstream; an NFO carrying a multi-megabyte plot would bloat
 * every rebuild and every settings payload. Full Unicode is preserved — the
 * limit is on code points, not bytes, and truncation happens at a code point
 * boundary.
 */
export const MAX_DESCRIPTION_LENGTH = 100_000;

const PLACEHOLDER_SHOW_TITLES = new Set([
  "",
  "unknown author",
  "playlist author",
  "show",
  "na",
  "n/a",
]);

const PLACEHOLDER_SEASON_TITLES = new Set(["", "playlist", "na", "n/a"]);

export const UNKNOWN_SHOW_TITLE = "Unknown Author";

/**
 * Trims, drops empty values, and bounds the length. Returns undefined rather
 * than an empty string so callers can distinguish "absent" from "explicitly
 * empty" and never clear a persisted description because a lightweight poll
 * omitted the field.
 */
export function normalizeDescription(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const codePoints = Array.from(trimmed);
  return codePoints.length <= MAX_DESCRIPTION_LENGTH
    ? trimmed
    : codePoints.slice(0, MAX_DESCRIPTION_LENGTH).join("");
}

function normalizeTitle(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || undefined;
}

function isPlaceholderShowTitle(value: string | undefined): boolean {
  return (
    value === undefined ||
    PLACEHOLDER_SHOW_TITLES.has(normalizeAuthorIdentity(value) ?? "")
  );
}

function readString(
  source: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!source) {
    return undefined;
  }
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// ---------------------------------------------------------------------------
// Raw yt-dlp metadata
// ---------------------------------------------------------------------------

export interface NormalizedSourceMetadata {
  platform?: string;
  channelId?: string;
  channelUrl?: string;
  channelName?: string;
  channelDescription?: string;
  playlistDescription?: string;
}

/**
 * Maps only the yt-dlp keys the design names. Unknown keys are ignored on
 * purpose so an extractor-specific field never becomes a schema contract.
 */
export function normalizeRawSourceMetadata(
  rawSourceInfo: unknown
): NormalizedSourceMetadata {
  const raw = asRecord(rawSourceInfo);
  if (!raw) {
    return {};
  }

  return {
    platform: readString(raw, "extractor_key") ?? readString(raw, "extractor"),
    channelId: readString(raw, "channel_id") ?? readString(raw, "uploader_id"),
    channelUrl: readString(raw, "channel_url") ?? readString(raw, "uploader_url"),
    channelName: readString(raw, "channel") ?? readString(raw, "uploader"),
    channelDescription: normalizeDescription(raw.channel_description),
    playlistDescription: normalizeDescription(raw.description),
  };
}

// ---------------------------------------------------------------------------
// Show metadata
// ---------------------------------------------------------------------------

export interface ShowMetadataCandidateInput {
  /** Already-persisted show state, when the show exists. */
  persisted?: {
    title?: string;
    description?: string;
    sourceChannelId?: string;
    sourceChannelUrl?: string;
  };
  raw?: NormalizedSourceMetadata;
  collection?: Collection;
  video?: Video;
}

export interface ShowMetadataCandidate {
  identity?: ResolvedShowIdentity;
  title: string;
  description: string;
  sourceChannelId?: string;
  sourceChannelUrl?: string;
  platform: string;
}

/**
 * Show title precedence: persisted non-placeholder title, raw channel/uploader,
 * collection channel name, video author, then the explicit unknown marker.
 *
 * Show description precedence: a non-empty raw channel description, then the
 * persisted description, then empty. A video description is never used — an
 * empty show plot is more accurate than a misleading episode plot.
 */
export function resolveShowMetadata(
  input: ShowMetadataCandidateInput
): ShowMetadataCandidate {
  const { persisted, raw, collection, video } = input;

  const persistedTitle = normalizeTitle(persisted?.title);
  const title =
    (!isPlaceholderShowTitle(persistedTitle) ? persistedTitle : undefined) ??
    normalizeTitle(raw?.channelName) ??
    normalizeTitle(collection?.sourceChannelName) ??
    normalizeTitle(video?.author) ??
    UNKNOWN_SHOW_TITLE;

  const description =
    normalizeDescription(raw?.channelDescription) ??
    normalizeDescription(persisted?.description) ??
    "";

  const sourceChannelId =
    raw?.channelId ??
    collection?.sourceChannelId ??
    persisted?.sourceChannelId ??
    undefined;

  const sourceChannelUrl =
    raw?.channelUrl ??
    collection?.sourceChannelUrl ??
    (typeof video?.channelUrl === "string" ? video.channelUrl : undefined) ??
    persisted?.sourceChannelUrl ??
    undefined;

  const platform = normalizePlatform(
    raw?.platform ??
      collection?.sourcePlatform ??
      (typeof video?.source === "string" ? video.source : undefined)
  );

  const identity = resolveShowIdentity({
    platform,
    sourceChannelId,
    sourceChannelUrl,
    authorName: title === UNKNOWN_SHOW_TITLE ? undefined : title,
  });

  return {
    identity,
    title,
    description,
    sourceChannelId,
    sourceChannelUrl,
    platform,
  };
}

// ---------------------------------------------------------------------------
// Season metadata
// ---------------------------------------------------------------------------

export interface SeasonMetadataInput {
  collection?: Collection;
  seasonNumber: number;
  /** Linked playlist subscription, when one exists. */
  subscription?: { playlistTitle?: string | null };
  /** Playlist description captured during inspection, when newer than the collection. */
  inspectedDescription?: string;
}

export interface SeasonMetadata {
  title: string;
  plot: string;
}

/**
 * Season title precedence: collection title, collection name, linked
 * subscription playlist title, then the bare `Season NN` label.
 *
 * Season description precedence: a non-empty collection description, then a
 * freshly inspected playlist description, then empty.
 */
export function resolveSeasonMetadata(
  input: SeasonMetadataInput
): SeasonMetadata {
  const { collection, seasonNumber, subscription, inspectedDescription } = input;

  const rawTitle =
    normalizeTitle(collection?.title) ??
    normalizeTitle(collection?.name) ??
    normalizeTitle(subscription?.playlistTitle ?? undefined);
  const title =
    rawTitle && !PLACEHOLDER_SEASON_TITLES.has(rawTitle.toLowerCase())
      ? rawTitle
      : `Season ${String(seasonNumber).padStart(2, "0")}`;

  const plot =
    normalizeDescription(collection?.description) ??
    normalizeDescription(inspectedDescription) ??
    "";

  return { title, plot };
}

// ---------------------------------------------------------------------------
// Metadata merge for persisted collections
// ---------------------------------------------------------------------------

export interface CollectionMetadataPatch {
  description?: string;
  sourceUrl?: string;
  sourceChannelId?: string;
  sourceChannelUrl?: string;
  sourceChannelName?: string;
}

export interface CollectionMetadataCandidate {
  description?: string;
  sourceUrl?: string;
  sourceChannelId?: string;
  sourceChannelUrl?: string;
  sourceChannelName?: string;
}

/**
 * Produces the fields that should actually be written when a playlist
 * collection is reused.
 *
 * Missing source metadata is filled in; a non-empty new description replaces an
 * older one; a persisted value is never cleared because a lightweight
 * head-only poll omitted the field. A conflicting durable channel identity is
 * reported rather than silently overwritten.
 */
export function buildCollectionMetadataPatch(
  existing: Collection | undefined,
  candidate: CollectionMetadataCandidate
): { patch: CollectionMetadataPatch; conflict?: string } {
  const patch: CollectionMetadataPatch = {};

  const description = normalizeDescription(candidate.description);
  if (description && description !== existing?.description) {
    patch.description = description;
  }

  const channelId = candidate.sourceChannelId?.trim();

  // An equal durable channel id proves this is the same channel, which is
  // exactly what a rename looks like: the handle and the display name change
  // while the id does not. Those two may then replace the persisted values
  // instead of only filling empty ones. Leaving them stale is not harmless -
  // collection metadata outranks a video's during show resolution, so the next
  // collection reconcile would write the old URL back over a show that had
  // already been refreshed, and a later URL-only video would be rejected by the
  // conflicting-URL matcher and allocate a duplicate show.
  //
  // `sourceUrl` is deliberately excluded: it identifies the playlist, not the
  // channel, so a channel id says nothing about whether it may be replaced.
  const channelIdProvenRename = Boolean(
    channelId && existing?.sourceChannelId === channelId
  );
  const refreshableFields = new Set<string>(
    channelIdProvenRename ? ["sourceChannelUrl", "sourceChannelName"] : []
  );

  const simpleFields = [
    "sourceUrl",
    "sourceChannelUrl",
    "sourceChannelName",
  ] as const;
  for (const field of simpleFields) {
    const value = candidate[field]?.trim();
    if (!value) {
      continue;
    }
    if (!existing?.[field] || refreshableFields.has(field)) {
      if (value !== existing?.[field]) {
        patch[field] = value;
      }
    }
  }

  if (channelId) {
    if (!existing?.sourceChannelId) {
      patch.sourceChannelId = channelId;
    } else if (existing.sourceChannelId !== channelId) {
      return {
        patch,
        conflict: `Collection ${existing.id} already resolves to channel ${existing.sourceChannelId}; refusing to replace it with ${channelId}.`,
      };
    }
  }

  return { patch };
}
