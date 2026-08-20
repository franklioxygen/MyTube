import { getCollections } from "../storageService/collectionRepository";
import { getVideos } from "../storageService/videos";
import type { Collection, Video } from "../storageService/types";
import { buildCollectionShowIdentityKey } from "./identity";
import { resolveShowMetadata } from "./metadataResolver";

/**
 * Read-only projection of what a managed-library rebuild would touch.
 *
 * The rebuild button used to describe itself only as rewriting sidecar files,
 * which is accurate for the `adjacent` layout and badly misleading for
 * `playlist_tv`: there it materializes the whole library into a mirror and
 * creates a show directory per author. Users need the size of that before they
 * confirm it, not after their media server has picked up dozens of new shows.
 *
 * This deliberately reuses the same identity resolution the reconciler uses, so
 * the number shown is the number that will actually appear rather than a
 * separate estimate that can drift away from the real allocator.
 */

export interface MediaServerExportScope {
  /** Local videos the rebuild would process. */
  videoCount: number;
  /** Distinct shows the mirror would contain, author shows plus marked collections. */
  showCount: number;
  /** Of those, collections exported as their own show. */
  collectionShowCount: number;
}

function isLocalVideo(video: Video): boolean {
  return Boolean(video.videoPath);
}

export function previewMediaServerExportScope(options?: {
  videos?: Video[];
  collections?: Collection[];
}): MediaServerExportScope {
  const videos = (options?.videos ?? getVideos()).filter(isLocalVideo);
  const collections = options?.collections ?? getCollections();

  const collectionsById = new Map(collections.map((c) => [c.id, c]));
  const collectionByVideoId = new Map<string, Collection>();
  for (const collection of collections) {
    for (const videoId of collection.videos ?? []) {
      if (!collectionByVideoId.has(videoId)) {
        collectionByVideoId.set(videoId, collection);
      }
    }
  }

  const identityKeys = new Set<string>();

  // A marked collection is a show in its own right, never a season, so it
  // contributes its own identity regardless of who uploaded its videos.
  const markedCollectionIds = new Set<string>();
  for (const collection of collections) {
    if (collection.exportAsShow) {
      markedCollectionIds.add(collection.id);
      identityKeys.add(buildCollectionShowIdentityKey(collection.id));
    }
  }

  for (const video of videos) {
    // Videos wholly inside marked collections do not create an author show.
    const memberships = collections.filter((collection) =>
      (collection.videos ?? []).includes(video.id)
    );
    if (
      memberships.length > 0 &&
      memberships.every((collection) => markedCollectionIds.has(collection.id))
    ) {
      continue;
    }

    const collection = collectionByVideoId.get(video.id);
    const metadata = resolveShowMetadata({
      video,
      collection:
        collection && !markedCollectionIds.has(collection.id)
          ? collectionsById.get(collection.id)
          : undefined,
    });
    if (metadata.identity) {
      identityKeys.add(metadata.identity.identityKey);
    }
  }

  return {
    videoCount: videos.length,
    showCount: identityKeys.size,
    collectionShowCount: markedCollectionIds.size,
  };
}
