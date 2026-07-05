import { getSettings } from "../storageService/settings";
import { getVideoById } from "../storageService/videos";
import type { Video } from "../storageService/types";
import { planMediaServerExportPaths } from "./pathPlanner";
import {
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

export function relocateMediaServerArtifactsAroundMove(
  videoBefore: Video,
  performMove: () => boolean
): boolean {
  const mode = getMediaServerExportMode();
  const oldPlan = mode === "off" ? null : planMediaServerExportPaths(videoBefore);

  const moved = performMove();
  if (!moved || mode === "off" || !oldPlan) {
    return moved;
  }

  removeMediaServerArtifactsForVideo(videoBefore);

  if (oldPlan.tvLayout.isTvCompatible && oldPlan.tvLayout.showRootRelativeDir) {
    syncMediaServerShowArtifactsForShowRoot(oldPlan.tvLayout.showRootRelativeDir, {
      modeOverride: mode,
    });
  }

  const videoAfter = getVideoById(videoBefore.id);
  if (videoAfter) {
    syncMediaServerArtifactsForRecord(videoAfter, { modeOverride: mode });
  }

  return moved;
}
