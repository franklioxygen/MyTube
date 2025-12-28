import { useMemo } from "react";
import { Collection, Video } from "../types";
import { ViewMode } from "./useViewMode";

interface UseVideoFilteringProps {
  videos: Video[];
  viewMode: ViewMode;
  selectedTags: string[];
  collections: Collection[];
}

export const useVideoFiltering = ({
  videos,
  viewMode,
  selectedTags,
  collections,
}: UseVideoFilteringProps): Video[] => {
  // Add default empty array to ensure videos is always an array
  const videoArray = Array.isArray(videos) ? videos : [];

  return useMemo(() => {
    if (viewMode === "all-videos") {
      return videoArray.filter((video) => {
        // In all-videos mode, only apply tag filtering
        if (selectedTags.length > 0) {
          const videoTags = video.tags || [];
          return selectedTags.every((tag) => videoTags.includes(tag));
        }
        return true;
      });
    }

    if (viewMode === "history") {
      return videoArray
        .filter((video) => {
          // Must have lastPlayedAt
          if (!video.lastPlayedAt) return false;

          // Apply tag filtering if tags are selected
          if (selectedTags.length > 0) {
            const videoTags = video.tags || [];
            return selectedTags.every((tag) => videoTags.includes(tag));
          }

          return true;
        })
        .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
    }

    // Collections mode
    return videoArray.filter((video) => {
      // In collections mode, show only first video from each collection
      // Tag filtering
      if (selectedTags.length > 0) {
        const videoTags = video.tags || [];
        const hasMatchingTag = selectedTags.every((tag) =>
          videoTags.includes(tag)
        );
        if (!hasMatchingTag) return false;
      }

      // If the video is not in any collection, show it
      const videoCollections = collections.filter((collection) =>
        collection.videos.includes(video.id)
      );

      if (videoCollections.length === 0) {
        return false;
      }

      // For each collection this video is in, check if it's the first video
      return videoCollections.some((collection) => {
        // Get the first video ID in this collection
        const firstVideoId = collection.videos[0];
        // Show this video if it's the first in at least one collection
        return video.id === firstVideoId;
      });
    });
  }, [viewMode, videoArray, selectedTags, collections]);
};
