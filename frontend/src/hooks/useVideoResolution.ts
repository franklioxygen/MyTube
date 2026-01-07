import { useEffect, useRef, useState } from "react";
import { Video } from "../types";
import { useCloudStorageUrl } from "./useCloudStorageUrl";

// Format video resolution from video object
export const formatResolution = (video: Video): string | null => {
  // Check if resolution is directly available
  if (video.resolution) {
    const res = String(video.resolution).toUpperCase();
    // If it's already formatted like "720P", return it
    if (res.match(/^\d+P$/)) {
      return res;
    }
    // If it's "4K" or similar, return it
    if (res.match(/^\d+K$/)) {
      return res;
    }
  }

  // Check if width and height are available
  const width = (video as any).width;
  const height = (video as any).height;

  if (width && height) {
    const h = typeof height === "number" ? height : parseInt(String(height));
    if (!isNaN(h)) {
      if (h >= 2160) return "4K";
      if (h >= 1440) return "1440P";
      if (h >= 1080) return "1080P";
      if (h >= 720) return "720P";
      if (h >= 480) return "480P";
      if (h >= 360) return "360P";
      if (h >= 240) return "240P";
      if (h >= 144) return "144P";
    }
  }

  // Check if there's a format_id or format that might contain resolution info
  const formatId = (video as any).format_id;
  if (formatId && typeof formatId === "string") {
    const match = formatId.match(/(\d+)p/i);
    if (match) {
      return match[1].toUpperCase() + "P";
    }
  }

  return null;
};

export const useVideoResolution = (video: Video) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [detectedResolution, setDetectedResolution] = useState<string | null>(
    null
  );
  const videoUrl = useCloudStorageUrl(video.videoPath, "video");

  // First check if resolution is already available in video object
  const resolutionFromObject = formatResolution(video);

  // Only create video element if resolution is not available in video object
  const needsDetection = !resolutionFromObject;

  useEffect(() => {
    // Skip video element creation if resolution is already available
    if (!needsDetection) {
      setDetectedResolution(null);
      return;
    }

    const videoElement = videoRef.current;
    const videoSrc = videoUrl || video.sourceUrl;
    if (!videoElement || !videoSrc) {
      setDetectedResolution(null);
      return;
    }

    const handleLoadedMetadata = () => {
      const height = videoElement.videoHeight;
      if (height && height > 0) {
        if (height >= 2160) setDetectedResolution("4K");
        else if (height >= 1440) setDetectedResolution("1440P");
        else if (height >= 1080) setDetectedResolution("1080P");
        else if (height >= 720) setDetectedResolution("720P");
        else if (height >= 480) setDetectedResolution("480P");
        else if (height >= 360) setDetectedResolution("360P");
        else if (height >= 240) setDetectedResolution("240P");
        else if (height >= 144) setDetectedResolution("144P");
        else setDetectedResolution(null);
      } else {
        setDetectedResolution(null);
      }
    };

    const handleError = () => {
      setDetectedResolution(null);
    };

    // Delay resolution detection to avoid blocking video playback
    // Use requestIdleCallback if available, otherwise use setTimeout with a delay
    const delayDetection = () => {
      // Set the video source with low priority
      if (videoElement.src !== videoSrc) {
        videoElement.src = videoSrc;
        // Use 'none' preload to avoid interfering with main video playback
        videoElement.preload = "none";
        videoElement.load(); // Force reload
      }

      // Add event listeners
      videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
      videoElement.addEventListener("error", handleError);

      // If metadata is already loaded
      if (videoElement.readyState >= 1 && videoElement.videoHeight > 0) {
        handleLoadedMetadata();
      }
    };

    let cleanup: (() => void) | undefined;

    // Use requestIdleCallback for better performance, fallback to setTimeout
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleCallbackId = (window as any).requestIdleCallback(
        delayDetection,
        { timeout: 2000 } // Start after 2 seconds even if browser is busy
      );
      cleanup = () => {
        (window as any).cancelIdleCallback(idleCallbackId);
        videoElement.removeEventListener(
          "loadedmetadata",
          handleLoadedMetadata
        );
        videoElement.removeEventListener("error", handleError);
        videoElement.pause();
        videoElement.src = "";
        videoElement.load();
      };
    } else {
      // Fallback: delay by 1 second to let main video start playing first
      const timeoutId = setTimeout(delayDetection, 1000);
      cleanup = () => {
        clearTimeout(timeoutId);
        videoElement.removeEventListener(
          "loadedmetadata",
          handleLoadedMetadata
        );
        videoElement.removeEventListener("error", handleError);
        videoElement.pause();
        videoElement.src = "";
        videoElement.load();
      };
    }

    return cleanup;
  }, [needsDetection, videoUrl, video.sourceUrl, video.id]);

  // Use resolution from object if available, otherwise use detected resolution
  const videoResolution = resolutionFromObject || detectedResolution;

  return { videoRef, videoResolution, needsDetection };
};
