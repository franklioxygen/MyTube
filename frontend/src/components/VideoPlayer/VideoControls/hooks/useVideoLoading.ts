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
      
      // Detect Safari browser
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      
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
          // Safari-specific message for decode errors (often codec-related)
          if (isSafari) {
            const src = videoElement.src || '';
            const isWebM = src.toLowerCase().includes('.webm');
            if (isWebM) {
              errorMessage = "Safari has limited support for WebM/VP9 codec, especially for 4K videos. Please re-download the video with H.264/MP4 format for better Safari compatibility.";
            } else {
              errorMessage = "Video decoding error. Safari may not support this video codec. Try re-downloading with H.264/MP4 format.";
            }
          } else {
            errorMessage = "Video decoding error. The file may be corrupted or use an unsupported codec.";
          }
          break;
        case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
          if (isSafari) {
            errorMessage = "Video format not supported by Safari. Safari works best with H.264/MP4 videos. Please re-download with H.264 codec.";
          } else {
            errorMessage = "Video format not supported.";
          }
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
