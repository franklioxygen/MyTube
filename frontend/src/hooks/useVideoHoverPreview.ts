import { useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useRef, useState } from "react";

interface UseVideoHoverPreviewProps {
  videoPath?: string;
}

/**
 * Hook to manage video hover preview functionality
 * Handles showing video preview on hover with delay and cleanup
 */
export const useVideoHoverPreview = ({
  videoPath,
}: UseVideoHoverPreviewProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [isHovered, setIsHovered] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (!isMobile && videoPath) {
      // Add delay before loading video to prevent loading on quick hovers
      // This reduces memory usage when quickly moving mouse over multiple cards
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovered(true);
      }, 300); // 300ms delay
    }
  };

  const handleMouseLeave = () => {
    // Clear hover timeout if mouse leaves before delay
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }

    setIsHovered(false);
    setIsVideoPlaying(false);

    // Aggressively cleanup video element when mouse leaves
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = "";
      videoRef.current.load();
      // Force garbage collection hint
      videoRef.current.removeAttribute("src");
    }
  };

  // Cleanup video element on unmount
  useEffect(() => {
    return () => {
      // Clear any pending hover timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }

      // Aggressively cleanup video element
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
        videoRef.current.load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
        videoRef.current.removeAttribute("src");
      }
    };
  }, []);

  return {
    isHovered,
    isVideoPlaying,
    setIsVideoPlaying,
    videoRef,
    handleMouseEnter,
    handleMouseLeave,
  };
};
