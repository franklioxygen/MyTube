import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../db";
import {
  collections,
  mediaServerEpisodeAssignments,
  mediaServerRetiredEpisodes,
  mediaServerShows,
} from "../../db/schema";
import type {
  MediaServerEpisodeAssignment,
  MediaServerShow,
} from "./types";

/**
 * Narrow database access for the media-server export catalog (issue #411).
 * Planners never see Drizzle tables; they receive plain records from here.
 *
 * Callers that allocate (the reconciler) run every read and write inside one
 * `db.transaction()`, so a season or episode number can never be handed out
 * twice by two concurrent downloads.
 */

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
    directoryName: row.directoryName,
    nextSeasonNumber: row.nextSeasonNumber,
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
  };
}

export function getMediaServerShows(): MediaServerShow[] {
  return db.select().from(mediaServerShows).all().map(toShow);
}

export function getMediaServerEpisodeAssignments(): MediaServerEpisodeAssignment[] {
  return db.select().from(mediaServerEpisodeAssignments).all().map(toAssignment);
}

export function getMediaServerAssignmentsForVideo(
  videoId: string
): MediaServerEpisodeAssignment[] {
  return db
    .select()
    .from(mediaServerEpisodeAssignments)
    .where(eq(mediaServerEpisodeAssignments.videoId, videoId))
    .all()
    .map(toAssignment);
}

export interface CreateMediaServerShowInput {
  identityKey: string;
  sourcePlatform: string;
  sourceChannelId?: string;
  sourceChannelUrl?: string;
  title: string;
  description: string;
  directoryName: string;
}

export function createMediaServerShow(
  input: CreateMediaServerShowInput
): MediaServerShow {
  const now = Date.now();
  const row: ShowRow = {
    id: uuidv4(),
    identityKey: input.identityKey,
    sourcePlatform: input.sourcePlatform,
    sourceChannelId: input.sourceChannelId ?? null,
    sourceChannelUrl: input.sourceChannelUrl ?? null,
    title: input.title,
    description: input.description,
    directoryName: input.directoryName,
    nextSeasonNumber: 1,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(mediaServerShows).values(row).run();
  return toShow(row);
}

export type MediaServerShowPatch = Partial<
  Pick<
    MediaServerShow,
    | "identityKey"
    | "sourceChannelId"
    | "sourceChannelUrl"
    | "title"
    | "description"
  >
>;

export function updateMediaServerShow(
  showId: string,
  patch: MediaServerShowPatch
): void {
  if (Object.keys(patch).length === 0) {
    return;
  }
  db.update(mediaServerShows)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(mediaServerShows.id, showId))
    .run();
}

/**
 * Attach a collection to a show and hand it the next free season number. The
 * counter only ever moves forward, so a deleted season's number is never
 * reused by a later playlist.
 */
export function allocateSeasonNumber(
  showId: string,
  collectionId: string
): number {
  const show = db
    .select({ nextSeasonNumber: mediaServerShows.nextSeasonNumber })
    .from(mediaServerShows)
    .where(eq(mediaServerShows.id, showId))
    .get();
  if (!show) {
    throw new Error(`Media-server show ${showId} not found.`);
  }

  const seasonNumber = show.nextSeasonNumber;
  db.update(mediaServerShows)
    .set({ nextSeasonNumber: seasonNumber + 1, updatedAt: Date.now() })
    .where(eq(mediaServerShows.id, showId))
    .run();
  db.update(collections)
    .set({ mediaServerShowId: showId, mediaServerSeasonNumber: seasonNumber })
    .where(eq(collections.id, collectionId))
    .run();

  return seasonNumber;
}

export interface CreateEpisodeAssignmentInput {
  showId: string;
  collectionId?: string;
  videoId: string;
  seasonNumber: number;
  episodeNumber: number;
  sourcePosition?: number;
  exportStem: string;
}

export function createEpisodeAssignment(
  input: CreateEpisodeAssignmentInput
): MediaServerEpisodeAssignment {
  if (
    !Number.isInteger(input.seasonNumber) ||
    input.seasonNumber < 0 ||
    !Number.isInteger(input.episodeNumber) ||
    input.episodeNumber < 1 ||
    (input.seasonNumber === 0) !== (input.collectionId === undefined)
  ) {
    throw new Error(
      `Invalid media-server episode assignment for video ${input.videoId}: ` +
        `season ${input.seasonNumber}, episode ${input.episodeNumber}.`
    );
  }

  const now = Date.now();
  const row: AssignmentRow = {
    id: uuidv4(),
    showId: input.showId,
    collectionId: input.collectionId ?? null,
    videoId: input.videoId,
    seasonNumber: input.seasonNumber,
    episodeNumber: input.episodeNumber,
    sourcePosition: input.sourcePosition ?? null,
    exportStem: input.exportStem,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(mediaServerEpisodeAssignments).values(row).run();
  return toAssignment(row);
}

export function updateEpisodeSourcePosition(
  assignmentId: string,
  sourcePosition: number | undefined
): void {
  db.update(mediaServerEpisodeAssignments)
    .set({ sourcePosition: sourcePosition ?? null, updatedAt: Date.now() })
    .where(eq(mediaServerEpisodeAssignments.id, assignmentId))
    .run();
}

export interface RetiredEpisodeNumber {
  showId: string;
  seasonNumber: number;
  episodeNumber: number;
}

/** Episode numbers their seasons have spent and can never hand out again. */
export function getRetiredEpisodeNumbers(): RetiredEpisodeNumber[] {
  return db
    .select()
    .from(mediaServerRetiredEpisodes)
    .all()
    .map((row) => ({
      showId: row.showId,
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
    }));
}

/**
 * Delete an assignment and tombstone the episode number it gives up. The number
 * stays spent forever: handing it to different content later would make a media
 * server graft the new episode onto the removed one's metadata.
 */
export function deleteEpisodeAssignment(assignmentId: string): void {
  const row = db
    .select()
    .from(mediaServerEpisodeAssignments)
    .where(eq(mediaServerEpisodeAssignments.id, assignmentId))
    .get();
  if (!row) {
    return;
  }

  db.insert(mediaServerRetiredEpisodes)
    .values({
      showId: row.showId,
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
      retiredAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
  db.delete(mediaServerEpisodeAssignments)
    .where(eq(mediaServerEpisodeAssignments.id, assignmentId))
    .run();
}
