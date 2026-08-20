import { getCollections } from "../storageService/collectionRepository";
import { getVideos } from "../storageService/videos";
import type { Collection, Video } from "../storageService/types";
import {
  buildCollectionShowIdentityKey,
  collapseCompatibleIdentities,
  normalizeAuthorIdentity,
} from "./identity";
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
 * This reuses the reconciler's own identity resolution and mirrors its
 * compatibility merging, rather than maintaining a second estimate that could
 * drift from the real allocator. It stays an estimate all the same - a rebuild
 * can skip a video whose source file has gone missing - which is why the copy
 * says "about".
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

  // Identity key -> the show title that identity would carry. Needed because
  // the reconciler does not stop at identity keys: findCompatibleExistingShow
  // lets a weaker author-fallback identity join a show that already has a
  // channel URL or id when their titles agree, so counting raw keys reports
  // more folders than actually get created.
  const identityTitles = new Map<
    string,
    { title: string; strong: boolean; platform: string }
  >();
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
      if (!identityTitles.has(metadata.identity.identityKey)) {
        identityTitles.set(metadata.identity.identityKey, {
          title: normalizeAuthorIdentity(metadata.title) ?? "",
          strong: metadata.identity.quality !== "author_fallback",
          platform: metadata.identity.platform,
        });
      }
    }
  }

  return {
    videoCount: videos.length,
    showCount: countAfterCompatibilityMerge(identityKeys, identityTitles),
    collectionShowCount: markedCollectionIds.size,
  };
}

/**
 * Author-show count after the reconciler's compatibility merging, plus the
 * marked collections, which are shows in their own right and never merge.
 */
function countAfterCompatibilityMerge(
  identityKeys: Set<string>,
  identityTitles: Map<string, { title: string; strong: boolean; platform: string }>
): number {
  const merged = collapseCompatibleIdentities(
    [...identityTitles.entries()].map(([identityKey, entry]) => ({
      identityKey,
      platform: entry.platform,
      title: entry.title,
      strong: entry.strong,
      value: identityKey,
    }))
  );

  // identityKeys also holds the collection shows, which contribute no entry to
  // identityTitles and therefore survive the merge untouched.
  return identityKeys.size - (identityTitles.size - merged.length);
}
