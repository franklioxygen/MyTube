import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Video } from "../types";
import { api, sendVideoProgressWithKeepalive } from "../utils/apiClient";
import { SPEED_OPTIONS } from "../utils/constants";
import { parseDuration } from "../utils/formatUtils";
import {
  getBestVideoResumeProgress,
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
const RESTORE_GUARD_MIN_PROGRESS_SECONDS = 30;
const RESTORE_GUARD_TOLERANCE_SECONDS = 2;
const FASTEST_PLAYBACK_RATE = Math.max(...SPEED_OPTIONS);
// Position step always accepted as playback: one on-time sample at the fastest
// speed, plus jitter. It stays below the smallest view threshold, so a jump with
// no seek signal cannot earn a view while samples arrive on time.
const BASE_PLAYBACK_STEP_SECONDS = 3.5;

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
  const lastProgressSave = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const isDeletingRef = useRef<boolean>(false);
  const durationRef = useRef<string | undefined>(undefined);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const resumeGuardTargetRef = useRef<number>(0);
  const resumeGuardObservedRef = useRef<boolean>(true);
  const playedSecondsRef = useRef<number>(0);
  const lastPlaybackTimeRef = useRef<number>(0);
  const lastPlaybackSampleAtRef = useRef<number>(0);
  const seekPendingRef = useRef<boolean>(false);
  const viewCountedRef = useRef<boolean>(false);
  const videoDuration = video?.duration;

  useEffect(() => {
    const storedProgress = readVideoResumeProgress(videoId)?.progress ?? 0;
    currentTimeRef.current = storedProgress;
    lastPlaybackTimeRef.current = storedProgress;
    lastPlaybackSampleAtRef.current = Date.now();
    playedSecondsRef.current = 0;
    seekPendingRef.current = false;
    viewCountedRef.current = false;
    resumeGuardTargetRef.current =
      storedProgress > RESTORE_GUARD_MIN_PROGRESS_SECONDS ? storedProgress : 0;
    resumeGuardObservedRef.current =
      resumeGuardTargetRef.current <= RESTORE_GUARD_MIN_PROGRESS_SECONDS;
    // Start the periodic-save throttle now: with the initial 0 the very
    // first timeupdate saved immediately, racing the saved-progress
    // restore and overwriting the stored position with ~0.
    lastProgressSave.current = Date.now();
  }, [videoId]);

  useEffect(() => {
    const resumeProgress = getBestVideoResumeProgress(
      videoId,
      video?.progress,
      video?.progressUpdatedAt ?? video?.lastPlayedAt
    );

    if (
      currentTimeRef.current <= 0 ||
      currentTimeRef.current < resumeProgress ||
      !resumeGuardObservedRef.current
    ) {
      currentTimeRef.current = resumeProgress;
      lastPlaybackTimeRef.current = resumeProgress;
      resumeGuardTargetRef.current =
        resumeProgress > RESTORE_GUARD_MIN_PROGRESS_SECONDS
          ? resumeProgress
          : 0;
      resumeGuardObservedRef.current =
        resumeGuardTargetRef.current <= RESTORE_GUARD_MIN_PROGRESS_SECONDS;
    }
  }, [video?.lastPlayedAt, video?.progress, video?.progressUpdatedAt, videoId]);

  useEffect(() => {
    durationRef.current = videoDuration;
  }, [videoDuration]);

  useEffect(() => {
    videoElementRef.current = videoElement ?? null;
  }, [videoElement]);

  const getTrustedPlaybackTime = useCallback((playbackTime: number) => {
    if (typeof playbackTime !== "number" || !Number.isFinite(playbackTime)) {
      return null;
    }

    const safeTime = Math.max(0, playbackTime);
    const resumeTarget = resumeGuardTargetRef.current;

    if (
      resumeTarget > RESTORE_GUARD_MIN_PROGRESS_SECONDS &&
      !resumeGuardObservedRef.current
    ) {
      if (safeTime + RESTORE_GUARD_TOLERANCE_SECONDS >= resumeTarget) {
        resumeGuardObservedRef.current = true;
      } else {
        return null;
      }
    }

    return safeTime;
  }, []);

  // Increment views and refresh watch history at the same threshold. Compare
  // time played this visit, not the position: restoring saved progress lands
  // past the threshold without playing anything.
  const countViewIfPlayed = useCallback(() => {
    if (
      !videoId ||
      isVisitor ||
      isDeletingRef.current ||
      viewCountedRef.current ||
      playedSecondsRef.current < getViewThreshold(durationRef.current)
    ) {
      return;
    }

    viewCountedRef.current = true;
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
  }, [isVisitor, queryClient, videoId]);

  // Add up what this visit actually played. Only small forward steps count, so
  // restoring saved progress, seeking and looping back add nothing. `seeking` is
  // checked alongside the event because it flips as soon as currentTime is
  // written, while the event is queued and a sample can land in between. Every
  // sampling path lands here, so a deferred timeupdate cannot hold back a view.
  const recordPlaybackStep = useCallback((playbackTime: number) => {
    const mediaIsSeeking = videoElementRef.current?.seeking;
    const isSeek = seekPendingRef.current || mediaIsSeeking;
    const step = isSeek ? 0 : playbackTime - lastPlaybackTimeRef.current;
    // Throttled timers can deliver a sample late, so it may cover more ground.
    const now = Date.now();
    const maxStep = Math.max(
      BASE_PLAYBACK_STEP_SECONDS,
      ((now - lastPlaybackSampleAtRef.current) / 1000) * FASTEST_PLAYBACK_RATE
    );
    // Safari can report the old position for a whole seek, so a sample taken
    // mid-seek leaves the first sample after it to pick up the seek target.
    seekPendingRef.current = Boolean(mediaIsSeeking);
    lastPlaybackTimeRef.current = playbackTime;
    lastPlaybackSampleAtRef.current = now;

    if (step > 0 && step <= maxStep) {
      playedSecondsRef.current += step;
      countViewIfPlayed();
    }
  }, [countViewIfPlayed]);

  const samplePlaybackTime = useCallback(() => {
    const mediaElement = videoElementRef.current;
    const sampledTime = mediaElement?.currentTime;
    const trustedTime =
      typeof sampledTime === "number" && Number.isFinite(sampledTime)
        ? getTrustedPlaybackTime(sampledTime)
        : null;

    if (trustedTime === null) {
      return currentTimeRef.current;
    }

    if (trustedTime <= 0 && currentTimeRef.current > 0) {
      return currentTimeRef.current;
    }

    recordPlaybackStep(trustedTime);
    currentTimeRef.current = trustedTime;
    return currentTimeRef.current;
  }, [getTrustedPlaybackTime, recordPlaybackStep]);

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

    const progressUpdatedAt = Date.now();
    syncVideoPlaybackCache(queryClient, videoId, {
      progress,
      progressUpdatedAt,
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
    // The next sample lands on the seek target, so it must not count as played,
    // however small the jump.
    const markSeekPending = () => {
      seekPendingRef.current = true;
    };

    // The React onTimeUpdate handler already caches on every "timeupdate", so we
    // do not listen for it again here (doing so double-wrote localStorage on each
    // tick). "playing" backfills the cache when playback resumes, and the 1s
    // interval covers Safari's deferred-timeupdate case.
    videoElement.addEventListener("playing", sampleAndCache);
    videoElement.addEventListener("seeking", markSeekPending);
    videoElement.addEventListener("seeked", sampleAndSave);
    videoElement.addEventListener("pause", sampleAndSave);

    return () => {
      videoElement.removeEventListener("playing", sampleAndCache);
      videoElement.removeEventListener("seeking", markSeekPending);
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

  const handleTimeUpdate = (
    currentTime: number,
    options: { seeked?: boolean } = {}
  ) => {
    // The player suppresses onTimeUpdate while a saved-progress seek is still
    // pending, so any value delivered here is authoritative: the restore has
    // completed, or the user seeked/started somewhere else. Release the sampling
    // guard so the deferred-sample paths (native events, interval, pagehide)
    // track the live position instead of holding the previous resume point.
    resumeGuardObservedRef.current = true;

    const trustedCurrentTime = getTrustedPlaybackTime(currentTime);
    if (trustedCurrentTime === null) {
      return;
    }

    // The compatibility player has no media element to hear "seeking" from, so
    // it flags its seeks here instead.
    if (options.seeked) {
      seekPendingRef.current = true;
    }
    recordPlaybackStep(trustedCurrentTime);
    currentTimeRef.current = trustedCurrentTime;
    cacheProgressLocally(trustedCurrentTime);

    // Save progress every 5 seconds
    const now = Date.now();
    if (now - lastProgressSave.current > PROGRESS_SAVE_INTERVAL_MS && videoId && !isVisitor) {
      lastProgressSave.current = now;
      saveProgress(trustedCurrentTime);
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
