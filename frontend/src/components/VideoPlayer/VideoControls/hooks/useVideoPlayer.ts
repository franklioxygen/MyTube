import { useCallback, useEffect, useRef, useState } from "react";

interface UseVideoPlayerProps {
  src: string;
  autoPlay?: boolean;
  autoLoop?: boolean;
  startTime?: number;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (duration: number) => void;
}

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
  const [isLooping, setIsLooping] = useState<boolean>(autoLoop);
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
  const START_TIME_APPLY_TOLERANCE_SECONDS = 1;
  const END_SEEK_GUARD_SECONDS = 0.25;

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

  const seekTo = useCallback((videoElement: HTMLVideoElement, time: number) => {
    const safeTime = clampPlaybackTime(time, videoElement.duration);

    if (typeof videoElement.fastSeek === "function") {
      videoElement.fastSeek(safeTime);
    }
    videoElement.currentTime = safeTime;
    setCurrentTime(safeTime);
  }, [clampPlaybackTime]);

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
    }

    if (src) {
      videoElement.preload = "metadata";
      videoElement.src = src;
      // Reset flag when setting new source (for initial load)
      if (!previousSrc) {
        startTimeAppliedRef.current = false;
        lastAppliedStartTimeRef.current = -1;
      }
    }

    return () => {
      videoElement.pause();
      videoElement.src = "";
      videoElement.load();
    };
  }, [src]);

  useEffect(() => {
    if (videoRef.current) {
      if (autoPlay) {
        videoRef.current.autoplay = true;
      }
      if (autoLoop) {
        videoRef.current.loop = true;
        setIsLooping(true);
      }
    }
  }, [autoPlay, autoLoop]);

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
      seekTo(videoElement, startTime);
      startTimeAppliedRef.current = true;
      lastAppliedStartTimeRef.current = startTime;
    }
  }, [seekTo, shouldApplyStartTime, startTime]);

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

  // Seek using fastSeek() on mobile for better audio sync, fallback to currentTime
  const handleSeek = useCallback((seconds: number) => {
    const videoElement = videoRef.current;
    if (!videoElement || !isFinite(videoElement.duration)) return;

    const newTime = Math.max(
      0,
      Math.min(videoElement.duration, videoElement.currentTime + seconds)
    );

    seekTo(videoElement, newTime);
  }, [seekTo]);

  const handleProgressChange = (newTime: number) => {
    if (!videoRef.current || duration <= 0 || !isFinite(duration)) return;
    setCurrentTime(clampPlaybackTime(newTime, duration));
  };

  const handleProgressChangeCommitted = (newTime: number) => {
    const videoElement = videoRef.current;
    if (!videoElement || duration <= 0 || !isFinite(duration)) return;

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
      setIsLooping(newState);
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
      seekTo(e.currentTarget, startTime);
      startTimeAppliedRef.current = true;
      lastAppliedStartTimeRef.current = startTime;
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
      seekTo(videoElement, startTime);
      startTimeAppliedRef.current = true;
      lastAppliedStartTimeRef.current = startTime;
    }
  }, [duration, seekTo, shouldApplyStartTime, startTime]);

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
      setCurrentTime(time);

      if (onTimeUpdate) {
        onTimeUpdate(time);
      }
    },
    [onTimeUpdate]
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
