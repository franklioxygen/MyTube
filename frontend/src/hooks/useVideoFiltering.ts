import { useMemo } from "react";
import { Collection, Video } from "../types";
import { ViewMode } from "./useViewMode";

const EMPTY_TAG_SET = new Set<string>();

function normalizeTag(value: string | undefined | null): string {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

function normalizeTagList(tags: string[] | undefined | null): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.map(normalizeTag).filter((tag) => tag.length > 0);
}

function hasAllSelectedTags(
  tagSet: Set<string>,
  normalizedSelectedTags: string[]
): boolean {
  for (const tag of normalizedSelectedTags) {
    if (!tagSet.has(tag)) return false;
  }
  return true;
}

function videoMatchesTags(
  video: Video,
  normalizedSelectedTags: string[],
  videoTagSetById: Map<string, Set<string>>,
  authorTagSetByAuthor: Map<string, Set<string>>,
  collectionTagSetById: Map<string, Set<string>>,
  collectionIdsByVideoId: Map<string, string[]>
): boolean {
  if (normalizedSelectedTags.length === 0) return true;

  const videoTagSet = videoTagSetById.get(video.id) ?? EMPTY_TAG_SET;
  if (hasAllSelectedTags(videoTagSet, normalizedSelectedTags)) return true;

  const authorKey = normalizeTag(video.author);
  const authorTagSet = authorTagSetByAuthor.get(authorKey);
  if (
    authorTagSet &&
    hasAllSelectedTags(authorTagSet, normalizedSelectedTags)
  ) {
    return true;
  }

  const collectionIds = collectionIdsByVideoId.get(video.id);
  if (!collectionIds) return false;

  for (const collectionId of collectionIds) {
    const collectionTagSet = collectionTagSetById.get(collectionId);
    if (
      collectionTagSet &&
      hasAllSelectedTags(collectionTagSet, normalizedSelectedTags)
    ) {
      return true;
    }
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

  const videoById = useMemo(
    () => new Map(videoArray.map((video) => [video.id, video])),
    [videoArray]
  );

  const videoTagSetById = useMemo(
    () =>
      new Map(
        videoArray.map((video) => [video.id, new Set(normalizeTagList(video.tags))])
      ),
    [videoArray]
  );

  const authorTagSetByAuthor = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!authorTags) return map;

    for (const [author, tags] of Object.entries(authorTags)) {
      map.set(normalizeTag(author), new Set(normalizeTagList(tags)));
    }
    return map;
  }, [authorTags]);

  const collectionTagSetById = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!collectionTags) return map;

    for (const [collectionId, tags] of Object.entries(collectionTags)) {
      map.set(collectionId, new Set(normalizeTagList(tags)));
    }
    return map;
  }, [collectionTags]);

  const collectionIdsByVideoId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const collection of collections) {
      for (const videoId of collection.videos) {
        const existing = map.get(videoId);
        if (existing) {
          existing.push(collection.id);
        } else {
          map.set(videoId, [collection.id]);
        }
      }
    }
    return map;
  }, [collections]);

  const firstVideoIdSet = useMemo(
    () => new Set(collections.map((collection) => collection.videos[0]).filter(Boolean)),
    [collections]
  );

  return useMemo(() => {
    if (viewMode === "all-videos") {
      return videoArray.filter((video) =>
        videoMatchesTags(
          video,
          normalizedSelectedTags,
          videoTagSetById,
          authorTagSetByAuthor,
          collectionTagSetById,
          collectionIdsByVideoId
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
            videoTagSetById,
            authorTagSetByAuthor,
            collectionTagSetById,
            collectionIdsByVideoId
          );
        })
        .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
    }

    // Collections mode: show first video of each collection that has any matching video
    if (normalizedSelectedTags.length === 0) {
      return videoArray.filter((video) => firstVideoIdSet.has(video.id));
    }

    const collectionIdsWithMatch = new Set<string>();
    for (const collection of collections) {
      for (const videoId of collection.videos) {
        const video = videoById.get(videoId);
        if (
          video &&
          videoMatchesTags(
            video,
            normalizedSelectedTags,
            videoTagSetById,
            authorTagSetByAuthor,
            collectionTagSetById,
            collectionIdsByVideoId
          )
        ) {
          collectionIdsWithMatch.add(collection.id);
          break;
        }
      }
    }

    if (collectionIdsWithMatch.size === 0) return [];

    const matchingFirstVideoIds = new Set<string>();
    for (const collection of collections) {
      if (!collectionIdsWithMatch.has(collection.id)) continue;
      const firstVideoId = collection.videos[0];
      if (firstVideoId) matchingFirstVideoIds.add(firstVideoId);
    }

    return videoArray.filter((video) => matchingFirstVideoIds.has(video.id));
  }, [
    viewMode,
    videoArray,
    normalizedSelectedTags,
    collections,
    videoById,
    videoTagSetById,
    authorTagSetByAuthor,
    collectionTagSetById,
    collectionIdsByVideoId,
    firstVideoIdSet,
  ]);
};
