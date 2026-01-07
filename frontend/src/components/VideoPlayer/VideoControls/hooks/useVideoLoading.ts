import { useEffect, useRef, useState } from "react";

export const useVideoLoading = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, []);

  const startLoading = () => {
    setIsLoading(true);
    setLoadError(null);

    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }

    // Set a timeout for loading (30 seconds for large files)
    loadTimeoutRef.current = setTimeout(() => {
      setLoadError(
        "Video is taking too long to load. Please try again or check your connection."
      );
      setIsLoading(false);
    }, 30000);
  };

  const stopLoading = () => {
    setIsLoading(false);
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  };

  const setError = (error: string | null) => {
    setIsLoading(false);
    setLoadError(error);
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  };

  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    console.error("Video error:", e);
    setIsLoading(false);
    const videoElement = e.currentTarget;
    if (videoElement.error) {
      console.error("Video error code:", videoElement.error.code);
      console.error("Video error message:", videoElement.error.message);
      let errorMessage = "Failed to load video.";
      switch (videoElement.error?.code) {
        case 1: // MEDIA_ERR_ABORTED
          errorMessage = "Video loading was aborted.";
          break;
        case 2: // MEDIA_ERR_NETWORK
          errorMessage =
            "Network error while loading video. Please check your connection.";
          break;
        case 3: // MEDIA_ERR_DECODE
          errorMessage = "Video decoding error. The file may be corrupted.";
          break;
        case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
          errorMessage = "Video format not supported.";
          break;
      }
      setLoadError(errorMessage);
    }
  };

  return {
    isLoading,
    loadError,
    startLoading,
    stopLoading,
    setError,
    handleVideoError,
  };
};
