import { VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import { pathExistsSafeSync, readFileSafeSync } from "../../utils/security";
import { getSettings } from "../storageService/settings";
import { getVideoById } from "../storageService/videos";
import type { Video } from "../storageService/types";
import { planMediaServerExportPaths } from "./pathPlanner";
import { syncPlaylistTvForVideo } from "./playlistTvSync";
import {
  getMediaServerExportLayout,
  removeMediaServerArtifactsForVideo,
  syncMediaServerArtifactsForRecord,
  syncMediaServerShowArtifactsForShowRoot,
} from "./syncService";
import type { MediaServerExportMode } from "./types";

function getMediaServerExportMode(): MediaServerExportMode {
  const settings = getSettings() as {
    mediaServerExportMode?: MediaServerExportMode;
  };
  return settings.mediaServerExportMode || "off";
}

function readExistingSourceInfoForRelocation(
  mode: MediaServerExportMode,
  sourceJsonPath: string
): unknown {
  if (mode !== "nfo_and_source_json") {
    return undefined;
  }

  try {
    if (!pathExistsSafeSync(sourceJsonPath, VIDEOS_DIR)) {
      return undefined;
    }
    return JSON.parse(readFileSafeSync(sourceJsonPath, VIDEOS_DIR, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Issue #411. In `playlist_tv` an original file move does NOT change any mirror
 * path — the mirror is derived from the catalog, not from the original layout.
 * What must happen is a relink of every occurrence from the new source path, and
 * the show/season tree must survive: removing it because an original moved would
 * destroy a correct mirror.
 */
function relocatePlaylistTvArtifactsAroundMove(
  videoBefore: Video,
  performMove: () => boolean,
  mode: Exclude<MediaServerExportMode, "off">
): boolean {
  const moved = performMove();
  if (!moved) {
    return moved;
  }

  try {
    const settings = getSettings() as { mediaServerCopyFallback?: boolean };
    syncPlaylistTvForVideo(videoBefore.id, {
      mode,
      copyFallbackEnabled: settings.mediaServerCopyFallback !== false,
      // A playlist download relocated by legacy naming passes through here
      // between the membership insert and the collection-link hook. That hook
      // is the last sync for this video, so the downloader's envelope must
      // still be waiting for it; consuming it here would leave it to write the
      // synthesized source JSON over the extractor's own.
      preservePendingSourceInfo: true,
    });
  } catch (error) {
    logger.error("Failed to relink media server mirror after a file move", error, {
      layout: "playlist_tv",
      action: "materialize",
      videoId: videoBefore.id,
    });
  }

  return moved;
}

export function relocateMediaServerArtifactsAroundMove(
  videoBefore: Video,
  performMove: () => boolean
): boolean {
  const mode = getMediaServerExportMode();

  if (mode !== "off" && getMediaServerExportLayout() === "playlist_tv") {
    return relocatePlaylistTvArtifactsAroundMove(videoBefore, performMove, mode);
  }

  const oldPlan = mode === "off" ? null : planMediaServerExportPaths(videoBefore);

  const moved = performMove();
  if (!moved || mode === "off" || !oldPlan) {
    return moved;
  }

  const rawSourceInfo = readExistingSourceInfoForRelocation(
    mode,
    oldPlan.episodeSourceJsonAbsolutePath
  );

  removeMediaServerArtifactsForVideo(videoBefore);

  if (oldPlan.tvLayout.isTvCompatible && oldPlan.tvLayout.showRootRelativeDir) {
    syncMediaServerShowArtifactsForShowRoot(oldPlan.tvLayout.showRootRelativeDir, {
      modeOverride: mode,
    });
  }

  const videoAfter = getVideoById(videoBefore.id);
  if (videoAfter) {
    syncMediaServerArtifactsForRecord(videoAfter, {
      modeOverride: mode,
      rawSourceInfo,
    });
  }

  return moved;
}
