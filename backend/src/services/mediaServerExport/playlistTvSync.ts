import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { subscriptions } from "../../db/schema";
import { logger } from "../../utils/logger";
import { getCollections } from "../storageService/collectionRepository";
// Imported from the leaf query/repository modules rather than the storageService
// barrels, which reach back into this service and would form an import cycle.
import { getVideos } from "../storageService/videoQueries";
import { listArtifacts } from "./artifactLedger";
import {
  deleteEpisodeAssignment,
  getMediaServerAssignmentsForVideo,
  getMediaServerEpisodeAssignments,
  getMediaServerShows,
} from "./catalogRepository";
import {
  reconcileMediaServerCatalog,
  type PlaylistSubscriptionRef,
} from "./catalogReconciler";
import {
  cleanupMediaServerMirror,
  materializeMediaServerHierarchy,
  type MaterializeHierarchyOptions,
  type MaterializeHierarchyResult,
} from "./hierarchyMaterializer";
import { planMediaServerHierarchy } from "./hierarchyPlanner";
import { removeTrackedArtifact } from "./mediaMaterializer";
import { SEASON_ZERO_TITLE, buildSeasonDirectoryName } from "./identity";
import type {
  HierarchyPlan,
  MediaServerCatalogSnapshot,
  MediaServerExportJobPhase,
  MediaServerExportMode,
  MediaServerExportSkip,
  MediaServerSeasonMetadata,
} from "./types";
import type { Video } from "../storageService";

/**
 * Entry points that drive the managed playlist-TV mirror (issue #411):
 * reconcile the catalog, plan the expected tree, then materialize and sweep the
 * affected shows. Reconciliation always covers the whole library — it is cheap
 * and in-memory — while materialization is scoped, which is where the cost is.
 */

export interface PlaylistTvExportOptions {
  mode: Exclude<MediaServerExportMode, "off">;
  copyFallback: boolean;
  /** Restricts planning, materialization, and sweeping to these shows. */
  showIds?: readonly string[];
  rawInfoByVideoId?: Map<string, unknown>;
  isCancelled?: MaterializeHierarchyOptions["isCancelled"];
  onEpisodeStart?: MaterializeHierarchyOptions["onEpisodeStart"];
  onEpisodeFinished?: MaterializeHierarchyOptions["onEpisodeFinished"];
  /** Phase reporting for the rebuild job. `plan` is supplied once planning ends. */
  onPhase?: (phase: MediaServerExportJobPhase, plan?: HierarchyPlan) => void;
}

export interface PlaylistTvExportResult extends MaterializeHierarchyResult {
  issues: MediaServerExportSkip[];
  plan: HierarchyPlan;
}

function loadPlaylistSubscriptionRefs(): PlaylistSubscriptionRef[] {
  return db
    .select({
      collectionId: subscriptions.collectionId,
      channelName: subscriptions.channelName,
      author: subscriptions.author,
      platform: subscriptions.platform,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.subscriptionType, "playlist"),
        isNotNull(subscriptions.collectionId)
      )
    )
    .all()
    .map((row) => ({
      collectionId: row.collectionId as string,
      channelName: row.channelName ?? undefined,
      author: row.author ?? undefined,
      platform: row.platform ?? undefined,
    }));
}

/**
 * Reads the catalog back after reconciliation, including the season titles and
 * plots that reconciliation just attached to their collections.
 */
function loadMediaServerCatalogSnapshot(
  videos: Video[]
): MediaServerCatalogSnapshot {
  const shows = getMediaServerShows();
  const assignments = getMediaServerEpisodeAssignments();
  const collections = getCollections();

  const seasons: MediaServerSeasonMetadata[] = [];
  const seen = new Set<string>();
  for (const collection of collections) {
    if (
      collection.mediaServerShowId === undefined ||
      collection.mediaServerSeasonNumber === undefined
    ) {
      continue;
    }
    const key = `${collection.mediaServerShowId}|${collection.mediaServerSeasonNumber}`;
    seen.add(key);
    seasons.push({
      showId: collection.mediaServerShowId,
      seasonNumber: collection.mediaServerSeasonNumber,
      collectionId: collection.id,
      title:
        collection.title ||
        collection.name ||
        buildSeasonDirectoryName(collection.mediaServerSeasonNumber),
      description: collection.description || "",
    });
  }

  for (const show of shows) {
    const key = `${show.id}|0`;
    if (!seen.has(key)) {
      seasons.push({
        showId: show.id,
        seasonNumber: 0,
        title: SEASON_ZERO_TITLE,
        description: "",
      });
    }
  }

  return {
    shows,
    seasons,
    assignments,
    videosById: new Map(videos.map((video) => [video.id, video])),
  };
}

function reconcileWholeLibrary(
  videos: Video[],
  rawInfoByVideoId?: Map<string, unknown>
): MediaServerExportSkip[] {
  return reconcileMediaServerCatalog({
    videos,
    collections: getCollections(),
    playlistSubscriptions: loadPlaylistSubscriptionRefs(),
    rawInfoByVideoId,
  }).issues;
}

