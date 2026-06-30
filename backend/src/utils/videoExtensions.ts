/**
 * Canonical list of recognized video container file extensions (lowercase,
 * leading dot). Single source of truth shared by the playable-file resolver and
 * the yt-dlp output helpers so the two never drift apart.
 */
export const VIDEO_CONTAINER_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mkv",
  ".avi",
  ".mov",
  ".m4v",
  ".flv",
  ".3gp",
] as const;
