import { eq } from "drizzle-orm";
import { db } from "../../db";
import { videoDownloads, videos } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { extractSourceVideoId } from "../../utils/helpers";
import { logger } from "../../utils/logger";
import type { MediaIdentity } from "../filenameTemplate/outputPathAllocator";
import type { MediaType, Video } from "./types";
import { normalizeMediaType } from "./types";
import { bumpVideosListRevision } from "./videoListRevision";
import { SaveVideoOptions, emitLibraryVideoAdded } from "./videoMutations";

export type DownloadedMediaTrackingMode =
  | "new"
  | "redownload"
  | "multipart_part";

export interface PersistDownloadedMediaInput {
  video: Video;
  identity: MediaIdentity;
  sourceUrl: string;
  trackingMode: DownloadedMediaTrackingMode;
  downloadedAtMs?: number;
}

type RepresentativeCandidate = {
  id: string;
  source: string | null;
  mediaType: string | null;
  partNumber: number | null;
  createdAt: string;
};

function normalizePlatform(value: string | null | undefined): string {
  return value ? value.toLocaleLowerCase() : "unknown";
}

function getDownloadedAtMs(video: Video, explicitDownloadedAtMs?: number): number {
  if (typeof explicitDownloadedAtMs === "number" && Number.isFinite(explicitDownloadedAtMs)) {
    return Math.trunc(explicitDownloadedAtMs);
  }

  for (const value of [video.addedAt, video.createdAt]) {
    const parsed = typeof value === "string" ? Date.parse(value) : NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

function serializeVideo(video: Video): typeof videos.$inferInsert {
  return {
    ...video,
    tags: video.tags ? JSON.stringify(video.tags) : undefined,
    subtitles: video.subtitles ? JSON.stringify(video.subtitles) : undefined,
  } as typeof videos.$inferInsert;
}

function validateIdentity(input: PersistDownloadedMediaInput): {
  sourceVideoId: string;
  platform: string;
  mediaType: MediaType;
} {
  const sourceVideoId = input.identity.sourceVideoId || input.video.sourceVideoId;
  if (!sourceVideoId) {
    throw new Error("Downloaded media identity requires sourceVideoId");
  }

  if (
    input.video.sourceVideoId &&
    input.video.sourceVideoId !== sourceVideoId
  ) {
    throw new Error(
      `Video sourceVideoId ${input.video.sourceVideoId} does not match identity ${sourceVideoId}`
    );
  }

  const derived = extractSourceVideoId(input.sourceUrl);
  if (derived.id && derived.id !== sourceVideoId) {
    throw new Error(
      `Source URL identity ${derived.id} does not match persisted identity ${sourceVideoId}`
    );
  }

  const platform = normalizePlatform(input.identity.platform || derived.platform);
  const mediaType = normalizeMediaType(input.identity.mediaType || input.video.mediaType);
  const videoMediaType = normalizeMediaType(input.video.mediaType);
  if (videoMediaType !== mediaType) {
    throw new Error(
      `Video media type ${videoMediaType} does not match identity ${mediaType}`
    );
  }

  if (
    input.identity.partNumber !== undefined &&
    input.identity.partNumber !== null &&
    input.video.partNumber !== undefined &&
    input.video.partNumber !== null &&
    Number(input.video.partNumber) !== Number(input.identity.partNumber)
  ) {
    throw new Error(
      `Video part ${input.video.partNumber} does not match identity part ${input.identity.partNumber}`
    );
  }

  return { sourceVideoId, platform, mediaType };
}

function partRank(value: number | null): number {
  return typeof value === "number" && value > 0 ? value : 0;
}

/**
 * Picks the library row that should own the source-level tracking record: the
 * lowest-numbered surviving part, tie-broken by creation time then id. Returns
 * null when the source has no remaining rows.
 *
 * `excludeVideoId` lets deletion ask for the successor while the row being
 * removed is still present in `videos` — deleteVideo marks tracking before it
 * deletes the row. Selection lives here so deletion and persistence cannot drift
 * apart on which part represents a multipart source.
 */
export function selectTrackingRepresentative(
  sourceVideoId: string,
  platform: string,
  mediaType: MediaType,
  excludeVideoId?: string
): string | null {
  const rows = db
    .select({
      id: videos.id,
      source: videos.source,
      mediaType: videos.mediaType,
      partNumber: videos.partNumber,
      createdAt: videos.createdAt,
    })
    .from(videos)
    .where(eq(videos.sourceVideoId, sourceVideoId))
    .all() as RepresentativeCandidate[];

  const candidates = rows.filter((row) => {
    if (excludeVideoId && row.id === excludeVideoId) {
      return false;
    }
    const rowMediaType = normalizeMediaType(row.mediaType);
    const rowPlatform = normalizePlatform(row.source);
    return (
      rowMediaType === mediaType &&
      (rowPlatform === platform || rowPlatform === "unknown")
    );
  });

  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .slice()
    .sort((left, right) => {
      const partDelta = partRank(left.partNumber) - partRank(right.partNumber);
      if (partDelta !== 0) return partDelta;
      const createdDelta = left.createdAt.localeCompare(right.createdAt);
      if (createdDelta !== 0) return createdDelta;
      return left.id.localeCompare(right.id);
    })[0].id;
}

function chooseTrackingRepresentative(
  sourceVideoId: string,
  platform: string,
  mediaType: MediaType,
  fallbackVideoId: string
): string {
  return (
    selectTrackingRepresentative(sourceVideoId, platform, mediaType) ??
    fallbackVideoId
  );
}

/**
 * Persist the per-row media identity and the source-level download tracking row
 * together. The tracking row is keyed by (sourceVideoId, platform, mediaType);
 * for multipart media it points at the lowest surviving part row.
 */
export function persistDownloadedMediaIdentity(
  input: PersistDownloadedMediaInput,
  options: SaveVideoOptions = {}
): Video {
  try {
    const { sourceVideoId, platform, mediaType } = validateIdentity(input);
    const normalizedVideo: Video = {
      ...input.video,
      sourceVideoId,
      mediaType,
    };
    const videoToSave = serializeVideo(normalizedVideo);
    const downloadedAt = getDownloadedAtMs(normalizedVideo, input.downloadedAtMs);
    let inserted = false;

    db.transaction(() => {
      const existing = db
        .select({ id: videos.id })
        .from(videos)
        .where(eq(videos.id, normalizedVideo.id))
        .all();
      inserted = existing.length === 0;

      db.insert(videos)
        .values(videoToSave)
        .onConflictDoUpdate({
          target: videos.id,
          set: videoToSave,
        })
        .run();

      const representativeVideoId = chooseTrackingRepresentative(
        sourceVideoId,
        platform,
        mediaType,
        normalizedVideo.id
      );
      const deterministicId =
        mediaType === "video"
          ? `${platform}:${sourceVideoId}`
          : `${platform}:${sourceVideoId}:${mediaType}`;

      db.insert(videoDownloads)
        .values({
          id: deterministicId,
          sourceVideoId,
          sourceUrl: input.sourceUrl,
          platform,
          mediaType,
          videoId: representativeVideoId,
          title: normalizedVideo.title,
          author: normalizedVideo.author,
          status: "exists",
          downloadedAt,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: [
            videoDownloads.sourceVideoId,
            videoDownloads.platform,
            videoDownloads.mediaType,
          ],
          set: {
            sourceUrl: input.sourceUrl,
            videoId: representativeVideoId,
            title: normalizedVideo.title,
            author: normalizedVideo.author,
            status: "exists",
            deletedAt: null,
          },
        })
        .run();
    });

    bumpVideosListRevision();
    if (inserted && !options.suppressStatistics) {
      emitLibraryVideoAdded(normalizedVideo, options.statisticsReason ?? "download");
    }

    logger.info(
      `Persisted ${mediaType} identity for ${normalizedVideo.title || sourceVideoId} (${platform})`
    );
    return normalizedVideo;
  } catch (error) {
    logger.error(
      "Error persisting downloaded media identity",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to persist downloaded media identity: ${input.video.id}`,
      error instanceof Error ? error : new Error(String(error)),
      "persistDownloadedMediaIdentity"
    );
  }
}
