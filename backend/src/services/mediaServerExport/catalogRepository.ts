import { createHash } from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  collections,
  mediaServerEpisodeAssignments,
  mediaServerShows,
} from "../../db/schema";
import { logger } from "../../utils/logger";
import {
  buildCollectionShowIdentityKey,
  COLLECTION_SHOW_PLATFORM,
} from "./identity";
import {
  buildExportStem,
  getSeasonZeroTitle,
  padEpisodeNumber,
  padSeasonNumber,
  sanitizeMirrorSegment,
} from "./naming";
import type {
  MediaServerEpisodeAssignment,
  MediaServerShow,
} from "../storageService/types";

/**
 * Durable catalog for the playlist-TV media-server layout (issue #411).
 *
 * Everything here is allocation state: once a show directory name, a season
 * number or an episode number is written it is never recomputed from a display
 * title or an upstream sort order. Planners read this catalog; they never derive
 * numbers from paths.
 *
 * All allocating writes run inside a single SQLite transaction so two concurrent
 * subscription/task completions cannot receive the same season or episode.
 */

/** A uniqueness race is retried this many times before a typed failure. */
const ALLOCATION_RETRY_LIMIT = 3;

// Re-exported so existing callers keep one import site for catalog concerns.
export {
  buildExportStem,
  getSeasonZeroTitle,
  padEpisodeNumber,
  padSeasonNumber,
  sanitizeMirrorSegment,
};

export class MediaServerCatalogError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MediaServerCatalogError";
    this.code = code;
  }
}

type ShowRow = typeof mediaServerShows.$inferSelect;
type AssignmentRow = typeof mediaServerEpisodeAssignments.$inferSelect;

