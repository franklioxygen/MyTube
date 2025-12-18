/**
 * Helper to parse duration to seconds
 */
export const parseDuration = (
  duration: string | number | undefined
): number => {
  if (!duration) return 0;
  if (typeof duration === "number") return duration;

  if (duration.includes(":")) {
    const parts = duration.split(":").map((part) => parseInt(part, 10));
    if (parts.length === 3) {
      const result = parts[0] * 3600 + parts[1] * 60 + parts[2];
      return isNaN(result) ? 0 : result;
    } else if (parts.length === 2) {
      const result = parts[0] * 60 + parts[1];
      return isNaN(result) ? 0 : result;
    }
  }

  const parsed = parseInt(duration, 10);
  return isNaN(parsed) ? 0 : parsed;
};

/**
 * Format duration (seconds or MM:SS or H:MM:SS)
 */
export const formatDuration = (
  duration: string | number | undefined
): string => {
  if (!duration) return "00:00";

  // If it's already a string with colon, assume it's formatted
  if (typeof duration === "string" && duration.includes(":")) {
    return duration;
  }

  const seconds = parseDuration(duration);
  if (isNaN(seconds) || seconds === 0) return "00:00";

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/**
 * Format file size in bytes to human readable string
 */
export const formatSize = (bytes: string | number | undefined): string => {
  if (!bytes) return "0 B";
  const size = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (isNaN(size)) return "0 B";

  if (size === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(size) / Math.log(k));
  return parseFloat((size / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

/**
 * Format date string YYYYMMDD to YYYY-MM-DD
 */
export const formatDate = (dateString?: string) => {
  if (!dateString || dateString.length !== 8) {
    return "Unknown date";
  }

  const year = dateString.substring(0, 4);
  const month = dateString.substring(4, 6);
  const day = dateString.substring(6, 8);

  return `${year}-${month}-${day}`;
};

/**
 * Generate timestamp string in format YYYY-MM-DD-HH-MM-SS
 * Matches the backend generateTimestamp() function format
 */
export const generateTimestamp = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
};

/**
 * Get full URL for a file path
 * If path is already a full URL (starts with http:// or https://), return it as is
 * Otherwise, prepend BACKEND_URL
 */
export const getFileUrl = (path: string | null | undefined, backendUrl: string): string | undefined => {
  if (!path) return undefined;
  
  // Check if path is already a full URL
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  
  // Otherwise, prepend backend URL
  return `${backendUrl}${path}`;
};
