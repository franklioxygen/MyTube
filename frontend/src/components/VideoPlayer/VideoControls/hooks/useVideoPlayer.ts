import { useCallback, useEffect, useRef, useState } from "react";

interface UseVideoPlayerProps {
  src: string;
  autoPlay?: boolean;
  autoLoop?: boolean;
  startTime?: number;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (duration: number) => void;
}

const START_TIME_APPLY_TOLERANCE_SECONDS = 1;
const START_TIME_RETRY_INTERVAL_MS = 1500;
const END_SEEK_GUARD_SECONDS = 0.25;
const FRAME_STEP_SECONDS = 1 / 30;

export const useVideoPlayer = ({
  src,
  autoPlay = false,
  autoLoop = false,
  startTime = 0,
  onTimeUpdate,
  onLoadedMetadata,
}: UseVideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [loopOverride, setLoopOverride] = useState<boolean | null>(null);
  const isLooping = loopOverride ?? autoLoop;
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);
  const videoSrcRef = useRef<string>("");
  // Track if startTime has been applied for this video source
  const startTimeAppliedRef = useRef<boolean>(false);
  // Track last applied startTime so we apply again when it updates (e.g. progress loaded after initial render)
  const lastAppliedStartTimeRef = useRef<number>(-1);
  const pendingStartTimeRestoreRef = useRef<number | null>(null);
  const lastStartTimeRetryAtRef = useRef<number>(0);

  const getMaxPlayableTime = useCallback((videoDuration: number): number => {
    if (!isFinite(videoDuration) || videoDuration <= 0) {
      return 0;
    }

    return Math.max(0, videoDuration - END_SEEK_GUARD_SECONDS);
  }, []);

  const clampPlaybackTime = useCallback(
    (time: number, videoDuration: number): number => {
      if (!isFinite(time) || time <= 0) {
        return 0;
      }
      if (!isFinite(videoDuration) || videoDuration <= 0) {
        return time;
      }

      return Math.max(0, Math.min(time, getMaxPlayableTime(videoDuration)));
    },
    [getMaxPlayableTime]
  );

  const seekTo = useCallback((
    videoElement: HTMLVideoElement,
    time: number,
    // The end guard keeps ordinary seeks and progress restores off the last
    // quarter second, where landing fires 'ended'. Frame stepping has to be
    // able to reach that region - inspecting the final frames is the point -
    // so it opts out and brings its own clamp.
    options: { skipEndGuard?: boolean } = {}
  ) => {
    const safeTime = options.skipEndGuard
      ? Math.max(0, Math.min(time, videoElement.duration))
      : clampPlaybackTime(time, videoElement.duration);

    // Issue exactly one seek, via currentTime only. Pairing fastSeek()
    // with a currentTime assignment queues two seek operations, and
    // Safari's linear WebM loader restarts its full-file download for
    // each one. fastSeek() alone is not an option either: Safari
    // silently ignores it for the saved-progress seek issued right
    // after loadedmetadata, so playback would start from the beginning.
    videoElement.currentTime = safeTime;
    setCurrentTime(safeTime);
    return safeTime;
  }, [clampPlaybackTime]);

  const markStartTimeRestorePending = useCallback((targetTime: number) => {
    startTimeAppliedRef.current = true;
    lastAppliedStartTimeRef.current = targetTime;
    pendingStartTimeRestoreRef.current = targetTime;
    lastStartTimeRetryAtRef.current = 0;
  }, []);

  const applyStartTime = useCallback(
    (videoElement: HTMLVideoElement, targetTime: number) => {
      const appliedTime = seekTo(videoElement, targetTime);
      markStartTimeRestorePending(appliedTime);
    },
    [markStartTimeRestorePending, seekTo]
  );

  const clearPendingStartTimeRestore = useCallback(() => {
    pendingStartTimeRestoreRef.current = null;
    lastStartTimeRetryAtRef.current = 0;
  }, []);

  const isAtOrPastStartTimeRestore = useCallback((time: number, targetTime: number) => {
    return time + START_TIME_APPLY_TOLERANCE_SECONDS >= targetTime;
  }, []);

  const retryPendingStartTimeRestore = useCallback(
    (videoElement: HTMLVideoElement) => {
      const targetTime = pendingStartTimeRestoreRef.current;
      if (targetTime === null) {
        return;
      }

      const currentTime = videoElement.currentTime;
      if (isAtOrPastStartTimeRestore(currentTime, targetTime)) {
        clearPendingStartTimeRestore();
        return;
      }

      const now = Date.now();
      if (
        lastStartTimeRetryAtRef.current > 0 &&
        now - lastStartTimeRetryAtRef.current < START_TIME_RETRY_INTERVAL_MS
      ) {
        return;
      }

      lastStartTimeRetryAtRef.current = now;
      seekTo(videoElement, targetTime);
    },
    [clearPendingStartTimeRestore, isAtOrPastStartTimeRestore, seekTo]
  );

  const suppressUntilStartTimeRestored = useCallback(
    (videoElement: HTMLVideoElement, time: number): boolean => {
      const targetTime = pendingStartTimeRestoreRef.current;
      if (targetTime === null) {
        return false;
      }

      if (isAtOrPastStartTimeRestore(time, targetTime)) {
        clearPendingStartTimeRestore();
        return false;
      }

      retryPendingStartTimeRestore(videoElement);
      return true;
    },
    [
      clearPendingStartTimeRestore,
      isAtOrPastStartTimeRestore,
      retryPendingStartTimeRestore,
    ]
  );

  const shouldApplyStartTime = useCallback(
    (videoElement: HTMLVideoElement) => {
      if (startTime <= 0) return false;

      if (lastAppliedStartTimeRef.current === startTime) {
        return false;
      }

      const isNearBeginning =
        videoElement.currentTime < START_TIME_APPLY_TOLERANCE_SECONDS;
      const isNearPreviousStartTime =
        lastAppliedStartTimeRef.current > 0 &&
        Math.abs(videoElement.currentTime - lastAppliedStartTimeRef.current) <
          START_TIME_APPLY_TOLERANCE_SECONDS;

      if (!startTimeAppliedRef.current) {
        return isNearBeginning;
      }

      return isNearPreviousStartTime;
    },
    [startTime]
  );

  // Memory management: Clean up video source when component unmounts or src changes
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const previousSrc = videoSrcRef.current;
    videoSrcRef.current = src;

    if (previousSrc && previousSrc !== src) {
      videoElement.pause();
      videoElement.src = "";
      videoElement.load();
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setIsDragging(false);
      setIsSeeking(false);
      // Reset startTime flag for new video
      startTimeAppliedRef.current = false;
      lastAppliedStartTimeRef.current = -1;
      clearPendingStartTimeRestore();
    }

    if (src) {
      // preload is governed by the <video preload> prop in VideoElement;
      // overriding it here would defeat the adaptive preload strategy.
      videoElement.src = src;
      // Reset flag when setting new source (for initial load)
      if (!previousSrc) {
        startTimeAppliedRef.current = false;
        lastAppliedStartTimeRef.current = -1;
        clearPendingStartTimeRestore();
      }
    }

    return () => {
      videoElement.pause();
      videoElement.src = "";
      videoElement.load();
    };
  }, [clearPendingStartTimeRestore, src]);

  useEffect(() => {
    if (videoRef.current) {
      if (autoPlay) {
        videoRef.current.autoplay = true;
      }
      videoRef.current.loop = isLooping;
    }
  }, [autoPlay, isLooping]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const handleDurationChange = () => {
      setDuration(videoElement.duration);
    };

    videoElement.addEventListener("durationchange", handleDurationChange);
    return () => {
      videoElement.removeEventListener("durationchange", handleDurationChange);
    };
  }, [videoRef]);

  // Handle startTime changes (e.g. async fetch of saved progress)
  // When startTime updates from 0 to a positive value (e.g. video.progress loaded after initial render),
  // we must apply it even if the video has already started playing from 0.
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || startTime <= 0) return;

    if (shouldApplyStartTime(videoElement)) {
      applyStartTime(videoElement, startTime);
    }
  }, [applyStartTime, shouldApplyStartTime, startTime]);

  const handlePlayPause = () => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    if (isPlaying) {
      videoElement.pause();
    } else {
      void videoElement.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = useCallback((seconds: number) => {
    const videoElement = videoRef.current;
    if (!videoElement || !isFinite(videoElement.duration)) return;

    const newTime = Math.max(
      0,
      Math.min(videoElement.duration, videoElement.currentTime + seconds)
    );

    clearPendingStartTimeRestore();
    seekTo(videoElement, newTime);
  }, [clearPendingStartTimeRestore, seekTo]);

  // A single frame step. HTMLVideoElement exposes no frame rate, so this
  // assumes 30fps like every other web player has to; the point of the
  // shortcut is inspecting a still, not exact frame accounting. Stepping
  // pauses first - a moving picture would swallow the step.
  const handleFrameStep = useCallback(
    (direction: -1 | 1) => {
      const videoElement = videoRef.current;
      if (!videoElement || !isFinite(videoElement.duration)) return;

      if (!videoElement.paused) {
        videoElement.pause();
        setIsPlaying(false);
      }

      // Stop one frame short of the duration: landing exactly on it ends
      // playback rather than showing the last frame.
      const lastFrameTime = Math.max(0, videoElement.duration - FRAME_STEP_SECONDS);
      const newTime = Math.max(
        0,
        Math.min(
          lastFrameTime,
          videoElement.currentTime + direction * FRAME_STEP_SECONDS
        )
      );

      clearPendingStartTimeRestore();
      seekTo(videoElement, newTime, { skipEndGuard: true });
    },
    [clearPendingStartTimeRestore, seekTo]
  );

  const handleProgressChange = (newTime: number) => {
    if (!videoRef.current || duration <= 0 || !isFinite(duration)) return;
    setCurrentTime(clampPlaybackTime(newTime, duration));
  };

  const handleProgressChangeCommitted = (newTime: number) => {
    const videoElement = videoRef.current;
    if (!videoElement || duration <= 0 || !isFinite(duration)) return;

    clearPendingStartTimeRestore();
    seekTo(videoElement, newTime);
    setIsDragging(false);
  };

  const handleProgressMouseDown = () => {
    setIsDragging(true);
  };

  const handlePlaybackRateChange = useCallback((rate: number) => {
    const videoElement = videoRef.current;
    if (videoElement) {
      videoElement.playbackRate = rate;
    }
    setPlaybackRate(rate);
  }, []);

  const handleToggleLoop = () => {
    if (videoRef.current) {
      const newState = !isLooping;
      videoRef.current.loop = newState;
      setLoopOverride(newState);
      return newState;
    }
    return isLooping;
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const time = e.currentTarget.currentTime;

    // Don't update UI during dragging or seeking
    if (isDragging || isSeeking) {
      return;
    }

    // Drop pre-restore ticks. Safari can accept a currentTime assignment for
    // a large WebM and still keep reporting playback near zero until its
    // linear loader catches up. Do not publish those low ticks as real
    // progress; retry the restore seek instead.
    if (
      startTime > 0 &&
      !startTimeAppliedRef.current &&
      time < START_TIME_APPLY_TOLERANCE_SECONDS
    ) {
      return;
    }
    if (suppressUntilStartTimeRestored(e.currentTarget, time)) {
      return;
    }

    setCurrentTime(time);

    if (onTimeUpdate) {
      onTimeUpdate(time);
    }
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const videoDuration = e.currentTarget.duration;
    if (videoDuration && isFinite(videoDuration) && videoDuration > 0) {
      setDuration(videoDuration);
    }
    if (shouldApplyStartTime(e.currentTarget)) {
      applyStartTime(e.currentTarget, startTime);
    }
    if (onLoadedMetadata) {
      onLoadedMetadata(videoDuration);
    }
  };

  const handleCanPlay = useCallback(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    if (
      videoElement.duration &&
      isFinite(videoElement.duration) &&
      videoElement.duration > 0
    ) {
      if (
        duration === 0 ||
        (videoElement.duration > duration &&
          videoElement.duration < duration * 1.1)
      ) {
        setDuration(videoElement.duration);
      }
    }

    // Apply startTime when not yet applied or when it updated (e.g. progress loaded after first paint)
    if (shouldApplyStartTime(videoElement)) {
      applyStartTime(videoElement, startTime);
    } else {
      retryPendingStartTimeRestore(videoElement);
    }
  }, [
    applyStartTime,
    duration,
    retryPendingStartTimeRestore,
    shouldApplyStartTime,
    startTime,
  ]);

  const handlePlay = () => {
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleSeeking = useCallback(() => {
    setIsSeeking(true);
  }, []);

  const handleSeeked = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const time = e.currentTarget.currentTime;
      setIsSeeking(false);
      if (suppressUntilStartTimeRestored(e.currentTarget, time)) {
        return;
      }
      setCurrentTime(time);

      if (onTimeUpdate) {
        onTimeUpdate(time);
      }
    },
    [onTimeUpdate, suppressUntilStartTimeRestored]
  );

  return {
    videoRef,
    isPlaying,
    isLooping,
    currentTime,
    duration,
    isDragging,
    playbackRate,
    handlePlayPause,
    handleSeek,
    handleFrameStep,
    handleProgressChange,
    handleProgressChangeCommitted,
    handleProgressMouseDown,
    handleToggleLoop,
    handlePlaybackRateChange,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleCanPlay,
    handlePlay,
    handlePause,
    handleSeeking,
    handleSeeked,
  };
};
