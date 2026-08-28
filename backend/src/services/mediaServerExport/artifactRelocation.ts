import { VIDEOS_DIR } from "../../config/paths";
import { pathExistsSafeSync, readFileSafeSync } from "../../utils/security";
import { getSettings } from "../storageService/settings";
import { getVideoById } from "../storageService/videos";
import type { Video } from "../storageService/types";
import { planMediaServerExportPaths } from "./pathPlanner";
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

export function relocateMediaServerArtifactsAroundMove(
  videoBefore: Video,
  performMove: () => boolean
): boolean {
  const mode = getMediaServerExportMode();

  if (getMediaServerExportLayout() === "playlist_tv") {
    // The mirror derives its paths from the catalog, so moving the original
    // never moves a mirror file. Only the hard links have to be re-pointed at
    // the new source, which the per-video sync does from its fingerprints.
    const moved = performMove();
    if (moved && mode !== "off") {
      const videoAfter = getVideoById(videoBefore.id);
      if (videoAfter) {
        syncMediaServerArtifactsForRecord(videoAfter, { modeOverride: mode });
      }
    }
    return moved;
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
