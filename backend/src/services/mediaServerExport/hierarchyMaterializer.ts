import { logger } from "../../utils/logger";
import { listArtifacts } from "./artifactLedger";
import { collectPlannedRelativePaths } from "./hierarchyPlanner";
import {
  ArtifactError,
  materializeArtifact,
  removeTrackedArtifact,
} from "./mediaMaterializer";
import type {
  HierarchyPlan,
  MediaServerExportJobCounts,
  MediaServerExportSkip,
  PlannedArtifact,
} from "./types";

/**
 * Executes a hierarchy plan against the managed mirror (issue #411).
 *
 * Work is grouped per show so one broken show cannot abort the rest, and
 * cancellation is only honoured between whole episodes — never between
 * publishing a file and recording it in the ledger.
 */

export interface MaterializeHierarchyOptions {
  plan: HierarchyPlan;
  copyFallback: boolean;
  /**
   * Shows whose stale artifacts may be swept. Must match the scope the plan was
   * built with: an unscoped sweep after a scoped plan would delete every other
   * show's artifacts. Undefined means "the whole mirror".
   */
  sweepScopeShowIds?: readonly string[];
  isCancelled?: () => boolean;
  onSweepStart?: () => void;
  onEpisodeStart?: (videoId: string, title: string) => void;
  onEpisodeFinished?: (result: {
    videoId: string;
    title: string;
    failure?: MediaServerExportSkip;
  }) => void;
}

export interface MaterializeHierarchyResult {
  counts: MediaServerExportJobCounts;
  failures: MediaServerExportSkip[];
  removedPaths: string[];
  cancelled: boolean;
}

function emptyCounts(): MediaServerExportJobCounts {
  return {
    shows: 0,
    seasons: 0,
    episodes: 0,
    linkedMedia: 0,
    copiedMedia: 0,
    unchangedArtifacts: 0,
    removedArtifacts: 0,
  };
}

function toFailure(
  error: unknown,
  context: { videoId?: string; title: string }
): MediaServerExportSkip {
  if (error instanceof ArtifactError) {
    return { ...context, reason: error.reason, detail: error.message };
  }
  return {
    ...context,
    reason: "invalid_catalog_assignment",
    detail: error instanceof Error ? error.message : String(error),
  };
}

export function materializeMediaServerHierarchy(
  options: MaterializeHierarchyOptions
): MaterializeHierarchyResult {
  const counts = emptyCounts();
  const failures: MediaServerExportSkip[] = [];
  const isCancelled = options.isCancelled ?? (() => false);

  const applyArtifacts = (
    artifacts: PlannedArtifact[],
    showId: string
  ): void => {
    for (const artifact of artifacts) {
      const result = materializeArtifact(
        artifact,
        showId,
        options.copyFallback
      );
      if (!result.changed) {
        counts.unchangedArtifacts++;
        continue;
      }
      if (artifact.artifactType === "episode_media") {
        if (result.materialization === "hard_link") {
          counts.linkedMedia++;
        } else {
          counts.copiedMedia++;
        }
      }
    }
  };

  let cancelled = false;
  for (const show of options.plan.shows) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }

    try {
      applyArtifacts(show.artifacts, show.showId);
    } catch (error) {
      const failure = toFailure(error, { title: show.directoryName });
      failures.push(failure);
      logger.error("Failed to materialize media-server show artifacts", error, {
        layout: "playlist_tv",
        action: "materialize",
        showId: show.showId,
        reasonCode: failure.reason,
      });
      continue;
    }
    counts.shows++;

    for (const season of show.seasons) {
      try {
        applyArtifacts(season.artifacts, show.showId);
      } catch (error) {
        const failure = toFailure(error, {
          title: `${show.directoryName} S${season.seasonNumber}`,
        });
        failures.push(failure);
        logger.error("Failed to materialize media-server season", error, {
          layout: "playlist_tv",
          action: "materialize",
          showId: show.showId,
          reasonCode: failure.reason,
        });
        continue;
      }
      counts.seasons++;

      for (const episode of season.episodes) {
        if (isCancelled()) {
          cancelled = true;
          break;
        }
        options.onEpisodeStart?.(episode.videoId, episode.title);
        let failure: MediaServerExportSkip | undefined;
        try {
          applyArtifacts(episode.artifacts, show.showId);
          counts.episodes++;
        } catch (error) {
          failure = toFailure(error, {
            videoId: episode.videoId,
            title: episode.title,
          });
          failures.push(failure);
          logger.error("Failed to materialize media-server episode", error, {
            layout: "playlist_tv",
            action: "materialize",
            showId: show.showId,
            assignmentId: episode.assignmentId,
            videoId: episode.videoId,
            reasonCode: failure.reason,
          });
        }
        options.onEpisodeFinished?.({
          videoId: episode.videoId,
          title: episode.title,
          failure,
        });
      }

      if (cancelled) {
        break;
      }
    }

    if (cancelled) {
      break;
    }
  }

  const removedPaths: string[] = [];
  if (!cancelled) {
    options.onSweepStart?.();
    const expected = collectPlannedRelativePaths(options.plan);
    for (const artifact of listArtifacts(options.sweepScopeShowIds)) {
      if (expected.has(artifact.relativePath)) {
        continue;
      }
      try {
        removeTrackedArtifact(artifact.relativePath);
        removedPaths.push(artifact.relativePath);
        counts.removedArtifacts++;
      } catch (error) {
        failures.push(
          toFailure(error, { title: artifact.relativePath })
        );
        logger.error("Failed to remove stale media-server artifact", error, {
          layout: "playlist_tv",
          action: "cleanup",
          relativePath: artifact.relativePath,
        });
      }
    }
  }

  return { counts, failures, removedPaths, cancelled };
}

/**
 * Delete every artifact MyTube owns in the mirror (optionally within a scope).
 * The show/season/episode catalog is preserved, so re-enabling the layout keeps
 * the numbering the user's media server already indexed.
 */
export function cleanupMediaServerMirror(showIds?: readonly string[]): {
  removedPaths: string[];
  failures: MediaServerExportSkip[];
} {
  const removedPaths: string[] = [];
  const failures: MediaServerExportSkip[] = [];

  for (const artifact of listArtifacts(showIds)) {
    try {
      removeTrackedArtifact(artifact.relativePath);
      removedPaths.push(artifact.relativePath);
    } catch (error) {
      failures.push(toFailure(error, { title: artifact.relativePath }));
      logger.error("Failed to remove media-server artifact", error, {
        layout: "playlist_tv",
        action: "cleanup",
        relativePath: artifact.relativePath,
      });
    }
  }

  return { removedPaths, failures };
}
