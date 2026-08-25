import { eq } from "drizzle-orm";
import { db } from "../../db";
import { collections } from "../../db/schema";
import { logger } from "../../utils/logger";
import {
  acquireRenameLock,
  releaseRenameLock,
} from "../filenameTemplate/renameLockService";
import { getSettings } from "../storageService/settings";
import { getCollectionById } from "../storageService/collectionRepository";
import {
  downloadPoster,
  removeCollectionPoster,
  resolveCollectionPosterSaveLocation,
} from "../tmdbService/poster";
import { resolveCollectionMetadata } from "../tmdbService/collectionSearch";
import { syncPlaylistTvForCollection } from "./playlistTvSync";
import type { Collection } from "../storageService/types";
import type { MediaServerExportLayout, MediaServerExportMode } from "./types";

/**
 * Activation and deactivation for collection-as-show (design §6.1, §6.5).
 *
 * The ordering here is the whole point. A show's directory name is allocated
 * once and never moved, so the metadata the user accepted must be persisted
 * *before* the catalog is touched — otherwise a fallback title would claim the
 * folder and the confirmed title could never take it.
 *
 * Network work (TMDB details, poster download) happens before the maintenance
 * lock is taken. The locked section does database work only, so an interactive
 * request never holds the lock across an HTTP round trip.
 */

export type CollectionShowMode =
  | { kind: "collection" }
  | { kind: "manual"; title: string; description?: string }
  | { kind: "tmdb"; tmdbId: number; mediaType: "tv" | "movie" };

export type ActivationFailure =
  | "layout_not_playlist_tv"
  | "collection_not_found"
  | "lock_unavailable"
  | "tmdb_unavailable"
  | "invalid_title";

export type ActivationResult =
  | {
      status: "ok";
      collection: Collection;
      /** Non-fatal: metadata committed but the poster could not be stored. */
      posterWarning?: boolean;
    }
  | { status: "error"; reason: ActivationFailure };

const MAX_MANUAL_TITLE_LENGTH = 200;
const MAX_MANUAL_DESCRIPTION_LENGTH = 10_000;

function getExportMode(): MediaServerExportMode {
  const settings = getSettings() as { mediaServerExportMode?: MediaServerExportMode };
  return settings.mediaServerExportMode ?? "off";
}

function getLayout(): MediaServerExportLayout {
  const settings = getSettings() as {
    mediaServerExportLayout?: MediaServerExportLayout;
  };
  return settings.mediaServerExportLayout === "playlist_tv"
    ? "playlist_tv"
    : "adjacent";
}

interface ResolvedActivationMetadata {
  mediaServerTitle: string | null;
  mediaServerDescription: string | null;
  mediaServerMetadataSource: "manual" | "tmdb" | null;
  mediaServerPosterPath: string | null;
  tmdbId: number | null;
  tmdbMediaType: "tv" | "movie" | null;
  tmdbPremiereDate: string | null;
  tmdbMatchStrategy: string | null;
  tmdbMatchConfirmedAt: number | null;
  posterWarning: boolean;
}

/**
 * Everything that may touch the network. Runs before the lock is acquired.
 */
