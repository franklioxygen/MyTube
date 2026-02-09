import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Video } from "../types";
import { api, apiClient } from "../utils/apiClient";

interface UseVideoProgressProps {
  videoId: string | undefined;
  video: Video | undefined;
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
  const getApiRequestUrl = (path: string) => {
    const baseURL = (apiClient.defaults.baseURL as string | undefined) || "/api";
    return `${baseURL.replace(/\/$/, "")}${path}`;
  };

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
        // Use fetch with keepalive to ensure request completes even if tab is closed
        fetch(getApiRequestUrl(`/videos/${videoId}/progress`), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            progress: Math.floor(currentTimeRef.current),
          }),
          keepalive: true,
          credentials: "include", // Send cookies for authentication
        }).catch((err) =>
          console.error("Error saving progress on unmount:", err)
        );
      }
    };
  }, [videoId, isVisitor]);

  const handleTimeUpdate = (currentTime: number) => {
    currentTimeRef.current = currentTime;

    // Increment view count after 10 seconds
    if (currentTime > 10 && !hasViewed && videoId && !isVisitor) {
      setHasViewed(true);
      api
        .post(`/videos/${videoId}/view`)
        .then((res) => {
          if (res.data.success && video) {
            queryClient.setQueryData(
              ["video", videoId],
              (old: Video | undefined) =>
                old ? { ...old, viewCount: res.data.viewCount } : old,
            );
          }
        })
        .catch((err) => console.error("Error incrementing view count:", err));
    }

    // Save progress every 5 seconds
    const now = Date.now();
    if (now - lastProgressSave.current > 5000 && videoId && !isVisitor) {
      lastProgressSave.current = now;
      api
        .put(`/videos/${videoId}/progress`, {
          progress: Math.floor(currentTime),
        })
        .catch((err) => console.error("Error saving progress:", err));
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
