import type { Collection, Video } from "../storageService/types";
import { listArtifacts } from "./artifactLedger";
import {
  listMediaServerEpisodeAssignments,
  listMediaServerShows,
} from "./catalogRepository";
import { getSeasonZeroTitle } from "./naming";
import {
  COLLECTION_SHOW_SEASON_NUMBER,
  type CatalogReconcileSubscription,
} from "./catalogReconciler";
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

  // A marked collection is its own show holding one season. Its collection row
  // carries no `mediaServerShowId` (that column tracks author-season
  // attachment), so the season entry is derived from the show instead. Without
  // this the planner would fall back to a bare `Season 01` label and a
  // show-derived season id rather than the collection-scoped one.
  const collectionShowsByCollectionId = new Map(
    shows
      .filter((show) => show.sourceCollectionId)
      .map((show) => [show.sourceCollectionId as string, show])
  );
  for (const [collectionId, show] of collectionShowsByCollectionId) {
    seasons.push({
      showId: show.id,
      seasonNumber: COLLECTION_SHOW_SEASON_NUMBER,
      collectionId,
      // The show already carries the drama's title and overview; repeating them
      // on the season would show the same text twice in most media servers.
      title: `Season ${String(COLLECTION_SHOW_SEASON_NUMBER).padStart(2, "0")}`,
      plot: "",
    });
  }

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
