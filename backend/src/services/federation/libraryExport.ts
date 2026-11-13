import crypto from "crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { projectAuthorAvatar, projectAuthorAvatars } from "../authorAvatarService";
import type { FederationVisibilityCeiling } from "./tokenService";

/**
 * What federation exports of one native video, shared by snapshots, detail
 * reads and asset resolution so availability always matches what is served.
 */

export type FederationAudience = FederationVisibilityCeiling;

export const isFederationAudience = (value: unknown): value is FederationAudience =>
  value === "public" || value === "owner";

/** The narrower of what the consumer asks for and what its credential allows. */
export const effectiveAudience = (
  requested: FederationAudience,
  ceiling: FederationVisibilityCeiling
): FederationAudience => (requested === "owner" && ceiling === "owner" ? "owner" : "public");

// Visibility 0 is hidden; NULL is public, as everywhere else in the library.
export const publicOnly = () => or(eq(videos.visibility, 1), isNull(videos.visibility));

export interface FederationSubtitleTrack {
  /** Opaque selector for the subtitle asset; stable while the track is. */
  trackId: string;
  language: string | null;
  format: string;
}

export interface FederationVideoSummary {
  id: string;
  title: string;
  author: string | null;
  date: string | null;
  source: string | null;
  sourceUrl: string | null;
  sourceVideoId: string | null;
  channelUrl: string | null;
  addedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  partNumber: number | null;
  totalParts: number | null;
  seriesTitle: string | null;
  rating: number | null;
  duration: string | null;
  width: number | null;
  height: number | null;
  fileSize: string | null;
  mediaType: string;
  tags: string[];
  visibility: 0 | 1;
  assets: { media: boolean; thumbnail: boolean; avatar: boolean; subtitles: boolean };
  /** Changes whenever any asset reference of the item does. */
  assetRevision: string;
}

export interface FederationVideoDetail extends FederationVideoSummary {
  description: string | null;
  subtitles: FederationSubtitleTrack[];
}

const exportColumns = () => ({
  id: videos.id,
  title: videos.title,
  author: videos.author,
  date: videos.date,
  source: videos.source,
  sourceUrl: videos.sourceUrl,
  sourceVideoId: videos.sourceVideoId,
  channelUrl: videos.channelUrl,
  addedAt: videos.addedAt,
  createdAt: videos.createdAt,
  updatedAt: videos.updatedAt,
  partNumber: videos.partNumber,
  totalParts: videos.totalParts,
  seriesTitle: videos.seriesTitle,
  rating: videos.rating,
  duration: videos.duration,
  width: videos.width,
  height: videos.height,
  fileSize: videos.fileSize,
  mediaType: videos.mediaType,
  tags: videos.tags,
  visibility: videos.visibility,
  // Read only to derive availability and revisions; never exported.
  videoPath: videos.videoPath,
  videoFilename: videos.videoFilename,
  thumbnailPath: videos.thumbnailPath,
  thumbnailUrl: videos.thumbnailUrl,
  thumbnailFilename: videos.thumbnailFilename,
  subtitles: videos.subtitles,
  authorAvatarPath: videos.authorAvatarPath,
  authorAvatarFilename: videos.authorAvatarFilename,
});

/** A row with the author's effective (override-first) avatar applied. */
export type ExportRow = ReturnType<typeof readRaw>[number] & { authorAvatarOrigin: string };

const readRaw = (ids: string[]) =>
  db.select(exportColumns()).from(videos).where(inArray(videos.id, ids)).all();

export const readExportRows = (ids: string[]): ExportRow[] =>
  ids.length > 0 ? projectAuthorAvatars(readRaw(ids)) : [];

/** One row the audience may see, or undefined: missing and hidden look alike. */
export function readExportRow(
  id: string,
  audience: FederationAudience
): (ExportRow & { description: string | null }) | undefined {
  const row = db
    .select({ ...exportColumns(), description: videos.description })
    .from(videos)
    .where(audience === "public" ? and(eq(videos.id, id), publicOnly()) : eq(videos.id, id))
    .get();
  return row ? projectAuthorAvatar(row) : undefined;
}