async function resolveActivationMetadata(
  collectionId: string,
  mode: CollectionShowMode
): Promise<ResolvedActivationMetadata | { error: ActivationFailure }> {
  if (mode.kind === "collection") {
    // Clearing both sets means a later collection rename updates tvshow.nfo,
    // while the already-allocated directory stays put.
    return {
      mediaServerTitle: null,
      mediaServerDescription: null,
      mediaServerMetadataSource: null,
      mediaServerPosterPath: null,
      tmdbId: null,
      tmdbMediaType: null,
      tmdbPremiereDate: null,
      tmdbMatchStrategy: null,
      tmdbMatchConfirmedAt: null,
      posterWarning: false,
    };
  }

  if (mode.kind === "manual") {
    const title = mode.title.trim();
    if (!title || title.length > MAX_MANUAL_TITLE_LENGTH) {
      return { error: "invalid_title" };
    }
    const description = mode.description?.trim().slice(0, MAX_MANUAL_DESCRIPTION_LENGTH);

    return {
      mediaServerTitle: title,
      mediaServerDescription: description || null,
      mediaServerMetadataSource: "manual",
      mediaServerPosterPath: null,
      // A manual override clears every TMDB field rather than leaving a stale
      // identity attached to a title the user typed.
      tmdbId: null,
      tmdbMediaType: null,
      tmdbPremiereDate: null,
      tmdbMatchStrategy: null,
      tmdbMatchConfirmedAt: null,
      posterWarning: false,
    };
  }

  // Re-fetch by validated id: never trust title/overview/poster from the client.
  const resolved = await resolveCollectionMetadata(mode.tmdbId, mode.mediaType);
  if (!resolved) {
    return { error: "tmdb_unavailable" };
  }

  let posterWebPath: string | null = null;
  let posterWarning = false;

  if (resolved.posterPath) {
    const location = resolveCollectionPosterSaveLocation(
      collectionId,
      resolved.mediaType,
      resolved.tmdbId
    );
    if (location) {
      const downloaded = await downloadPoster(
        resolved.posterPath,
        location.absolutePath
      );
      if (downloaded) {
        posterWebPath = location.webPath;
      } else {
        // Non-fatal by design: metadata is still worth committing, and the
        // planner falls back to an episode thumbnail.
        posterWarning = true;
      }
    } else {
      posterWarning = true;
    }
  }

  return {
    mediaServerTitle: resolved.title,
    mediaServerDescription: resolved.overview ?? null,
    mediaServerMetadataSource: "tmdb",
    mediaServerPosterPath: posterWebPath,
    tmdbId: resolved.tmdbId,
    tmdbMediaType: resolved.mediaType,
    tmdbPremiereDate: resolved.premiereDate ?? null,
    tmdbMatchStrategy: "multi-search-confirmed",
    tmdbMatchConfirmedAt: Date.now(),
    posterWarning,
  };
}

/**
 * Rebuilds the mirror for one collection, inside the maintenance lock.
 *
 * The toggle is not just a flag: until the catalog is reconciled the episodes
 * stay under the author season and no collection-show folder exists, so the UI
 * would report the collection as exported while the media server showed nothing
 * until an unrelated mutation or a full rebuild happened along. Deactivation is
 * symmetric - without this the retired collection show stays materialized.
 *
 * Deliberately inside the lock: this is local filesystem work that must not race
 * a rename job. The rule the lock exists for is that no network round trip
 * happens while holding it, and the TMDB fetch already completed above.
 */
function reconcileAfterToggle(collectionId: string, action: string): void {
  try {
    const settings = getSettings() as { mediaServerCopyFallback?: boolean };
    // Layout as well as mode. Deactivation does not reject a non-managed layout
    // the way activation does, so without this check an adjacent-layout
    // deployment would run the playlist_tv reconciler here and materialize a
    // managed mirror the user never asked for.
    if (getLayout() !== "playlist_tv") {
      return;
    }
    // With the export off there is nothing to write, but the catalog must still
    // be reconciled: activation promises the show's directory name is fixed from
    // the title accepted right now, and that name is allocated by the catalog.
    // Skipping this entirely would let a later rename change the folder the
    // confirmation said was already settled.
    const mode = getExportMode();
    const catalogOnly = mode === "off";

    syncPlaylistTvForCollection(collectionId, {
      mode: catalogOnly ? "nfo" : mode,
      copyFallbackEnabled: settings.mediaServerCopyFallback !== false,
      catalogOnly,
    });
  } catch (error) {
    // Best effort, like every other mirror hook: the flag is already committed
    // and the next rebuild converges. Failing here would leave the user with an
    // error for work that did succeed.
    logger.error("Failed to reconcile the mirror after a show-export toggle", error, {
      layout: "playlist_tv",
      action,
      collectionId,
    });
  }
}

/**
 * Drops a poster that was downloaded for an activation which then failed.
 *
 * The download happens before the lock, so every later bail-out - the lock is
 * held by a rebuild, the layout changed, the collection was deleted - leaves a
 * full-size image and its small mirror on disk that nothing will ever reference
 * or clean up.
 *
 * The one path that must NOT be removed is a poster the collection is already
 * using: re-resolving the same TMDB match rewrites that exact file, so deleting
 * it here would break a row that is still live and still correct.
 */
function discardStagedPoster(
  collectionId: string,
  stagedWebPath: string | null
): void {
  if (!stagedWebPath) {
    return;
  }
  if (getCollectionById(collectionId)?.mediaServerPosterPath === stagedWebPath) {
    return;
  }
  removeCollectionPoster(stagedWebPath);
}

