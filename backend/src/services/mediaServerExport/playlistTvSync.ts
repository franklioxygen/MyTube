import { db } from "../../db";
import { subscriptions } from "../../db/schema";
import { logger } from "../../utils/logger";
import { getCollections } from "../storageService/collectionRepository";
import { getVideos } from "../storageService/videos";
import type { Collection, Video } from "../storageService/types";
import {
  deleteArtifactRecordsForAssignment,
  listArtifactsForAssignment,
} from "./artifactLedger";
import {
  deleteEpisodeAssignmentsForVideo,
  listAssignmentsForVideo,
} from "./catalogRepository";
import {
  reconcileMediaServerCatalog,
  type CatalogReconcileSubscription,
} from "./catalogReconciler";
import { buildMediaServerCatalogSnapshot } from "./catalogSnapshot";
import {
  materializeMediaServerHierarchy,
  type MaterializeResultSummary,
} from "./hierarchyMaterializer";
import { planMediaServerHierarchy } from "./hierarchyPlanner";
import {
  pruneEmptyMirrorDirectories,
  removeOwnedMirrorArtifact,
} from "./mediaMaterializer";
import { deleteArtifactRecord } from "./artifactLedger";
import { takePendingSourceInfo } from "./pendingSourceInfo";
import { buildSourceInfoEnvelope } from "./sourceInfoEnvelope";
import path from "path";
import { MEDIA_SERVER_LIBRARY_DIR } from "../../config/paths";
import { resolveSafeChildPath } from "../../utils/security";
import type { HierarchyPlanSkip, MediaServerExportMode } from "./types";

/**
 * Incremental playlist-TV synchronization (issue #411).
 *
 * Reconciles the durable catalog for the affected videos/collections, then
 * materializes only the shows that changed. Everything here runs AFTER the
 * database mutation that triggered it has committed — planning a playlist item
 * before its collection link exists would classify it as Season 00 and, because
 * numbering is immutable, that mistake would stick.
 */

function listSubscriptionRowsForExport(): CatalogReconcileSubscription[] {
  return db
    .select({
      id: subscriptions.id,
      collectionId: subscriptions.collectionId,
      playlistId: subscriptions.playlistId,
      playlistTitle: subscriptions.playlistTitle,
      channelName: subscriptions.channelName,
      authorUrl: subscriptions.authorUrl,
      platform: subscriptions.platform,
      subscriptionType: subscriptions.subscriptionType,
    })
    .from(subscriptions)
    .all();
}

function loadLibrary(options: {
  libraryVideos?: Video[];
  libraryCollections?: Collection[];
}): { videos: Video[]; collections: Collection[] } {
  return {
    videos: options.libraryVideos ?? getVideos(),
    collections: options.libraryCollections ?? getCollections(),
  };
}

/**
 * Re-reads collections after reconciliation. `options.libraryCollections` is
 * honored so a caller that supplied a fixed snapshot keeps getting it.
 */
function reloadCollections(options: {
  libraryCollections?: Collection[];
}): Collection[] {
  return options.libraryCollections ?? getCollections();
}

export interface PlaylistTvSyncOptions {
  mode: Exclude<MediaServerExportMode, "off">;
  copyFallbackEnabled: boolean;
  libraryVideos?: Video[];
  libraryCollections?: Collection[];
  /** Serialized `.info.json` bodies keyed by video id, for source-json mode. */
  sourceJsonByVideoId?: Map<string, string>;
  isCancelled?: () => boolean;
}

export interface PlaylistTvSyncResult extends MaterializeResultSummary {
  affectedShowIds: Set<string>;
  reconcileIssues: ReturnType<typeof reconcileMediaServerCatalog>["issues"];
  /**
   * Episodes the planner could not place - missing source file, cloud-backed or
   * mounted path, and so on. Surfaced rather than only logged: a rebuild that
   * silently omits episodes while reporting success is worse than one that says
   * what it left out.
   */
  plannerSkips: HierarchyPlanSkip[];
}

/**
 * Reconciles and materializes the whole library. Used by the rebuild job.
 */
