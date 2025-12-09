import axios from "axios";

// Helper function to check if a string is a valid URL
export function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Helper function to check if a URL is from Bilibili
export function isBilibiliUrl(url: string): boolean {
  return url.includes("bilibili.com") || url.includes("b23.tv");
}

// Helper function to extract URL from text that might contain a title and URL
export function extractUrlFromText(text: string): string {
  // Regular expression to find URLs in text
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);

  if (matches && matches.length > 0) {
    return matches[0];
  }

  return text; // Return original text if no URL found
}

// Helper function to resolve shortened URLs (like b23.tv)
export async function resolveShortUrl(url: string): Promise<string> {
  try {
    console.log(`Resolving shortened URL: ${url}`);

    // Make a HEAD request to follow redirects
    const response = await axios.head(url, {
      maxRedirects: 5,
      validateStatus: null,
    });

    // Get the final URL after redirects
    const resolvedUrl = response.request.res.responseUrl || url;
    console.log(`Resolved to: ${resolvedUrl}`);

    return resolvedUrl;
  } catch (error: any) {
    console.error(`Error resolving shortened URL: ${error.message}`);
    return url; // Return original URL if resolution fails
  }
}

// Helper function to trim Bilibili URL by removing query parameters
export function trimBilibiliUrl(url: string): string {
  try {
    // First, extract the video ID (BV or av format)
    const videoIdMatch = url.match(/\/video\/(BV[\w]+|av\d+)/i);

    if (videoIdMatch && videoIdMatch[1]) {
      const videoId = videoIdMatch[1];
      // Construct a clean URL with just the video ID
      const cleanUrl = videoId.startsWith("BV")
        ? `https://www.bilibili.com/video/${videoId}`
        : `https://www.bilibili.com/video/${videoId}`;

      console.log(`Trimmed Bilibili URL from "${url}" to "${cleanUrl}"`);
      return cleanUrl;
    }

    // If we couldn't extract the video ID using the regex above,
    // try to clean the URL by removing query parameters
    try {
      const urlObj = new URL(url);
      const cleanUrl = `${urlObj.origin}${urlObj.pathname}`;
      console.log(`Trimmed Bilibili URL from "${url}" to "${cleanUrl}"`);
      return cleanUrl;
    } catch (urlError) {
      console.error("Error parsing URL:", urlError);
      return url;
    }
  } catch (error) {
    console.error("Error trimming Bilibili URL:", error);
    return url; // Return original URL if there's an error
  }
}

// Helper function to extract video ID from Bilibili URL
export function extractBilibiliVideoId(url: string): string | null {
  // Extract BV ID from URL - works for both desktop and mobile URLs
  const bvMatch = url.match(/\/video\/(BV[\w]+)/i);
  if (bvMatch && bvMatch[1]) {
    return bvMatch[1];
  }

  // Extract av ID from URL
  const avMatch = url.match(/\/video\/(av\d+)/i);
  if (avMatch && avMatch[1]) {
    return avMatch[1];
  }

  return null;
}

// Helper function to extract video ID from YouTube URL
export function extractYouTubeVideoId(url: string): string | null {
  // Standard YouTube URL: youtube.com/watch?v=VIDEO_ID
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch && watchMatch[1]) {
    return watchMatch[1];
  }

  // Short YouTube URL: youtu.be/VIDEO_ID
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch && shortMatch[1]) {
    return shortMatch[1];
  }

  // Embed URL: youtube.com/embed/VIDEO_ID
  const embedMatch = url.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch && embedMatch[1]) {
    return embedMatch[1];
  }

  // Shorts URL: youtube.com/shorts/VIDEO_ID
  const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch && shortsMatch[1]) {
    return shortsMatch[1];
  }

  return null;
}

// Helper function to extract video ID from MissAV/123AV URL
export function extractMissAVVideoId(url: string): string | null {
  // Extract video ID from MissAV URL pattern like /v/VIDEO_ID or /dm*/VIDEO_ID
  const vidMatch = url.match(/\/(?:v|dm\d*)\/([a-zA-Z0-9-]+)/);
  if (vidMatch && vidMatch[1]) {
    return vidMatch[1];
  }

  return null;
}

// Helper function to extract source video ID from any supported URL
export function extractSourceVideoId(url: string): { id: string | null; platform: string } {
  if (isBilibiliUrl(url)) {
    return { id: extractBilibiliVideoId(url), platform: "bilibili" };
  }
  
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    return { id: extractYouTubeVideoId(url), platform: "youtube" };
  }
  
  if (url.includes("missav") || url.includes("123av")) {
    return { id: extractMissAVVideoId(url), platform: "missav" };
  }

  // For other URLs, use the full URL as ID (normalized)
  return { id: url, platform: "other" };
}

// Helper function to create a safe filename that preserves non-Latin characters
export function sanitizeFilename(filename: string): string {
  // Remove hashtags (e.g. #tag)
  const withoutHashtags = filename.replace(/#\S+/g, "").trim();

  // Replace only unsafe characters for filesystems
  // This preserves non-Latin characters like Chinese, Japanese, Korean, etc.
  const sanitized = withoutHashtags
    .replace(/[\/\\:*?"<>|%,'!;=+\$@^`{}~\[\]()&]/g, "_") // Replace unsafe filesystem and URL characters
    .replace(/\s+/g, "_"); // Replace spaces with underscores

  // Truncate to 200 characters to avoid ENAMETOOLONG errors (filesystem limit is usually 255 bytes)
  // We use 200 to leave room for timestamp suffix and extension
  return sanitized.slice(0, 200);
}

// Helper function to extract user mid from Bilibili URL
export function extractBilibiliMid(url: string): string | null {
  // Try to extract from space URL pattern: space.bilibili.com/{mid}
  const spaceMatch = url.match(/space\.bilibili\.com\/(\d+)/i);
  if (spaceMatch && spaceMatch[1]) {
    return spaceMatch[1];
  }
  
  // Try to extract from URL parameters
  const urlObj = new URL(url);
  const midParam = urlObj.searchParams.get('mid');
  if (midParam) {
    return midParam;
  }
  
  return null;
}

// Helper function to extract season_id from Bilibili URL
export function extractBilibiliSeasonId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const seasonId = urlObj.searchParams.get('season_id');
    return seasonId;
  } catch (error) {
    return null;
  }
}

// Helper function to extract series_id from Bilibili URL
export function extractBilibiliSeriesId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const seriesId = urlObj.searchParams.get('series_id');
    return seriesId;
  } catch (error) {
    return null;
  }
}

// Helper function to format video filename according to: Title-Author-YYYY
// Symbols are removed, spaces replaced by dots.
export function formatVideoFilename(title: string, author: string, dateString: string): string {
  // Helper to clean segments: remove symbols (keep letters/numbers/spaces), replace spaces with dots
  const cleanSegment = (str: string) => {
    if (!str) return "Unknown";
    return str
      .replace(/[^\p{L}\p{N}\s]/gu, "") // Remove non-letters/numbers/spaces
      .trim()
      .replace(/\s+/g, "."); // Replace spaces with dots
  };

  const cleanTitle = cleanSegment(title) || "Video";
  const cleanAuthor = cleanSegment(author) || "Unknown";
  
  // Extract year
  let year = new Date().getFullYear().toString();
  if (dateString) {
     const match = dateString.match(/(\d{4})/);
     if (match) {
         year = match[1];
     }
  }

  return `${cleanTitle}-${cleanAuthor}-${year}`;
}
