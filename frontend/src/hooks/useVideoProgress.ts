import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Video } from "../types";
import { api, apiClient } from "../utils/apiClient";
import { parseDuration } from "../utils/formatUtils";

interface UseVideoProgressProps {
  videoId: string | undefined;
  video: Video | undefined;
}

function getViewThreshold(duration: string | undefined): number {
  const durationSeconds = parseDuration(duration);
  return durationSeconds > 0 && durationSeconds < 20 ? 4 : 10;
}

function syncVideoPlaybackCache(
  queryClient: QueryClient,
  videoId: string,
  updates: Partial<Video>,
  options: {
    syncList?: boolean;
    syncDetail?: boolean;
  } = {}
) {
  const { syncList = true, syncDetail = true } = options;

  if (syncList) {
    queryClient.setQueryData(["videos"], (old: Video[] | undefined) =>
      Array.isArray(old)
        ? old.map((item) =>
            item.id === videoId ? { ...item, ...updates } : item
          )
        : old
    );
  }

  if (syncDetail) {
    queryClient.setQueryData(["video", videoId], (old: Video | undefined) =>
      old ? { ...old, ...updates } : old
    );
  }
}

function getApiRequestUrl(path: string) {
  const baseURL = (apiClient.defaults.baseURL as string | undefined) || "/api";
  return `${baseURL.replace(/\/$/, "")}${path}`;
}

/**
 * Custom hook to manage video progress tracking and view counting
 */
export function useVideoProgress({ videoId, video }: UseVideoProgressProps) {
  const { userRole } = useAuth();
  const isVisitor = userRole === "visitor";
  const queryClient = useQueryClient();
  const [hasViewed, setHasViewed] = useState<boolean>(false);
  const lastProgressSave = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const isDeletingRef = useRef<boolean>(false);

  // Reset hasViewed when video changes
  useEffect(() => {
    setHasViewed(false);
    currentTimeRef.current = 0;
  }, [videoId]);

  // Save progress on unmount
  useEffect(() => {
    return () => {
      if (
        videoId &&
        currentTimeRef.current > 0 &&
        !isDeletingRef.current &&
        !isVisitor
      ) {
        const progress = Math.floor(currentTimeRef.current);

        syncVideoPlaybackCache(queryClient, videoId, {
          progress,
        });

        // Use fetch with keepalive to ensure request completes even if tab is closed
        fetch(getApiRequestUrl(`/videos/${videoId}/progress`), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            progress,
          }),
          keepalive: true,
          credentials: "include", // Send cookies for authentication
        }).catch((err) => {
          console.error("Error saving progress on unmount:", err);
        });
      }
    };
  }, [queryClient, videoId, isVisitor]);

  const handleTimeUpdate = (currentTime: number) => {
    currentTimeRef.current = currentTime;

    // Increment views and refresh watch history at the same threshold.
    const viewThreshold = getViewThreshold(video?.duration);
    if (currentTime >= viewThreshold && !hasViewed && videoId && !isVisitor) {
      setHasViewed(true);
      const lastPlayedAt = Date.now();
      api
        .post(`/videos/${videoId}/view`)
        .then((res) => {
          if (res.data.success) {
            syncVideoPlaybackCache(queryClient, videoId, {
              viewCount: res.data.viewCount,
              lastPlayedAt,
            });
          }
        })
        .catch((err) => {
          console.error("Error incrementing view count:", err);
        });
    }

    // Save progress every 5 seconds
    const now = Date.now();
    if (now - lastProgressSave.current > 5000 && videoId && !isVisitor) {
      lastProgressSave.current = now;
      const progress = Math.floor(currentTime);

      syncVideoPlaybackCache(queryClient, videoId, {
        progress,
      });

      api
        .put(`/videos/${videoId}/progress`, {
          progress,
        })
        .catch((err) => {
          console.error("Error saving progress:", err);
        });
    }
  };

  const setIsDeleting = (value: boolean) => {
    isDeletingRef.current = value;
  };

  return {
    handleTimeUpdate,
    setIsDeleting,
    /** Ref holding the latest playback time; use for startTime when remounting the player (e.g. cinema mode toggle). */
    currentTimeRef,
  };
}
