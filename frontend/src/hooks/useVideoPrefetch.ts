import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { Video } from "../types";
import { api } from "../utils/apiClient";
import { getFileUrl, isCloudStoragePath } from "../utils/cloudStorage";

interface UseVideoPrefetchProps {
  videoId: string;
  video?: Video; // Optional video object for cloud storage URL prefetching
}

/**
 * Hook to prefetch video details and cloud storage URLs
 * Supports both hover-based and IntersectionObserver-based prefetching
 */
export const useVideoPrefetch = ({ videoId, video }: UseVideoPrefetchProps) => {
  const queryClient = useQueryClient();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hasPrefetchedRef = useRef(false);

  const prefetchVideo = useCallback(() => {
    // Prevent duplicate prefetching
    if (hasPrefetchedRef.current) {
      return;
    }

    // Prefetch video details
    queryClient.prefetchQuery({
      queryKey: ["video", videoId],
      queryFn: async () => {
        const response = await api.get(`/videos/${videoId}`);
        return response.data;
      },
      staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
    });

    // Prefetch cloud storage URLs if video is in cloud storage
    if (video) {
      const isVideoInCloud = video.videoPath?.startsWith("cloud:") ?? false;

      if (isVideoInCloud && video.videoPath) {
        // Prefetch video URL
        getFileUrl(video.videoPath, "video").catch((error) => {
          console.warn("Failed to prefetch video URL:", error);
        });

        // Prefetch thumbnail URL if available
        if (video.thumbnailPath && isCloudStoragePath(video.thumbnailPath)) {
          getFileUrl(video.thumbnailPath, "thumbnail").catch((error) => {
            console.warn("Failed to prefetch thumbnail URL:", error);
          });
        }
      }
    }

    hasPrefetchedRef.current = true;
  }, [videoId, video, queryClient]);

  // Set up IntersectionObserver for viewport-based prefetching
  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;

    // Only use IntersectionObserver if supported
    if (!("IntersectionObserver" in window)) {
      return;
    }

    // Reset prefetch flag when video changes
    hasPrefetchedRef.current = false;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // Prefetch when card enters viewport (with a small margin)
          if (entry.isIntersecting && !hasPrefetchedRef.current) {
            prefetchVideo();
          }
        });
      },
      {
        // Start prefetching when card is 200px away from viewport
        rootMargin: "200px",
        threshold: 0.01, // Trigger as soon as any part is visible
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [prefetchVideo]);

  return {
    prefetchVideo,
    cardRef,
  };
};
