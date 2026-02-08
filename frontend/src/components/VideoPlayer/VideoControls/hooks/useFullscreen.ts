import { useEffect, useRef, useState } from "react";

export const useFullscreen = (
  videoRef: React.RefObject<HTMLVideoElement | null>
) => {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    const handleWebkitBeginFullscreen = () => {
      setIsFullscreen(true);
    };

    const handleWebkitEndFullscreen = () => {
      setIsFullscreen(false);
    };

    const videoElement = videoRef.current;

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    if (videoElement) {
      videoElement.addEventListener(
        "webkitbeginfullscreen",
        handleWebkitBeginFullscreen
      );
      videoElement.addEventListener(
        "webkitendfullscreen",
        handleWebkitEndFullscreen
      );
    }

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (videoElement) {
        videoElement.removeEventListener(
          "webkitbeginfullscreen",
          handleWebkitBeginFullscreen
        );
        videoElement.removeEventListener(
          "webkitendfullscreen",
          handleWebkitEndFullscreen
        );
      }
    };
  }, [videoRef]);

  // Handle controls visibility in fullscreen mode
  useEffect(() => {
    const startHideTimer = () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }

      if (isFullscreen) {
        setControlsVisible(true);
        hideControlsTimerRef.current = setTimeout(() => {
          setControlsVisible(false);
        }, 5000);
      } else {
        setControlsVisible(true);
        if (hideControlsTimerRef.current) {
          clearTimeout(hideControlsTimerRef.current);
        }
      }
    };

    startHideTimer();

    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [isFullscreen]);

  // Handle mouse movement to show controls in fullscreen
  useEffect(() => {
    if (!isFullscreen) return;

    const handleMouseMove = () => {
      setControlsVisible(true);

      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }

      hideControlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 5000);
    };

    const container = videoContainerRef.current;
    if (container) {
      container.addEventListener("mousemove", handleMouseMove);
      return () => {
        container.removeEventListener("mousemove", handleMouseMove);
      };
    }
  }, [isFullscreen]);

  const handleToggleFullscreen = () => {
    // Use the container that wraps both video and controls so controls stay visible in fullscreen
    const container = videoContainerRef.current;
    const videoElement = videoRef.current;

    if (!container || !videoElement) return;

    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch((err) => {
          console.error(
            `Error attempting to enable fullscreen: ${err.message}`
          );
        });
      } else if ((videoElement as any).webkitEnterFullscreen) {
        (videoElement as any).webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const handleControlsMouseEnter = () => {
    if (isFullscreen) {
      setControlsVisible(true);
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
      hideControlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 5000);
    }
  };

  return {
    isFullscreen,
    controlsVisible,
    videoContainerRef,
    handleToggleFullscreen,
    handleControlsMouseEnter,
  };
};
