import { useCallback, useEffect, useRef, useState } from "react";

interface UseVideoPlayerProps {
  src: string;
  autoPlay?: boolean;
  autoLoop?: boolean;
  startTime?: number;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (duration: number) => void;
  // onEnded is passed through to the video element via the component, not used in this hook
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
  const videoSrcRef = useRef<string>("");

  // Memory management: Clean up video source when component unmounts or src changes
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    // Store previous src for cleanup
    const previousSrc = videoSrcRef.current;
    videoSrcRef.current = src;

    // Clean up previous source to free memory
    if (previousSrc && previousSrc !== src) {
      videoElement.pause();
      videoElement.src = "";
      videoElement.load();
      // Reset state when src changes to prevent stale data flash
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setIsDragging(false);
    }

    // Set new source
    if (src) {
      videoElement.preload = "metadata";
      videoElement.src = src;
    }

    return () => {
      // Cleanup on unmount
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

  // Listen for duration changes
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const handleDurationChange = () => {
      const videoDuration = videoElement.duration;
      setDuration(videoDuration);
    };

    videoElement.addEventListener("durationchange", handleDurationChange);
    return () => {
      videoElement.removeEventListener("durationchange", handleDurationChange);
    };
  }, [videoRef]); // Include videoRef to ensure listener is attached when ref is ready

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

  const handleSeek = useCallback((seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime += seconds;
    }
  }, []); // videoRef is stable, no dependencies needed

  const handleProgressChange = (newValue: number) => {
    if (!videoRef.current || duration <= 0 || !isFinite(duration)) return;
    const newTime = (newValue / 100) * duration;
    setCurrentTime(newTime);
  };

  const handleProgressChangeCommitted = (newValue: number) => {
    if (videoRef.current && duration > 0 && isFinite(duration)) {
      const newTime = (newValue / 100) * duration;
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      setIsDragging(false);
    }
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
    if (!isDragging) {
      setCurrentTime(time);
    }
    if (onTimeUpdate) {
      onTimeUpdate(time);
    }
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const videoDuration = e.currentTarget.duration;
    // Only set duration if it's valid and finite
    if (videoDuration && isFinite(videoDuration) && videoDuration > 0) {
      setDuration(videoDuration);
    }
    if (startTime > 0) {
      e.currentTarget.currentTime = startTime;
      setCurrentTime(startTime);
    }
    if (onLoadedMetadata) {
      onLoadedMetadata(videoDuration);
    }
  };

  // Handle canPlay event - video can start playing even if metadata isn't fully loaded
  const handleCanPlay = useCallback(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    // Try to get duration from video element (may be available even if metadata isn't fully loaded)
    if (videoElement.duration && isFinite(videoElement.duration) && videoElement.duration > 0) {
      // Only update if we don't have duration yet or if the new duration is more accurate
      if (duration === 0 || (videoElement.duration > duration && videoElement.duration < duration * 1.1)) {
        setDuration(videoElement.duration);
      }
    }

    // Set start time if needed
    if (startTime > 0 && videoElement.currentTime === 0) {
      videoElement.currentTime = startTime;
      setCurrentTime(startTime);
    }
  }, [duration, startTime]);

  const handlePlay = () => {
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

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
  };
};