/** Unreadable JSON exports as empty rather than dropping the item. */
const parseArray = (value: string | null): unknown[] => {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Web-path prefixes under which each asset is served from local storage.
export const LOCAL_ASSET_PREFIXES = {
  media: ["/videos/"],
  thumbnail: ["/images/", "/videos/"],
  avatar: ["/avatars/"],
  subtitle: ["/subtitles/", "/videos/"],
} as const;

export const MOUNT_PREFIX = "mount:";

const hasPrefix = (value: string | null | undefined, prefixes: readonly string[]) =>
  typeof value === "string" && prefixes.some((prefix) => value.startsWith(prefix));

/** Media this instance can stream: managed files and mounted directories. */
export const isServableMedia = (videoPath: string | null | undefined): boolean =>
  hasPrefix(videoPath, LOCAL_ASSET_PREFIXES.media) || hasPrefix(videoPath, [MOUNT_PREFIX]);

export const isServableThumbnail = (thumbnailPath: string | null | undefined): boolean =>
  hasPrefix(thumbnailPath, LOCAL_ASSET_PREFIXES.thumbnail);

export const isServableAvatar = (avatarPath: string | null | undefined): boolean =>
  hasPrefix(avatarPath, LOCAL_ASSET_PREFIXES.avatar);

export const subtitleTrackId = (subtitlePath: string): string =>
  crypto.createHash("sha256").update(subtitlePath).digest("base64url").slice(0, 16);

const SUBTITLE_FORMAT = /\.(vtt|srt|ass|ssa)$/i;

/** Locally stored subtitle tracks, keyed by opaque track id. */
export function servableSubtitles(
  subtitles: string | null
): Array<FederationSubtitleTrack & { path: string }> {
  const tracks: Array<FederationSubtitleTrack & { path: string }> = [];
  for (const entry of parseArray(subtitles)) {
    if (!entry || typeof entry !== "object") continue;
    const { path, language } = entry as Record<string, unknown>;
    const format = typeof path === "string" ? SUBTITLE_FORMAT.exec(path)?.[1] : undefined;
    if (typeof path !== "string" || !format || !hasPrefix(path, LOCAL_ASSET_PREFIXES.subtitle)) {
      continue;
    }
    tracks.push({
      trackId: subtitleTrackId(path),
      language: typeof language === "string" ? language : null,
      format: format.toLowerCase(),
      path,
    });
  }
  return tracks;
}

export function toSummary(row: ExportRow): FederationVideoSummary {
  const assetRevision = crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        row.videoPath,
        row.videoFilename,
        row.thumbnailPath,
        row.thumbnailUrl,
        row.thumbnailFilename,
        row.subtitles,
        row.authorAvatarPath,
        row.updatedAt,
      ])
    )
    .digest("base64url")
    .slice(0, 16);

  return {
    id: row.id,
    title: row.title,
    author: row.author,
    date: row.date,
    source: row.source,
    sourceUrl: row.sourceUrl,
    sourceVideoId: row.sourceVideoId,
    channelUrl: row.channelUrl,
    addedAt: row.addedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    partNumber: row.partNumber,
    totalParts: row.totalParts,
    seriesTitle: row.seriesTitle,
    rating: row.rating,
    duration: row.duration,
    width: row.width,
    height: row.height,
    fileSize: row.fileSize,
    mediaType: row.mediaType ?? "video",
    tags: parseArray(row.tags).filter((tag): tag is string => typeof tag === "string"),
    visibility: row.visibility === 0 ? 0 : 1,
    // Only what the asset endpoint actually serves counts as available.
    assets: {
      media: isServableMedia(row.videoPath),
      thumbnail: isServableThumbnail(row.thumbnailPath),
      avatar: isServableAvatar(row.authorAvatarPath),
      subtitles: servableSubtitles(row.subtitles).length > 0,
    },
    assetRevision,
  };
}

export function toDetail(row: ExportRow & { description: string | null }): FederationVideoDetail {
  return {
    ...toSummary(row),
    description: row.description,
    subtitles: servableSubtitles(row.subtitles).map(({ path: _path, ...track }) => track),
  };
}
