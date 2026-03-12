import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../../../contexts/LanguageContext";

export const useVideoLoading = () => {
  const { t } = useLanguage();
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
      setLoadError(t("videoLoadTimeout"));
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
      const isSafari = /^((?!chrome|android).)*safari/i.test(
        navigator.userAgent,
      );

      let errorMessage = t("failedToLoadVideo");
      switch (videoElement.error?.code) {
        case 1: // MEDIA_ERR_ABORTED
          errorMessage = t("videoLoadingAborted");
          break;
        case 2: // MEDIA_ERR_NETWORK
          errorMessage = t("videoLoadNetworkError");
          break;
        case 3: // MEDIA_ERR_DECODE
          // Safari-specific message for decode errors (often codec-related)
          if (isSafari) {
            const src = videoElement.src || "";
            const isWebM = src.toLowerCase().includes(".webm");
            if (isWebM) {
              errorMessage = t("safariWebmLimitedSupportError");
            } else {
              errorMessage = t("safariVideoDecodeError");
            }
          } else {
            errorMessage = t("videoDecodeError");
          }
          break;
        case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
          if (isSafari) {
            errorMessage = t("safariVideoFormatNotSupported");
          } else {
            errorMessage = t("browserVideoFormatNotSupported");
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
