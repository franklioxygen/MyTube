import type { Collection, Video } from "../storageService/types";
import { listArtifacts } from "./artifactLedger";
import {
  listMediaServerEpisodeAssignments,
  listMediaServerShows,
} from "./catalogRepository";
import { getSeasonZeroTitle } from "./naming";
import type { CatalogReconcileSubscription } from "./catalogReconciler";
import { resolveSeasonMetadata } from "./metadataResolver";
import type {
  MediaServerCatalogSnapshot,
  MediaServerSeason,
} from "./types";

/**
 * Loads one consistent read of the catalog for the pure planner (issue #411).
 *
 * Kept separate from `hierarchyPlanner` so planning itself stays free of any
 * database access and can be tested against fixture data.
 */
export function buildMediaServerCatalogSnapshot(input: {
  videos: Video[];
  collections: Collection[];
  subscriptions: CatalogReconcileSubscription[];
}): MediaServerCatalogSnapshot {
  const shows = listMediaServerShows();
  const assignments = listMediaServerEpisodeAssignments();

  const subscriptionsByCollectionId = new Map<
    string,
    CatalogReconcileSubscription
  >();
  for (const subscription of input.subscriptions) {
    if (subscription.collectionId) {
      subscriptionsByCollectionId.set(subscription.collectionId, subscription);
    }
  }

  const seasons: MediaServerSeason[] = [];
  for (const collection of input.collections) {
    if (
      !collection.mediaServerShowId ||
      collection.mediaServerSeasonNumber == null
    ) {
      continue;
    }

    const { title, plot } = resolveSeasonMetadata({
      collection,
      seasonNumber: collection.mediaServerSeasonNumber,
      subscription: subscriptionsByCollectionId.get(collection.id),
    });

    seasons.push({
      showId: collection.mediaServerShowId,
      seasonNumber: collection.mediaServerSeasonNumber,
      collectionId: collection.id,
      title,
      plot,
    });
  }

  // Season 00 has no collection row, so its metadata is synthesized here rather
  // than being left for the planner to invent.
  const showsWithSpecials = new Set(
    assignments
      .filter((assignment) => assignment.seasonNumber === 0)
      .map((assignment) => assignment.showId)
  );
  for (const showId of showsWithSpecials) {
    seasons.push({
      showId,
      seasonNumber: 0,
      title: getSeasonZeroTitle(),
      plot: "",
    });
  }

  return {
    shows,
    seasons,
    assignments,
    videosById: new Map(input.videos.map((video) => [video.id, video])),
    artifactsByPath: new Map(
      listArtifacts().map((artifact) => [artifact.relativePath, artifact])
    ),
  };
}
