import { logger } from "../../utils/logger";
import { getSettings } from "../storageService/settings";
import {
  removePlaylistTvArtifactsForVideo,
  syncPlaylistTvForCollection,
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
 * Collection metadata changed (rename, description, reorder).
 *
 * Rewrites `season.nfo` only. The season number and directory are stable, and an
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
export function onVideoDeletePending(videoId: string): void {
  // Unlike the other hooks this runs even when the export mode is "off": mirror
  // artifacts may have been generated while it was on, and this is the last
  // moment at which they can still be identified. The layout is therefore read
  // directly rather than through getActiveConfig(), which returns null when the
  // mode is off and would hide it.
  const settings = getSettings() as {
    mediaServerExportLayout?: MediaServerExportLayout;
  };
  if (settings.mediaServerExportLayout !== "playlist_tv") {
    return;
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
  } catch (error) {
    logger.error("Failed to clean media server mirror before video deletion", error, {
      layout: "playlist_tv",
      action: "cleanup",
      videoId,
    });
  }
}
