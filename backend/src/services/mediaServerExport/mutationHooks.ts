import { logger } from "../../utils/logger";
import { getSettings } from "../storageService/settings";
import {
  getCollectionShow,
  listAssignmentsForShow,
  releaseCollectionShowOwnership,
} from "./catalogRepository";
import { cleanupMediaServerMirror } from "./hierarchyMaterializer";
import {
  removePlaylistTvArtifactsForVideo,
  syncPlaylistTvForCollection,
  syncPlaylistTvForShows,
  syncPlaylistTvForVideo,
} from "./playlistTvSync";
import type { MediaServerExportLayout, MediaServerExportMode } from "./types";

/**
 * Post-commit media-server hooks for ordinary library mutations (issue #411, §9).
 *
 * Every function here MUST be called after the database mutation it reacts to
 * has committed. Reconciling a playlist item before its collection link exists
 * would classify it as an unassigned Season 00 episode, and episode numbering is
 * immutable once written — the mistake would be permanent.
 *
 * All hooks are best-effort: a mirror failure must never fail the user's actual
 * operation, so errors are logged and swallowed. The next rebuild converges.
 */

interface ActiveExportConfig {
  mode: Exclude<MediaServerExportMode, "off">;
  layout: MediaServerExportLayout;
  copyFallbackEnabled: boolean;
}

function getActiveConfig(): ActiveExportConfig | null {
  const settings = getSettings() as {
    mediaServerExportMode?: MediaServerExportMode;
    mediaServerExportLayout?: MediaServerExportLayout;
    mediaServerCopyFallback?: boolean;
  };

  const mode = settings.mediaServerExportMode || "off";
  if (mode === "off") {
    return null;
  }

  return {
    mode,
    layout:
      settings.mediaServerExportLayout === "playlist_tv"
        ? "playlist_tv"
        : "adjacent",
    copyFallbackEnabled: settings.mediaServerCopyFallback !== false,
  };
}

/** Playlist-TV work only; adjacent mode keeps its own existing hooks. */
function withPlaylistTv(
  action: string,
  work: (config: ActiveExportConfig) => void,
  context: Record<string, unknown> = {}
): void {
  const config = getActiveConfig();
  if (!config || config.layout !== "playlist_tv") {
    return;
  }

  try {
    work(config);
  } catch (error) {
    logger.error("Media server mirror hook failed", error, {
      layout: "playlist_tv",
      action,
      ...context,
    });
  }
}

/**
 * A video was linked to a collection. If the collection is a source-backed
 * playlist it becomes a season and the video an episode in it; otherwise the
 * reconcile is a no-op for that collection.
 */
export function onCollectionLinkCommitted(
  collectionId: string,
  videoId: string
): void {
  withPlaylistTv(
    "reconcile",
    (config) => {
      syncPlaylistTvForVideo(videoId, {
        mode: config.mode,
        copyFallbackEnabled: config.copyFallbackEnabled,
      });
    },
    { collectionId, videoId }
  );
}

/**
 * A video left a collection. The reconciler removes only the departed
 * occurrence, and restores a Season 00 occurrence if that was the video's last
 * playlist membership.
 */
export function onCollectionUnlinkCommitted(
  collectionId: string,
  videoId: string
): void {
  withPlaylistTv(
    "reconcile",
    (config) => {
      syncPlaylistTvForVideo(videoId, {
        mode: config.mode,
        copyFallbackEnabled: config.copyFallbackEnabled,
      });
    },
    { collectionId, videoId }
  );
}

/**
 * Collection metadata or source identity changed (rename, description, reorder,
 * or the collection becoming subscription-backed).
 *
 * Reconciles the whole collection, so a collection that has just gained a
 * durable source identity attaches as a season and its existing members leave
 * Season 00. Season numbers and directories are stable throughout, and an
 * upstream reorder updates `sourcePosition` without renumbering episodes.
 */
export function onCollectionMetadataCommitted(collectionId: string): void {
  withPlaylistTv(
    "reconcile",
    (config) => {
      syncPlaylistTvForCollection(collectionId, {
        mode: config.mode,
        copyFallbackEnabled: config.copyFallbackEnabled,
      });
    },
    { collectionId }
  );
}

// Video metadata, artwork, and redownload changes need no hook here: those call
// sites already call syncMediaServerArtifactsForRecord(), which dispatches to
// syncPlaylistTvForVideo() and refreshes every occurrence of the video across
// all of its seasons.

/**
 * Called BEFORE a video row is deleted.
 *
 * The database cascade would drop the assignment rows, and the ledger's
 * ON DELETE SET NULL would then leave the media file on disk with no assignment
 * to tie it to. Cleaning here keeps filesystem removal and catalog removal in
 * one logical operation.
 */
