import { useMemo } from "react";
import { Collection, Video } from "../types";
import { ViewMode } from "./useViewMode";

function normalizeTag(value: string | undefined | null): string {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

function normalizeTagList(tags: string[] | undefined | null): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.map(normalizeTag).filter((tag) => tag.length > 0);
}

function videoMatchesTags(
  video: Video,
  normalizedSelectedTags: string[],
  authorTags?: Record<string, string[]>,
  collectionTags?: Record<string, string[]>,
  collections?: Collection[]
): boolean {
  if (normalizedSelectedTags.length === 0) return true;

  const videoTagsNormalized = normalizeTagList(video.tags);
  const videoTagSet = new Set(videoTagsNormalized);
  const matchByVideoTags =
    normalizedSelectedTags.length > 0 &&
    normalizedSelectedTags.every((t) => videoTagSet.has(t));
  if (matchByVideoTags) return true;

  const authorKey = normalizeTag(video.author);
  const authorTagList = normalizeTagList(authorTags?.[authorKey]);
  const authorTagSet = new Set(authorTagList);
  const matchByAuthorTags = normalizedSelectedTags.every((t) =>
    authorTagSet.has(t)
  );
  if (matchByAuthorTags) return true;

  if (collections && collectionTags) {
    const matchByCollectionTags = collections.some(
      (c) => {
        if (!c.videos.includes(video.id)) return false;
        const collectionTagSet = new Set(
          normalizeTagList(collectionTags[c.id])
        );
        return normalizedSelectedTags.every((t) => collectionTagSet.has(t));
      }
    );
    if (matchByCollectionTags) return true;
  }

  return false;
}

interface UseVideoFilteringProps {
  videos: Video[];
  viewMode: ViewMode;
  selectedTags: string[];
  collections: Collection[];
  authorTags?: Record<string, string[]>;
  collectionTags?: Record<string, string[]>;
}

export const useVideoFiltering = ({
  videos,
  viewMode,
  selectedTags,
  collections,
  authorTags,
  collectionTags,
}: UseVideoFilteringProps): Video[] => {
  const videoArray = useMemo(
    () => (Array.isArray(videos) ? videos : []),
    [videos]
  );
  const normalizedSelectedTags = useMemo(
    () =>
      selectedTags
        .filter((t): t is string => t != null && String(t).trim() !== "")
        .map(normalizeTag),
    [selectedTags]
  );

  return useMemo(() => {
    if (viewMode === "all-videos") {
      return videoArray.filter((video) =>
        videoMatchesTags(
          video,
          normalizedSelectedTags,
          authorTags,
          collectionTags,
          collections
        )
      );
    }

    if (viewMode === "history") {
      return videoArray
        .filter((video) => {
          if (!video.lastPlayedAt) return false;
          return videoMatchesTags(
            video,
            normalizedSelectedTags,
            authorTags,
            collectionTags,
            collections
          );
        })
        .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
    }

    // Collections mode: show first video of each collection that has any matching video
    if (normalizedSelectedTags.length === 0) {
      return videoArray.filter((video) => {
        const videoCollections = collections.filter((c) =>
          c.videos.includes(video.id)
        );
        if (videoCollections.length === 0) return false;
        return videoCollections.some((c) => c.videos[0] === video.id);
      });
    }

    const collectionIdsWithMatch = new Set<string>();
    for (const collection of collections) {
      for (const videoId of collection.videos) {
        const video = videoArray.find((v) => v.id === videoId);
        if (
          video &&
          videoMatchesTags(
            video,
            normalizedSelectedTags,
            authorTags,
            collectionTags,
            collections
          )
        ) {
          collectionIdsWithMatch.add(collection.id);
          break;
        }
      }
    }

    return videoArray.filter((video) => {
      const videoCollections = collections.filter((c) =>
        c.videos.includes(video.id)
      );
      if (videoCollections.length === 0) return false;
      return videoCollections.some(
        (c) => collectionIdsWithMatch.has(c.id) && c.videos[0] === video.id
      );
    });
  }, [
    viewMode,
    videoArray,
    normalizedSelectedTags,
    collections,
    authorTags,
    collectionTags,
  ]);
};