function planAndMaterialize(
  videos: Video[],
  options: PlaylistTvExportOptions
): { plan: HierarchyPlan; result: MaterializeHierarchyResult } {
  options.onPhase?.("plan");
  const plan = planMediaServerHierarchy({
    snapshot: loadMediaServerCatalogSnapshot(videos),
    mode: options.mode,
    showIds: options.showIds,
  });
  options.onPhase?.("materialize", plan);
  const result = materializeMediaServerHierarchy({
    plan,
    copyFallback: options.copyFallback,
    sweepScopeShowIds: options.showIds,
    isCancelled: options.isCancelled,
    onSweepStart: () => options.onPhase?.("sweep"),
    onEpisodeStart: options.onEpisodeStart,
    onEpisodeFinished: options.onEpisodeFinished,
  });
  return { plan, result };
}

/** Full-library rebuild: reconcile everything, then converge every show. */
export function runPlaylistTvExport(
  options: PlaylistTvExportOptions
): PlaylistTvExportResult {
  const videos = getVideos();
  options.onPhase?.("catalog_reconcile");
  const issues = reconcileWholeLibrary(videos, options.rawInfoByVideoId);
  const { plan, result } = planAndMaterialize(videos, options);
  return { ...result, issues, plan };
}

function showIdsForVideo(videoId: string): string[] {
  return getMediaServerAssignmentsForVideo(videoId).map(
    (assignment) => assignment.showId
  );
}

/**
 * Converge the mirror after one video changed. The scope spans the shows the
 * video belonged to before and after reconciliation, so an occurrence that
 * moved between shows is swept from the one it left.
 */
export function syncPlaylistTvForVideo(
  video: Video,
  options: {
    mode: Exclude<MediaServerExportMode, "off">;
    copyFallback: boolean;
    rawSourceInfo?: unknown;
  }
): void {
  const rawInfoByVideoId =
    options.rawSourceInfo !== undefined
      ? new Map<string, unknown>([[video.id, options.rawSourceInfo]])
      : undefined;

  const showIdsBefore = showIdsForVideo(video.id);
  const videos = getVideos();
  reconcileWholeLibrary(videos, rawInfoByVideoId);

  const showIds = Array.from(
    new Set([...showIdsBefore, ...showIdsForVideo(video.id)])
  );
  if (showIds.length === 0) {
    return;
  }
  planAndMaterialize(videos, { ...options, showIds });
}

/**
 * Converge the mirror after a collection mutation. The changed video is passed
 * in as well so an unlink sweeps the season it just left and republishes the
 * video under Specials in the same pass.
 */
export function syncPlaylistTvForCollection(
  collectionId: string,
  options: {
    mode: Exclude<MediaServerExportMode, "off">;
    copyFallback: boolean;
    videoId?: string;
  }
): void {
  const showIdsBefore = options.videoId ? showIdsForVideo(options.videoId) : [];
  const videos = getVideos();
  reconcileWholeLibrary(videos);

  const collection = getCollections().find((item) => item.id === collectionId);
  const showIds = Array.from(
    new Set([
      ...showIdsBefore,
      ...(options.videoId ? showIdsForVideo(options.videoId) : []),
      ...(collection?.mediaServerShowId ? [collection.mediaServerShowId] : []),
    ])
  );
  if (showIds.length === 0) {
    return;
  }
  planAndMaterialize(videos, { ...options, showIds });
}

export function removePlaylistTvArtifactsForVideo(videoId: string): void {
  const assignments = getMediaServerAssignmentsForVideo(videoId);
  if (assignments.length === 0) {
    return;
  }

  const showIds = Array.from(
    new Set(assignments.map((assignment) => assignment.showId))
  );
  const assignmentIds = new Set(assignments.map((assignment) => assignment.id));
  const scopedArtifacts = listArtifacts(showIds);

  for (const artifact of scopedArtifacts) {
    if (artifact.assignmentId && assignmentIds.has(artifact.assignmentId)) {
      removeTrackedArtifact(artifact.relativePath);
    }
  }
  for (const assignment of assignments) {
    deleteEpisodeAssignment(assignment.id);
  }

  // Nothing reconciles after this — the video row is about to disappear — so the
  // season and show artifacts the occurrences leave behind are cleared here
  // rather than waiting for the next rebuild to sweep an empty season.
  const remaining = getMediaServerEpisodeAssignments();
  const showsById = new Map(getMediaServerShows().map((show) => [show.id, show]));
  for (const showId of showIds) {
    const showArtifacts = listArtifacts([showId]);
    if (!remaining.some((assignment) => assignment.showId === showId)) {
      for (const artifact of showArtifacts) {
        removeTrackedArtifact(artifact.relativePath);
      }
      continue;
    }

    const directoryName = showsById.get(showId)?.directoryName;
    if (!directoryName) {
      continue;
    }
    const emptiedSeasons = assignments
      .filter(
        (assignment) =>
          assignment.showId === showId &&
          !remaining.some(
            (other) =>
              other.showId === showId &&
              other.seasonNumber === assignment.seasonNumber
          )
      )
      .map((assignment) => assignment.seasonNumber);
    for (const seasonNumber of emptiedSeasons) {
      const prefix = `${directoryName}/${buildSeasonDirectoryName(seasonNumber)}/`;
      for (const artifact of showArtifacts) {
        if (artifact.relativePath.startsWith(prefix)) {
          removeTrackedArtifact(artifact.relativePath);
        }
      }
    }
  }
}

export function cleanupPlaylistTvLibrary(): {
  removedPaths: string[];
  failures: MediaServerExportSkip[];
} {
  const result = cleanupMediaServerMirror();
  logger.info("Cleaned up the managed media-server mirror", {
    layout: "playlist_tv",
    action: "cleanup",
    removed: result.removedPaths.length,
  });
  return result;
}
