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
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);
  const videoSrcRef = useRef<string>("");
  // Track if startTime has been applied for this video source
  const startTimeAppliedRef = useRef<boolean>(false);

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
    }

    if (src) {
      videoElement.preload = "metadata";
      videoElement.src = src;
      // Reset flag when setting new source (for initial load)
      if (!previousSrc) {
        startTimeAppliedRef.current = false;
      }
    }

    return () => {
      if (videoElement) {
        videoElement.pause();
        videoElement.src = "";
        videoElement.load();
      }
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
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || startTime <= 0) return;

    // If we haven't applied start time yet, or if the video is currently at 0 
    // (meaning it hasn't continued playing heavily), update the current time.
    // We check currentTime < 1 to allow for some small playback before the fetch returns,
    // but avoid jumping if the user has already watched a significant amount.
    if (!startTimeAppliedRef.current || videoElement.currentTime < 1) {
      if (typeof videoElement.fastSeek === 'function') {
        videoElement.fastSeek(startTime);
      } else {
        videoElement.currentTime = startTime;
      }
      setCurrentTime(startTime);
      startTimeAppliedRef.current = true;
    }
  }, [startTime]);

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Seek using fastSeek() on mobile for better audio sync, fallback to currentTime
  const handleSeek = useCallback((seconds: number) => {
    const videoElement = videoRef.current;
    if (!videoElement || !isFinite(videoElement.duration)) return;

    const newTime = Math.max(
      0,
      Math.min(videoElement.duration, videoElement.currentTime + seconds)
    );

    // fastSeek() is optimized for mobile - better audio/video sync during seeks
    // Falls back to currentTime if fastSeek is not available
    if (typeof videoElement.fastSeek === "function") {
      videoElement.fastSeek(newTime);
    } else {
      videoElement.currentTime = newTime;
    }
  }, []);

  const handleProgressChange = (newValue: number) => {
    if (!videoRef.current || duration <= 0 || !isFinite(duration)) return;
    const newTime = (newValue / 100) * duration;
    setCurrentTime(newTime);
  };

  const handleProgressChangeCommitted = (newValue: number) => {
    const videoElement = videoRef.current;
    if (!videoElement || duration <= 0 || !isFinite(duration)) return;

    const newTime = (newValue / 100) * duration;

    // Use fastSeek on mobile for better audio sync
    if (typeof videoElement.fastSeek === "function") {
      videoElement.fastSeek(newTime);
    } else {
      videoElement.currentTime = newTime;
    }
    setIsDragging(false);
  };

  const handleProgressMouseDown = () => {
    setIsDragging(true);
  };

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
    if (startTime > 0 && !startTimeAppliedRef.current) {
      e.currentTarget.currentTime = startTime;
      setCurrentTime(startTime);
      startTimeAppliedRef.current = true;
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

    // Only apply startTime once per video load (not on every canplay after seeks)
    if (
      startTime > 0 &&
      videoElement.currentTime === 0 &&
      !startTimeAppliedRef.current
    ) {
      videoElement.currentTime = startTime;
      setCurrentTime(startTime);
      startTimeAppliedRef.current = true;
    }
  }, [duration, startTime]);

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
    handlePlayPause,
    handleSeek,
    handleProgressChange,
    handleProgressChangeCommitted,
    handleProgressMouseDown,
    handleToggleLoop,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleCanPlay,
    handlePlay,
    handlePause,
    handleSeeking,
    handleSeeked,
  };
};