/**
 * A collection is about to be deleted.
 *
 * A collection-show row deliberately outlives its collection so a later
 * re-enable keeps the same identity and directory, but it must stop *claiming*
 * a collection that no longer exists: `sourceCollectionId` is not a foreign key
 * (SQLite cannot add one with an ON DELETE action), so nothing clears it
 * automatically. Left set, the row keeps reserving its directory name and is
 * excluded from author matching forever, and repeated create/delete cycles pile
 * up rows that push unrelated shows onto de-duplication suffixes.
 *
 * The mirror artifacts go too - the collection that justified them is gone.
 */
export function onCollectionDeletePending(collectionId: string): void {
  // Runs regardless of export mode, like onVideoDeletePending: artifacts may
  // have been written while it was on, and this is the last moment the catalog
  // still connects them to this collection.
  const settings = getSettings() as {
    mediaServerExportLayout?: MediaServerExportLayout;
  };

  try {
    const show = getCollectionShow(collectionId);
    if (!show) {
      return;
    }

    // Only the filesystem half is layout-sensitive. A user who exported this
    // collection as a show, switched to adjacent sidecars, and then deleted it
    // would otherwise leave the row claiming a collection that no longer
    // exists - reserving its directory name and staying out of author matching
    // forever - because the claim itself has nothing to do with the layout.
    if (settings.mediaServerExportLayout === "playlist_tv") {
      cleanupMediaServerMirror(new Set([show.id]));
    }

    releaseCollectionShowOwnership(show.id);
  } catch (error) {
    logger.error("Failed to release a collection show before deletion", error, {
      layout: settings.mediaServerExportLayout ?? "adjacent",
      action: "cleanup",
      collectionId,
    });
  }
}

export function onVideoDeleteCommitted(showIds: Set<string>): void {
  if (showIds.size === 0) {
    return;
  }

  // Deliberately not routed through withPlaylistTv. Its config is null when the
  // export mode is "off", but onVideoDeletePending still ran and still removed
  // the episode artifacts - skipping this would leave tvshow.nfo, season.nfo
  // and the poster stranded for a show that just lost its last episode, which
  // is a worse state than not having cleaned at all. The layout is read
  // directly, exactly as the pending half does.
  const settings = getSettings() as {
    mediaServerExportLayout?: MediaServerExportLayout;
    mediaServerCopyFallback?: boolean;
    mediaServerExportMode?: MediaServerExportMode;
  };
  if (settings.mediaServerExportLayout !== "playlist_tv") {
    return;
  }

  const mode = settings.mediaServerExportMode ?? "off";

  try {
    if (mode === "off") {
      // Nothing may be written while the export is off, and re-planning under a
      // substituted mode would sweep artifacts the real mode had produced (a
      // source JSON, say) as a side effect of an unrelated deletion. So only the
      // genuinely emptied shows are swept, and shows that still hold episodes
      // are left exactly as they are.
      for (const showId of showIds) {
        if (listAssignmentsForShow(showId).length === 0) {
          cleanupMediaServerMirror(new Set([showId]));
        }
      }
      return;
    }

    syncPlaylistTvForShows(showIds, {
      mode,
      copyFallbackEnabled: settings.mediaServerCopyFallback !== false,
    });
  } catch (error) {
    logger.error("Failed to reconcile shows after a video deletion", error, {
      layout: "playlist_tv",
      action: "cleanup",
      showIds: [...showIds],
    });
  }
}

export function onVideoDeletePending(videoId: string): Set<string> {
  // Unlike the other hooks this runs even when the export mode is "off": mirror
  // artifacts may have been generated while it was on, and this is the last
  // moment at which they can still be identified. The layout is therefore read
  // directly rather than through getActiveConfig(), which returns null when the
  // mode is off and would hide it.
  const settings = getSettings() as {
    mediaServerExportLayout?: MediaServerExportLayout;
  };
  if (settings.mediaServerExportLayout !== "playlist_tv") {
    return new Set();
  }

  try {
    const removed = removePlaylistTvArtifactsForVideo(videoId);
    if (removed.failures.length > 0) {
      logger.warn("Some media server mirror artifacts could not be removed", {
        layout: "playlist_tv",
        action: "cleanup",
        videoId,
        reasonCode: "artifact_ownership_mismatch",
      });
    }
    // Handed to onVideoDeleteCommitted once the row is gone, so a show that
    // just lost its last episode also loses its tvshow.nfo, poster and seasons.
    return removed.affectedShowIds;
  } catch (error) {
    logger.error("Failed to clean media server mirror before video deletion", error, {
      layout: "playlist_tv",
      action: "cleanup",
      videoId,
    });
    return new Set();
  }
}