export function syncPlaylistTvLibrary(
  options: PlaylistTvSyncOptions
): PlaylistTvSyncResult {
  const { videos, collections } = loadLibrary(options);
  const subscriptionRows = listSubscriptionRowsForExport();

  const reconcile = reconcileMediaServerCatalog({
    videos,
    collections,
    subscriptions: subscriptionRows,
  });

  if (options.isCancelled?.()) {
    return {
      counts: {
        shows: 0,
        seasons: 0,
        episodes: 0,
        linkedMedia: 0,
        copiedMedia: 0,
        unchangedArtifacts: 0,
        removedArtifacts: 0,
      },
      failures: [],
      affectedShowIds: reconcile.affectedShowIds,
      reconcileIssues: reconcile.issues,
      plannerSkips: [],
    };
  }

  // Reload collections: reconciliation is what writes the season attachment
  // columns, so the objects captured before it still lack them and every season
  // would fall back to a bare "Season NN" title.
  const snapshot = buildMediaServerCatalogSnapshot({
    videos,
    collections: reloadCollections(options),
    subscriptions: subscriptionRows,
  });
  const plan = planMediaServerHierarchy(snapshot, { mode: options.mode });
  const summary = materializeMediaServerHierarchy(plan, {
    copyFallbackEnabled: options.copyFallbackEnabled,
    isCancelled: options.isCancelled,
    sourceJsonByVideoId: options.sourceJsonByVideoId,
    // A whole-library rebuild sweeps the whole ledger, so an artifact whose show
    // row is gone is still reclaimed.
    sweepScopeShowIds: undefined,
  });

  for (const skip of plan.skipped) {
    logger.info("Skipped an item while building the media server mirror", {
      layout: "playlist_tv",
      action: "materialize",
      videoId: skip.videoId,
      assignmentId: skip.assignmentId,
      reasonCode: skip.reason,
    });
  }

  return {
    ...summary,
    affectedShowIds: reconcile.affectedShowIds,
    reconcileIssues: reconcile.issues,
    plannerSkips: plan.skipped,
  };
}

/**
 * Reconciles and materializes only the shows a single video belongs to.
 *
 * The sweep is scoped to exactly those shows, so an unrelated show can never
 * lose artifacts because of a partial plan.
 */
export function syncPlaylistTvForVideo(
  videoId: string,
  options: PlaylistTvSyncOptions
): PlaylistTvSyncResult | null {
  const { videos, collections } = loadLibrary(options);
  const subscriptionRows = listSubscriptionRowsForExport();

  const target = videos.find((video) => video.id === videoId);
  if (!target) {
    return null;
  }

  const affectedCollectionIds = new Set(
    collections
      .filter((collection) => (collection.videos ?? []).includes(videoId))
      .map((collection) => collection.id)
  );

  // Collections the video has *left* must stay in scope. This hook runs after
  // the unlink has committed, so a departed collection no longer lists the
  // video and would drop out of the set above - and the reconciler only sweeps
  // stale assignments whose collection is in scope. Without this the old mirror
  // episode and its assignment survive, and because the assignment survives the
  // video never falls back to Season 00 either, until a full rebuild.
  for (const assignment of listAssignmentsForVideo(videoId)) {
    if (assignment.collectionId) {
      affectedCollectionIds.add(assignment.collectionId);
    }
  }

  // Recover the envelope a suppressed download parked for this deferred run.
  // It feeds both show-identity resolution and the episode's source JSON, so it
  // is read once here and threaded into both.
  const parkedSourceInfo = takePendingSourceInfo(videoId);
  const rawMetadataByVideoId = parkedSourceInfo
    ? new Map<string, unknown>([[videoId, parkedSourceInfo]])
    : undefined;

  const reconcile = reconcileMediaServerCatalog({
    videos,
    collections,
    subscriptions: subscriptionRows,
    affectedVideoIds: new Set([videoId]),
    affectedCollectionIds,
    rawMetadataByVideoId,
  });

  // The video's own shows, plus any show the reconciler touched. Both are
  // needed: an unlink moves a video between shows' seasons.
  const showIds = new Set(reconcile.affectedShowIds);
  for (const assignment of listAssignmentsForVideo(videoId)) {
    showIds.add(assignment.showId);
  }

  if (showIds.size === 0) {
    return {
      counts: {
        shows: 0,
        seasons: 0,
        episodes: 0,
        linkedMedia: 0,
        copiedMedia: 0,
        unchangedArtifacts: 0,
        removedArtifacts: 0,
      },
      failures: [],
      affectedShowIds: showIds,
      reconcileIssues: reconcile.issues,
      plannerSkips: [],
    };
  }

  // Reload collections: reconciliation is what writes the season attachment
  // columns, so the objects captured before it still lack them and every season
  // would fall back to a bare "Season NN" title.
  const snapshot = buildMediaServerCatalogSnapshot({
    videos,
    collections: reloadCollections(options),
    subscriptions: subscriptionRows,
  });
  const plan = planMediaServerHierarchy(snapshot, {
    mode: options.mode,
    showIds,
  });
  const summary = materializeMediaServerHierarchy(plan, {
    copyFallbackEnabled: options.copyFallbackEnabled,
    sourceJsonByVideoId:
      options.sourceJsonByVideoId ??
      buildParkedSourceJsonMap(videoId, parkedSourceInfo, options.mode, target),
    sweepScopeShowIds: showIds,
  });

  return {
    ...summary,
    affectedShowIds: showIds,
    reconcileIssues: reconcile.issues,
    plannerSkips: plan.skipped,
  };
}

/**
 * Rebuilds the source-JSON entry a suppressed download would have written, so
 * the deferred sync does not fall back to the synthesized envelope.
 */