/**
 * Marks a collection as its own show, committing the accepted metadata and the
 * flag together.
 */
export async function activateCollectionShow(
  collectionId: string,
  mode: CollectionShowMode
): Promise<ActivationResult> {
  if (getLayout() !== "playlist_tv") {
    return { status: "error", reason: "layout_not_playlist_tv" };
  }
  if (!getCollectionById(collectionId)) {
    return { status: "error", reason: "collection_not_found" };
  }

  const resolved = await resolveActivationMetadata(collectionId, mode);
  if ("error" in resolved) {
    return { status: "error", reason: resolved.error };
  }

  const lockId = `collection_show_${collectionId}_${Date.now()}`;
  if (!acquireRenameLock(lockId)) {
    // A rebuild or batch rename is running; the mirror must not change under it.
    discardStagedPoster(collectionId, resolved.mediaServerPosterPath);
    return { status: "error", reason: "lock_unavailable" };
  }

  try {
    // Re-read under the lock: layout and collection may have changed while the
    // network work was in flight.
    if (getLayout() !== "playlist_tv") {
      discardStagedPoster(collectionId, resolved.mediaServerPosterPath);
      return { status: "error", reason: "layout_not_playlist_tv" };
    }
    const current = getCollectionById(collectionId);
    if (!current) {
      discardStagedPoster(collectionId, resolved.mediaServerPosterPath);
      return { status: "error", reason: "collection_not_found" };
    }
    const previousPosterPath = current.mediaServerPosterPath ?? null;

    db.update(collections)
      .set({
        exportAsShow: 1,
        mediaServerTitle: resolved.mediaServerTitle,
        mediaServerDescription: resolved.mediaServerDescription,
        mediaServerMetadataSource: resolved.mediaServerMetadataSource,
        mediaServerPosterPath: resolved.mediaServerPosterPath,
        tmdbId: resolved.tmdbId,
        tmdbMediaType: resolved.tmdbMediaType,
        tmdbPremiereDate: resolved.tmdbPremiereDate,
        tmdbMatchStrategy: resolved.tmdbMatchStrategy,
        tmdbMatchConfirmedAt: resolved.tmdbMatchConfirmedAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(collections.id, collectionId))
      .run();

    // The new path is committed, so the one it replaced can go. Posters are
    // named per TMDB id, so switching a collection to a different match would
    // otherwise leave the previous id's image behind on every re-resolution.
    if (
      previousPosterPath &&
      previousPosterPath !== resolved.mediaServerPosterPath
    ) {
      removeCollectionPoster(previousPosterPath);
    }

    logger.info("Activated a collection as its own media server show", {
      layout: "playlist_tv",
      action: "reconcile",
      collectionId,
      reasonCode: resolved.mediaServerMetadataSource ?? "collection",
    });

    // Reconciled before returning, so the response already carries the show
    // directory the caller is about to display.
    reconcileAfterToggle(collectionId, "reconcile");

    const updated = getCollectionById(collectionId);
    return {
      status: "ok",
      collection: updated as Collection,
      posterWarning: resolved.posterWarning || undefined,
    };
  } finally {
    releaseRenameLock();
  }
}

/**
 * Clears the flag. The resolved metadata is intentionally retained so a later
 * re-enable reuses the same identity without another lookup; only the flag
 * changes, and the reconciler then rebuilds the affected shows.
 */
export async function deactivateCollectionShow(
  collectionId: string
): Promise<ActivationResult> {
  if (!getCollectionById(collectionId)) {
    return { status: "error", reason: "collection_not_found" };
  }

  const lockId = `collection_show_off_${collectionId}_${Date.now()}`;
  if (!acquireRenameLock(lockId)) {
    return { status: "error", reason: "lock_unavailable" };
  }

  try {
    db.update(collections)
      .set({ exportAsShow: 0, updatedAt: new Date().toISOString() })
      .where(eq(collections.id, collectionId))
      .run();

    logger.info("Deactivated a collection show", {
      layout: "playlist_tv",
      action: "cleanup",
      collectionId,
    });

    // Symmetric with activation: without this the retired collection show stays
    // materialized and the videos never return to their author season.
    reconcileAfterToggle(collectionId, "cleanup");

    return { status: "ok", collection: getCollectionById(collectionId) as Collection };
  } finally {
    releaseRenameLock();
  }
}
