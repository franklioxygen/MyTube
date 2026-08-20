import { getCollections } from "../storageService/collectionRepository";
import { getVideos } from "../storageService/videos";
import type { Collection, Video } from "../storageService/types";
import {
  buildCollectionShowIdentityKey,
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
  const identityTitles = new Map<string, { title: string; strong: boolean }>();
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
 * Collapses author-fallback identities into a stronger identity of the same
 * title, mirroring findCompatibleExistingShow.
 *
 * Only the single-candidate case merges, exactly as the reconciler requires -
 * an ambiguous title there produces a new show rather than an arbitrary match,
 * so the preview must not merge it either.
 */
function countAfterCompatibilityMerge(
  identityKeys: Set<string>,
  identityTitles: Map<string, { title: string; strong: boolean }>
): number {
  const strongTitles = new Map<string, number>();
  for (const [key, entry] of identityTitles) {
    if (!entry.strong || !entry.title) continue;
    // Collection shows carry no entry here, so this counts author shows only.
    const platform = key.slice(0, key.indexOf(":"));
    const titleKey = `${platform}:${entry.title}`;
    strongTitles.set(titleKey, (strongTitles.get(titleKey) ?? 0) + 1);
  }

  let merged = 0;
  for (const [key, entry] of identityTitles) {
    if (entry.strong || !entry.title) continue;
    const platform = key.slice(0, key.indexOf(":"));
    if (strongTitles.get(`${platform}:${entry.title}`) === 1) {
      merged += 1;
    }
  }

  return identityKeys.size - merged;
}