function buildParkedSourceJsonMap(
  videoId: string,
  parkedSourceInfo: unknown,
  mode: MediaServerExportMode,
  video: Video
): Map<string, string> | undefined {
  if (mode !== "nfo_and_source_json" || parkedSourceInfo === undefined) {
    return undefined;
  }
  return new Map([
    [videoId, `${JSON.stringify(buildSourceInfoEnvelope(video, parkedSourceInfo), null, 2)}\n`],
  ]);
}

/**
 * Reconciles and materializes the shows a collection mutation touched.
 */
export function syncPlaylistTvForCollection(
  collectionId: string,
  options: PlaylistTvSyncOptions
): PlaylistTvSyncResult {
  const { videos, collections } = loadLibrary(options);
  const subscriptionRows = listSubscriptionRowsForExport();

  const collection = collections.find((entry) => entry.id === collectionId);
  const affectedVideoIds = new Set(collection?.videos ?? []);

  const reconcile = reconcileMediaServerCatalog({
    videos,
    collections,
    subscriptions: subscriptionRows,
    affectedCollectionIds: new Set([collectionId]),
    affectedVideoIds: affectedVideoIds.size > 0 ? affectedVideoIds : undefined,
  });

  const showIds = new Set(reconcile.affectedShowIds);
  if (collection?.mediaServerShowId) {
    showIds.add(collection.mediaServerShowId);
  }

  // Reload collections: reconciliation is what writes the season attachment
  // columns, so the objects captured before it still lack them and every season
  // would fall back to a bare "Season NN" title.
  const snapshot = buildMediaServerCatalogSnapshot({
    videos,
    collections: reloadCollections(options),
    subscriptions: subscriptionRows,
  });
  const plan = planMediaServerHierarchy(snapshot, {
    mode: options.mode,
    showIds,
  });
  const summary = materializeMediaServerHierarchy(plan, {
    copyFallbackEnabled: options.copyFallbackEnabled,
    sourceJsonByVideoId: options.sourceJsonByVideoId,
    sweepScopeShowIds: showIds,
  });

  return {
    ...summary,
    affectedShowIds: showIds,
    reconcileIssues: reconcile.issues,
    plannerSkips: plan.skipped,
  };
}

/**
 * Removes every mirror occurrence of a video and its catalog assignments.
 *
 * Filesystem cleanup runs BEFORE the assignment rows go, because the ledger row
 * is the only proof of ownership and a cascade delete would otherwise leave the
 * media file orphaned on disk with nothing authorizing its removal.
 */
export function removePlaylistTvArtifactsForVideo(videoId: string): {
  removedArtifacts: number;
  failures: string[];
  /** Shows that lost an episode, for the caller's post-delete reconcile. */
  affectedShowIds: Set<string>;
} {
  const failures: string[] = [];
  let removedArtifacts = 0;
  const directoriesToPrune = new Set<string>();
  const affectedShowIds = new Set<string>();

  for (const assignment of listAssignmentsForVideo(videoId)) {
    affectedShowIds.add(assignment.showId);
    for (const artifact of listArtifactsForAssignment(assignment.id)) {
      try {
        const absolutePath = resolveSafeChildPath(
          MEDIA_SERVER_LIBRARY_DIR,
          artifact.relativePath
        );
        if (removeOwnedMirrorArtifact(artifact.relativePath)) {
          deleteArtifactRecord(artifact.relativePath);
          removedArtifacts += 1;
          directoriesToPrune.add(path.dirname(absolutePath));
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    deleteArtifactRecordsForAssignment(assignment.id);
  }

  deleteEpisodeAssignmentsForVideo(videoId);

  for (const directory of directoriesToPrune) {
    pruneEmptyMirrorDirectories(directory);
  }

  return { removedArtifacts, failures, affectedShowIds };
}

/**
 * Re-materializes specific shows and sweeps whatever the plan no longer expects.
 *
 * Needed after a deletion: per-assignment cleanup cannot touch `tvshow.nfo`,
 * `season.nfo` or the poster, because those artifacts belong to the show rather
 * than to any episode - and a directory still holding them is not empty, so it
 * survives pruning too. Removing the last video would otherwise leave an empty
 * show sitting in the media server until a full rebuild.
 *
 * Runs no reconciliation, so it can never resurrect an assignment that was just
 * deleted.
 */
export function syncPlaylistTvForShows(
  showIds: Set<string>,
  options: PlaylistTvSyncOptions
): PlaylistTvSyncResult | null {
  if (showIds.size === 0) {
    return null;
  }

  const { videos } = loadLibrary(options);
  const subscriptionRows = listSubscriptionRowsForExport();

  const snapshot = buildMediaServerCatalogSnapshot({
    videos,
    collections: reloadCollections(options),
    subscriptions: subscriptionRows,
  });
  const plan = planMediaServerHierarchy(snapshot, {
    mode: options.mode,
    showIds,
  });
  const summary = materializeMediaServerHierarchy(plan, {
    copyFallbackEnabled: options.copyFallbackEnabled,
    sweepScopeShowIds: showIds,
  });

  return {
    ...summary,
    affectedShowIds: showIds,
    reconcileIssues: [],
    plannerSkips: plan.skipped,
  };
}