function toShow(row: ShowRow): MediaServerShow {
  return {
    id: row.id,
    identityKey: row.identityKey,
    sourcePlatform: row.sourcePlatform,
    sourceChannelId: row.sourceChannelId ?? undefined,
    sourceChannelUrl: row.sourceChannelUrl ?? undefined,
    title: row.title,
    description: row.description,
    posterSourcePath: row.posterSourcePath ?? undefined,
    directoryName: row.directoryName,
    nextSeasonNumber: row.nextSeasonNumber,
    sourceCollectionId: row.sourceCollectionId ?? undefined,
    tmdbId: row.tmdbId ?? undefined,
    tmdbMediaType:
      row.tmdbMediaType === "tv" || row.tmdbMediaType === "movie"
        ? row.tmdbMediaType
        : undefined,
    premiered: row.premiered ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAssignment(row: AssignmentRow): MediaServerEpisodeAssignment {
  return {
    id: row.id,
    showId: row.showId,
    collectionId: row.collectionId ?? undefined,
    videoId: row.videoId,
    seasonNumber: row.seasonNumber,
    episodeNumber: row.episodeNumber,
    sourcePosition: row.sourcePosition ?? undefined,
    exportStem: row.exportStem,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE constraint failed");
}

/**
 * Runs an allocating transaction, retrying a bounded number of times when a
 * concurrent writer wins the unique index. Never swallows the failure: an
 * exhausted retry budget raises a typed error the job layer can report.
 */
function runAllocation<T>(operation: string, work: () => T): T {
  let lastError: unknown;

  for (let attempt = 1; attempt <= ALLOCATION_RETRY_LIMIT; attempt += 1) {
    try {
      return db.transaction(work);
    } catch (error) {
      lastError = error;
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      logger.warn("Media server catalog allocation raced, retrying", {
        operation,
        attempt,
      });
    }
  }

  throw new MediaServerCatalogError(
    "allocation_conflict",
    `Media server catalog allocation "${operation}" lost ${ALLOCATION_RETRY_LIMIT} uniqueness races: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}


// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function listMediaServerShows(): MediaServerShow[] {
  return db.select().from(mediaServerShows).all().map(toShow);
}

export function getMediaServerShowById(
  id: string
): MediaServerShow | undefined {
  const row = db
    .select()
    .from(mediaServerShows)
    .where(eq(mediaServerShows.id, id))
    .get();
  return row ? toShow(row) : undefined;
}

export function getMediaServerShowByIdentityKey(
  identityKey: string
): MediaServerShow | undefined {
  const row = db
    .select()
    .from(mediaServerShows)
    .where(eq(mediaServerShows.identityKey, identityKey))
    .get();
  return row ? toShow(row) : undefined;
}

export function listMediaServerEpisodeAssignments(): MediaServerEpisodeAssignment[] {
  return db
    .select()
    .from(mediaServerEpisodeAssignments)
    .all()
    .map(toAssignment);
}

export function listAssignmentsForShow(
  showId: string
): MediaServerEpisodeAssignment[] {
  return db
    .select()
    .from(mediaServerEpisodeAssignments)
    .where(eq(mediaServerEpisodeAssignments.showId, showId))
    .all()
    .map(toAssignment);
}

export function listAssignmentsForVideo(
  videoId: string
): MediaServerEpisodeAssignment[] {
  return db
    .select()
    .from(mediaServerEpisodeAssignments)
    .where(eq(mediaServerEpisodeAssignments.videoId, videoId))
    .all()
    .map(toAssignment);
}

export function listAssignmentsForCollection(
  collectionId: string
): MediaServerEpisodeAssignment[] {
  return db
    .select()
    .from(mediaServerEpisodeAssignments)
    .where(eq(mediaServerEpisodeAssignments.collectionId, collectionId))
    .all()
    .map(toAssignment);
}

export function getEpisodeAssignmentOccurrence(
  showId: string,
  seasonNumber: number,
  videoId: string
): MediaServerEpisodeAssignment | undefined {
  const row = db
    .select()
    .from(mediaServerEpisodeAssignments)
    .where(
      and(
        eq(mediaServerEpisodeAssignments.showId, showId),
        eq(mediaServerEpisodeAssignments.seasonNumber, seasonNumber),
        eq(mediaServerEpisodeAssignments.videoId, videoId)
      )
    )
    .get();
  return row ? toAssignment(row) : undefined;
}

/**
 * Playlist (positive-season) assignments for a video. Used to decide whether a
 * Season 00 occurrence is still needed.
 */
export function listPlaylistAssignmentsForVideo(
  videoId: string
): MediaServerEpisodeAssignment[] {
  return listAssignmentsForVideo(videoId).filter(
    (assignment) => assignment.collectionId !== undefined
  );
}

export function getSeasonZeroAssignmentForVideo(
  showId: string,
  videoId: string
): MediaServerEpisodeAssignment | undefined {
  const row = db
    .select()
    .from(mediaServerEpisodeAssignments)
    .where(
      and(
        eq(mediaServerEpisodeAssignments.showId, showId),
        eq(mediaServerEpisodeAssignments.videoId, videoId),
        eq(mediaServerEpisodeAssignments.seasonNumber, 0),
        isNull(mediaServerEpisodeAssignments.collectionId)
      )
    )
    .get();
  return row ? toAssignment(row) : undefined;
}

// ---------------------------------------------------------------------------
// Show allocation
// ---------------------------------------------------------------------------

export interface CreateMediaServerShowInput {
  identityKey: string;
  sourcePlatform: string;
  sourceChannelId?: string;
  sourceChannelUrl?: string;
  title: string;
  description?: string;
  posterSourcePath?: string;
}

function shortIdentitySuffix(input: CreateMediaServerShowInput): string {
  if (input.sourceChannelId) {
    const safe = sanitizeMirrorSegment(input.sourceChannelId).replace(/\s+/g, "");
    if (safe) {
      return safe.slice(-8);
    }
  }
  return createHash("sha256").update(input.identityKey).digest("hex").slice(0, 8);
}

/**
 * Allocates a collision-free directory name inside the open transaction. The
 * unique index on directory_name is the real guard; this only picks a candidate.
 */
function allocateDirectoryName(input: CreateMediaServerShowInput): string {
  const base = sanitizeMirrorSegment(input.title || "") || "Unknown Author";
  const taken = (candidate: string): boolean =>
    Boolean(
      db
        .select({ id: mediaServerShows.id })
        .from(mediaServerShows)
        .where(eq(mediaServerShows.directoryName, candidate))
        .get()
    );

  if (!taken(base)) {
    return base;
  }

  const suffixed = sanitizeMirrorSegment(`${base} (${shortIdentitySuffix(input)})`);
  if (!taken(suffixed)) {
    return suffixed;
  }

  throw new MediaServerCatalogError(
    "unresolved_show_identity",
    `Could not allocate a unique show directory for "${input.title}".`
  );
}

/**
 * Resolves the show for an identity key, creating it on first sight. The
 * directory name is allocated exactly once here and is never revisited by an
 * ordinary rebuild.
 */
export function ensureMediaServerShow(
  input: CreateMediaServerShowInput
): MediaServerShow {
  const existing = getMediaServerShowByIdentityKey(input.identityKey);
  if (existing) {
    return existing;
  }

  return runAllocation("ensureMediaServerShow", () => {
    const raced = db
      .select()
      .from(mediaServerShows)
      .where(eq(mediaServerShows.identityKey, input.identityKey))
      .get();
    if (raced) {
      return toShow(raced);
    }

    const now = Date.now();
    const row: ShowRow = {
      id: `mss_${createHash("sha256")
        .update(input.identityKey)
        .digest("hex")
        .slice(0, 24)}`,
      identityKey: input.identityKey,
      sourcePlatform: input.sourcePlatform,
      sourceChannelId: input.sourceChannelId ?? null,
      sourceChannelUrl: input.sourceChannelUrl ?? null,
      title: input.title || "Unknown Author",
      description: input.description ?? "",
      posterSourcePath: input.posterSourcePath ?? null,
      directoryName: allocateDirectoryName(input),
      nextSeasonNumber: 1,
      // Author shows never carry a collection identity; ensureCollectionShow()
      // is the only path that sets these.
      sourceCollectionId: null,
      tmdbId: null,
      tmdbMediaType: null,
      premiered: null,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(mediaServerShows).values(row).run();
    logger.info("Created media server show", {
      layout: "playlist_tv",
      action: "reconcile",
      showId: row.id,
      directoryName: row.directoryName,
    });
    return toShow(row);
  });
}

export interface EnsureCollectionShowInput {
  collectionId: string;
  /** Already-resolved display title — TMDB, manual, or the collection's own. */
  title: string;
  description?: string;
  posterSourcePath?: string;
  tmdbId?: number;
  tmdbMediaType?: "tv" | "movie";
  premiered?: string;
}

/**
 * Resolves the show for a marked collection, creating it on first activation.
 *
 * Kept separate from `ensureMediaServerShow()` on purpose: that path runs the
 * author compatibility matcher, which would happily merge two collection-shows
 * that share a title. A collection-show is keyed on its collection id alone.
 *
 * Like an author show, the directory name is allocated exactly once. A later
 * metadata change updates the NFO, never the folder.
 */
export function ensureCollectionShow(
  input: EnsureCollectionShowInput
): MediaServerShow {
  const identityKey = buildCollectionShowIdentityKey(input.collectionId);
  const existing = getMediaServerShowByIdentityKey(identityKey);
  if (existing) {
    // The external identity is refreshed, not just the display metadata. A user
    // can re-point a collection at a different TMDB entry, or drop back to a
    // manual title; leaving the old tmdbId behind would emit the new title with
    // the old uniqueid and let the media server keep matching the wrong series.
    // Nulls are written through deliberately, so clearing is possible.
    updateCollectionShowIdentity(existing.id, {
      tmdbId: input.tmdbId ?? null,
      tmdbMediaType: input.tmdbMediaType ?? null,
      premiered: input.premiered ?? null,
    });

    return (
      updateMediaServerShowMetadata(existing.id, {
        title: input.title,
        description: input.description ?? "",
        posterSourcePath: input.posterSourcePath ?? null,
      }) ?? { ...existing }
    );
  }

  return runAllocation("ensureCollectionShow", () => {
    const raced = db
      .select()
      .from(mediaServerShows)
      .where(eq(mediaServerShows.identityKey, identityKey))
      .get();
    if (raced) {
      return toShow(raced);
    }

    const now = Date.now();
    const row: ShowRow = {
      id: `msc_${createHash("sha256")
        .update(identityKey)
        .digest("hex")
        .slice(0, 24)}`,
      identityKey,
      sourcePlatform: COLLECTION_SHOW_PLATFORM,
      sourceChannelId: null,
      sourceChannelUrl: null,
      title: input.title,
      description: input.description ?? "",
      posterSourcePath: input.posterSourcePath ?? null,
      directoryName: allocateDirectoryName({
        identityKey,
        sourcePlatform: COLLECTION_SHOW_PLATFORM,
        title: input.title,
      }),
      // A collection-show holds exactly one season; the counter exists only to
      // satisfy the shared schema.
      nextSeasonNumber: 2,
      sourceCollectionId: input.collectionId,
      tmdbId: input.tmdbId ?? null,
      tmdbMediaType: input.tmdbMediaType ?? null,
      premiered: input.premiered ?? null,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(mediaServerShows).values(row).run();
    logger.info("Created media server show from a collection", {
      layout: "playlist_tv",
      action: "reconcile",
      showId: row.id,
      collectionId: input.collectionId,
      directoryName: row.directoryName,
    });
    return toShow(row);
  });
}

/** Updates the offline TMDB projection on an existing collection-show. */
export function updateCollectionShowIdentity(
  showId: string,
  patch: {
    tmdbId?: number | null;
    tmdbMediaType?: "tv" | "movie" | null;
    premiered?: string | null;
  }
): void {
  db.update(mediaServerShows)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(mediaServerShows.id, showId))
    .run();
}

export function getCollectionShow(
  collectionId: string
): MediaServerShow | undefined {
  return getMediaServerShowByIdentityKey(
    buildCollectionShowIdentityKey(collectionId)
  );
}

export interface MediaServerShowMetadataPatch {
  title?: string;
  description?: string;
  posterSourcePath?: string | null;
  sourceChannelId?: string;
  sourceChannelUrl?: string;
}

/**
 * Applies resolved metadata. Identity, directory name and the season allocator
 * are never touched here. A `sourceChannelId` upgrade is only applied to a show
 * that does not have one yet — this is how an author-fallback identity is
 * enriched without ever merging two existing shows.
 */
export function updateMediaServerShowMetadata(
  showId: string,
  patch: MediaServerShowMetadataPatch
): MediaServerShow | undefined {
  const current = getMediaServerShowById(showId);
  if (!current) {
    return undefined;
  }

  const next: Partial<ShowRow> = { updatedAt: Date.now() };
  if (patch.title !== undefined && patch.title !== current.title) {
    next.title = patch.title;
  }
  if (
    patch.description !== undefined &&
    patch.description !== current.description
  ) {
    next.description = patch.description;
  }
  if (patch.posterSourcePath !== undefined) {
    next.posterSourcePath = patch.posterSourcePath;
  }
  if (patch.sourceChannelId !== undefined && !current.sourceChannelId) {
    next.sourceChannelId = patch.sourceChannelId;
  }
  if (patch.sourceChannelUrl !== undefined && !current.sourceChannelUrl) {
    next.sourceChannelUrl = patch.sourceChannelUrl;
  }

  db.update(mediaServerShows)
    .set(next)
    .where(eq(mediaServerShows.id, showId))
    .run();

  return getMediaServerShowById(showId);
}

// ---------------------------------------------------------------------------
// Season allocation
// ---------------------------------------------------------------------------

export interface SeasonAttachment {
  collectionId: string;
  showId: string;
  seasonNumber: number;
}

/**
 * Attaches a source-backed playlist collection to a show and allocates its
 * season number on first attachment.
 *
 * The number comes from the show's monotonic `nextSeasonNumber`, read and
 * incremented in the same transaction. It is never reused after a season is
 * deleted and never renumbered because a playlist was renamed or discovered in
 * a different order.
 */
export function attachCollectionToShow(
  collectionId: string,
  showId: string
): SeasonAttachment {
  return runAllocation("attachCollectionToShow", () => {
    const collectionRow = db
      .select({
        id: collections.id,
        mediaServerShowId: collections.mediaServerShowId,
        mediaServerSeasonNumber: collections.mediaServerSeasonNumber,
      })
      .from(collections)
      .where(eq(collections.id, collectionId))
      .get();

    if (!collectionRow) {
      throw new MediaServerCatalogError(
        "invalid_catalog_assignment",
        `Collection ${collectionId} does not exist.`
      );
    }

    if (
      collectionRow.mediaServerShowId &&
      collectionRow.mediaServerSeasonNumber != null
    ) {
      if (collectionRow.mediaServerShowId !== showId) {
        throw new MediaServerCatalogError(
          "ambiguous_collection_show",
          `Collection ${collectionId} is already attached to show ${collectionRow.mediaServerShowId}.`
        );
      }
      return {
        collectionId,
        showId,
        seasonNumber: collectionRow.mediaServerSeasonNumber,
      };
    }

    const showRow = db
      .select({ nextSeasonNumber: mediaServerShows.nextSeasonNumber })
      .from(mediaServerShows)
      .where(eq(mediaServerShows.id, showId))
      .get();

    if (!showRow) {
      throw new MediaServerCatalogError(
        "unresolved_show_identity",
        `Show ${showId} does not exist.`
      );
    }

    const seasonNumber = showRow.nextSeasonNumber;

    db.update(mediaServerShows)
      .set({ nextSeasonNumber: seasonNumber + 1, updatedAt: Date.now() })
      .where(eq(mediaServerShows.id, showId))
      .run();

    db.update(collections)
      .set({
        mediaServerShowId: showId,
        mediaServerSeasonNumber: seasonNumber,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(collections.id, collectionId))
      .run();

    logger.info("Allocated media server season", {
      layout: "playlist_tv",
      action: "reconcile",
      showId,
      collectionId,
      seasonNumber,
    });

    return { collectionId, showId, seasonNumber };
  });
}

/**
 * Clears a collection's season attachment. The show's `nextSeasonNumber` is
 * deliberately left untouched so the number is never handed to another playlist.
 */
export function detachCollectionFromShow(collectionId: string): void {
  db.update(collections)
    .set({
      mediaServerShowId: null,
      mediaServerSeasonNumber: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(collections.id, collectionId))
    .run();
}

// ---------------------------------------------------------------------------
// Episode allocation
// ---------------------------------------------------------------------------

export interface AllocateEpisodeAssignmentInput {
  showId: string;
  /** Null/undefined for a Season 00 (unassigned) occurrence. */
  collectionId?: string;
  videoId: string;
  seasonNumber: number;
  videoTitle: string;
  /** Upstream playlist position observed at import, 1-based. */
  sourcePosition?: number;
  /**
   * Exact numbering carried over from an assignment being replaced, used when a
   * collection is promoted from an author season to its own show.
   *
   * Reusing the number and stem is what keeps mirror filenames stable across the
   * move, so a media server does not see every episode disappear and reappear
   * under a new name. This is not a violation of immutable numbering: that rule
   * forbids renumbering *within* a season on reorder, not carrying numbers
   * across an explicit, user-initiated move.
   */
  carryOver?: {
    episodeNumber: number;
    exportStem: string;
    sourcePosition?: number;
  };
}

function assertValidAssignmentInput(
  input: AllocateEpisodeAssignmentInput
): void {
  if (!Number.isInteger(input.seasonNumber) || input.seasonNumber < 0) {
    throw new MediaServerCatalogError(
      "invalid_catalog_assignment",
      `Season number must be a non-negative integer, received ${input.seasonNumber}.`
    );
  }
  if (input.seasonNumber === 0 && input.collectionId) {
    throw new MediaServerCatalogError(
      "invalid_catalog_assignment",
      "Season 00 assignments must not reference a collection."
    );
  }
  if (input.seasonNumber > 0 && !input.collectionId) {
    throw new MediaServerCatalogError(
      "invalid_catalog_assignment",
      "Playlist season assignments require a collection."
    );
  }
}

function isEpisodeNumberFree(
  showId: string,
  seasonNumber: number,
  episodeNumber: number
): boolean {
  return !db
    .select({ id: mediaServerEpisodeAssignments.id })
    .from(mediaServerEpisodeAssignments)
    .where(
      and(
        eq(mediaServerEpisodeAssignments.showId, showId),
        eq(mediaServerEpisodeAssignments.seasonNumber, seasonNumber),
        eq(mediaServerEpisodeAssignments.episodeNumber, episodeNumber)
      )
    )
    .get();
}

function nextEpisodeNumber(showId: string, seasonNumber: number): number {
  const row = db
    .select({
      maxEpisode: sql<number | null>`MAX(${mediaServerEpisodeAssignments.episodeNumber})`,
    })
    .from(mediaServerEpisodeAssignments)
    .where(
      and(
        eq(mediaServerEpisodeAssignments.showId, showId),
        eq(mediaServerEpisodeAssignments.seasonNumber, seasonNumber)
      )
    )
    .get();

  return (row?.maxEpisode ?? 0) + 1;
}

/**
 * Creates the occurrence if it does not exist, otherwise refreshes only its
 * diagnostic `sourcePosition`.
 *
 * The episode number prefers the position observed at first import when that
 * number is still free, and otherwise takes MAX+1. Once written it is immutable:
 * an upstream playlist reorder updates `sourcePosition` and nothing else.
 */
export function ensureEpisodeAssignment(
  input: AllocateEpisodeAssignmentInput
): MediaServerEpisodeAssignment {
  assertValidAssignmentInput(input);

  return runAllocation("ensureEpisodeAssignment", () => {
    const existing = db
      .select()
      .from(mediaServerEpisodeAssignments)
      .where(
        and(
          eq(mediaServerEpisodeAssignments.showId, input.showId),
          eq(mediaServerEpisodeAssignments.seasonNumber, input.seasonNumber),
          eq(mediaServerEpisodeAssignments.videoId, input.videoId)
        )
      )
      .get();

    if (existing) {
      if (
        input.sourcePosition !== undefined &&
        input.sourcePosition !== existing.sourcePosition
      ) {
        if (
          existing.sourcePosition != null &&
          input.sourcePosition !== existing.episodeNumber
        ) {
          logger.warn("Upstream playlist order differs from stable episode order", {
            layout: "playlist_tv",
            action: "reconcile",
            showId: input.showId,
            collectionId: input.collectionId,
            assignmentId: existing.id,
            videoId: input.videoId,
          });
        }
        db.update(mediaServerEpisodeAssignments)
          .set({ sourcePosition: input.sourcePosition, updatedAt: Date.now() })
          .where(eq(mediaServerEpisodeAssignments.id, existing.id))
          .run();
        return toAssignment({
          ...existing,
          sourcePosition: input.sourcePosition,
        });
      }
      return toAssignment(existing);
    }

    const carriedNumber =
      input.carryOver &&
      Number.isInteger(input.carryOver.episodeNumber) &&
      input.carryOver.episodeNumber >= 1 &&
      isEpisodeNumberFree(
        input.showId,
        input.seasonNumber,
        input.carryOver.episodeNumber
      )
        ? input.carryOver.episodeNumber
        : undefined;

    const preferred =
      carriedNumber ??
      (input.sourcePosition !== undefined &&
      Number.isInteger(input.sourcePosition) &&
      input.sourcePosition >= 1 &&
      isEpisodeNumberFree(input.showId, input.seasonNumber, input.sourcePosition)
        ? input.sourcePosition
        : nextEpisodeNumber(input.showId, input.seasonNumber));

    const now = Date.now();
    const row: AssignmentRow = {
      id: `msa_${createHash("sha256")
        .update(
          `${input.showId}|${input.seasonNumber}|${input.videoId}|${now}`
        )
        .digest("hex")
        .slice(0, 24)}`,
      showId: input.showId,
      collectionId: input.collectionId ?? null,
      videoId: input.videoId,
      seasonNumber: input.seasonNumber,
      episodeNumber: preferred,
      sourcePosition:
        input.sourcePosition ?? input.carryOver?.sourcePosition ?? null,
      // Keep the carried stem only when its number was also honored, so the
      // SxxExxx token in the filename never disagrees with the episode number.
      exportStem:
        carriedNumber !== undefined && input.carryOver
          ? input.carryOver.exportStem
          : buildExportStem(input.seasonNumber, preferred, input.videoTitle),
      createdAt: now,
      updatedAt: now,
    };

    db.insert(mediaServerEpisodeAssignments).values(row).run();
    return toAssignment(row);
  });
}

/**
 * Replaces a persisted stem. Only used when a planned target collides with an
 * untracked file on disk — never on an ordinary title edit.
 */
export function updateEpisodeAssignmentStem(
  assignmentId: string,
  exportStem: string
): void {
  db.update(mediaServerEpisodeAssignments)
    .set({ exportStem, updatedAt: Date.now() })
    .where(eq(mediaServerEpisodeAssignments.id, assignmentId))
    .run();
}

export function deleteEpisodeAssignment(assignmentId: string): boolean {
  const result = db
    .delete(mediaServerEpisodeAssignments)
    .where(eq(mediaServerEpisodeAssignments.id, assignmentId))
    .run();
  return result.changes > 0;
}

export function deleteEpisodeAssignmentsForVideo(videoId: string): number {
  const result = db
    .delete(mediaServerEpisodeAssignments)
    .where(eq(mediaServerEpisodeAssignments.videoId, videoId))
    .run();
  return result.changes;
}

export function deleteEpisodeAssignmentsForCollection(
  collectionId: string
): number {
  const result = db
    .delete(mediaServerEpisodeAssignments)
    .where(eq(mediaServerEpisodeAssignments.collectionId, collectionId))
    .run();
  return result.changes;
}
