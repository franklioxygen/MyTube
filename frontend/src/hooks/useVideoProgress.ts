import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Video } from "../types";
import { api, sendVideoProgressWithKeepalive } from "../utils/apiClient";
import { parseDuration } from "../utils/formatUtils";
import {
  readVideoResumeProgress,
  writeVideoResumeProgress,
} from "../utils/videoResumeProgress";

interface UseVideoProgressProps {
  videoId: string | undefined;
  video: Video | undefined;
  videoElement?: HTMLVideoElement | null;
}

const PROGRESS_SAVE_INTERVAL_MS = 5000;
const LOCAL_PROGRESS_SAMPLE_INTERVAL_MS = 1000;

function getViewThreshold(duration: string | undefined): number {
  const durationSeconds = parseDuration(duration);
  return durationSeconds > 0 && durationSeconds < 20 ? 4 : 10;
}

function getResumeProgress(currentTime: number, duration: string | undefined): number {
  const progress = Math.max(0, Math.floor(currentTime));
  const durationSeconds = parseDuration(duration);

  if (durationSeconds > 1 && progress >= Math.floor(durationSeconds)) {
    return Math.max(0, Math.floor(durationSeconds) - 1);
  }

  return progress;
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

/**
 * Custom hook to manage video progress tracking and view counting
 */
export function useVideoProgress({ videoId, video, videoElement }: UseVideoProgressProps) {
  const { userRole } = useAuth();
  const isVisitor = userRole === "visitor";
  const queryClient = useQueryClient();
  const [hasViewed, setHasViewed] = useState<boolean>(false);
  const lastProgressSave = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const isDeletingRef = useRef<boolean>(false);
  const durationRef = useRef<string | undefined>(undefined);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoDuration = video?.duration;

  // Reset hasViewed when video changes
  useEffect(() => {
    setHasViewed(false);
    currentTimeRef.current = readVideoResumeProgress(videoId)?.progress ?? 0;
    // Start the periodic-save throttle now: with the initial 0 the very
    // first timeupdate saved immediately, racing the saved-progress
    // restore and overwriting the stored position with ~0.
    lastProgressSave.current = Date.now();
  }, [videoId]);

  useEffect(() => {
    if (currentTimeRef.current <= 0 && video?.progress) {
      currentTimeRef.current =
        readVideoResumeProgress(videoId)?.progress ?? video.progress;
    }
  }, [video?.progress, videoId]);

  useEffect(() => {
    durationRef.current = videoDuration;
  }, [videoDuration]);

  useEffect(() => {
    videoElementRef.current = videoElement ?? null;
  }, [videoElement]);

  const samplePlaybackTime = useCallback(() => {
    const mediaElement = videoElementRef.current;
    const sampledTime = mediaElement?.currentTime;

    if (typeof sampledTime !== "number" || !Number.isFinite(sampledTime)) {
      return currentTimeRef.current;
    }

    if (sampledTime <= 0 && currentTimeRef.current > 0) {
      return currentTimeRef.current;
    }

    currentTimeRef.current = Math.max(0, sampledTime);
    return currentTimeRef.current;
  }, []);

  const cacheProgressLocally = useCallback((playbackTime: number) => {
    const progress = getResumeProgress(playbackTime, durationRef.current);
    if (progress > 0) {
      writeVideoResumeProgress(videoId, progress);
    }
    return progress;
  }, [videoId]);

  const saveProgress = useCallback((
    playbackTime: number,
    options: { keepalive?: boolean } = {}
  ) => {
    if (!videoId || isDeletingRef.current || isVisitor) {
      return;
    }

    const progress = cacheProgressLocally(playbackTime);

    if (progress <= 0) {
      return;
    }

    syncVideoPlaybackCache(queryClient, videoId, {
      progress,
    });

    if (options.keepalive) {
      sendVideoProgressWithKeepalive(videoId, progress);
      return;
    }

    api
      .put(`/videos/${videoId}/progress`, {
        progress,
      })
      .catch((err) => {
        console.error("Error saving progress:", err);
      });
  }, [cacheProgressLocally, isVisitor, queryClient, videoId]);

  const flushSampledProgress = useCallback((options: { keepalive?: boolean } = {}) => {
    const playbackTime = samplePlaybackTime();
    saveProgress(playbackTime, options);
  }, [samplePlaybackTime, saveProgress]);

  useEffect(() => {
    if (!videoId || isVisitor || !videoElement) {
      return;
    }

    const timer = window.setInterval(() => {
      const playbackTime = samplePlaybackTime();
      cacheProgressLocally(playbackTime);

      const now = Date.now();
      if (now - lastProgressSave.current <= PROGRESS_SAVE_INTERVAL_MS) {
        return;
      }

      lastProgressSave.current = now;
      saveProgress(playbackTime);
    }, LOCAL_PROGRESS_SAMPLE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [
    cacheProgressLocally,
    isVisitor,
    samplePlaybackTime,
    saveProgress,
    videoElement,
    videoId,
  ]);

  useEffect(() => {
    if (!videoId || isVisitor || !videoElement) {
      return;
    }

    const sampleAndCache = () => {
      cacheProgressLocally(samplePlaybackTime());
    };
    const sampleAndSave = () => {
      flushSampledProgress();
    };

    videoElement.addEventListener("timeupdate", sampleAndCache);
    videoElement.addEventListener("playing", sampleAndCache);
    videoElement.addEventListener("seeked", sampleAndSave);
    videoElement.addEventListener("pause", sampleAndSave);

    return () => {
      videoElement.removeEventListener("timeupdate", sampleAndCache);
      videoElement.removeEventListener("playing", sampleAndCache);
      videoElement.removeEventListener("seeked", sampleAndSave);
      videoElement.removeEventListener("pause", sampleAndSave);
    };
  }, [
    cacheProgressLocally,
    flushSampledProgress,
    isVisitor,
    samplePlaybackTime,
    videoElement,
    videoId,
  ]);

  // Save progress when the page is hidden or discarded. Safari can defer
  // timeupdate events for very large WebM files, so sample the media element.
  useEffect(() => {
    if (!videoId || isVisitor) {
      return;
    }

    const flushWithKeepalive = () => {
      flushSampledProgress({ keepalive: true });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushWithKeepalive();
      }
    };

    window.addEventListener("pagehide", flushWithKeepalive);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushWithKeepalive);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushSampledProgress, isVisitor, videoId]);

  // Save progress on unmount
  useEffect(() => {
    return () => {
      flushSampledProgress({ keepalive: true });
    };
  }, [flushSampledProgress]);

  const handleTimeUpdate = (currentTime: number) => {
    currentTimeRef.current = currentTime;
    cacheProgressLocally(currentTime);

    // Increment views and refresh watch history at the same threshold.
    const viewThreshold = getViewThreshold(videoDuration);
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
    if (now - lastProgressSave.current > PROGRESS_SAVE_INTERVAL_MS && videoId && !isVisitor) {
      lastProgressSave.current = now;
      saveProgress(currentTime);
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
