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

  useEffect(() => {
    const videoElement = videoRef.current;
    const videoSrc = videoUrl || video.sourceUrl;
    if (!videoElement || !videoSrc) {
      setDetectedResolution(null);
      return;
    }

    // Set the video source
    if (videoElement.src !== videoSrc) {
      videoElement.src = videoSrc;
      videoElement.load(); // Force reload
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

    videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    videoElement.addEventListener("error", handleError);

    // If metadata is already loaded
    if (videoElement.readyState >= 1 && videoElement.videoHeight > 0) {
      handleLoadedMetadata();
    }

    return () => {
      // Cleanup: remove event listeners
      videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      videoElement.removeEventListener("error", handleError);
      // Cleanup: clear video source to free memory
      videoElement.src = "";
      videoElement.load();
    };
  }, [videoUrl, video.sourceUrl, video.id]);

  // Try to get resolution from video object first, fallback to detected resolution
  const resolutionFromObject = formatResolution(video);
  const videoResolution = resolutionFromObject || detectedResolution;

  return { videoRef, videoResolution };
};
