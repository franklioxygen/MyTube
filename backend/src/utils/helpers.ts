import { isHostnameAllowed } from "./security";

const YOUTUBE_HOSTNAMES = ["youtube.com", "youtu.be"] as const;
const BILIBILI_HOSTNAMES = ["bilibili.com", "b23.tv", "bili2233.cn"] as const;
const BILIBILI_SPACE_HOSTNAMES = ["space.bilibili.com"] as const;
const MISSAV_HOSTNAMES = [
  "missav.com",
  "missav.ai",
  "missav.ws",
  "missav.live",
  "123av.com",
  "123av.ai",
  "123av.ws",
  "njavtv.com",
] as const;
const TWITTER_HOSTNAMES = ["x.com", "twitter.com"] as const;

const ALLOWED_BILIBILI_SHORTENER_HOSTNAMES = ["b23.tv", "bili2233.cn"] as const;
const REQUEST_HOST_OUTPUT_MAP: Record<string, string> = {
  "bilibili.com": "www.bilibili.com",
};

function parseUrlSafe(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function hasAllowedHostname(
  url: string,
  allowedHostnames: readonly string[],
): boolean {
  const parsedUrl = parseUrlSafe(url);
  if (!parsedUrl) {
    return false;
  }

  // Reject credentials/port at the classifier level to avoid unsafe edge cases.
  if (parsedUrl.username || parsedUrl.password || parsedUrl.port) {
    return false;
  }

  return isHostnameAllowed(parsedUrl.hostname, allowedHostnames);
}

function buildSafeRequestUrl(
  url: string,
  allowedHostnames: readonly string[],
): string {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `Invalid protocol: ${parsedUrl.protocol}. Only http and https are allowed.`,
    );
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.port) {
    throw new Error(
      "SSRF protection: URLs with credentials or explicit ports are not allowed.",
    );
  }

  const normalizedHostname = parsedUrl.hostname.toLowerCase();
  const canonicalAllowedHost = allowedHostnames.find((allowedHost) => {
    const normalizedAllowedHost = allowedHost.toLowerCase();
    return (
      normalizedHostname === normalizedAllowedHost ||
      normalizedHostname.endsWith(`.${normalizedAllowedHost}`)
    );
  });
  if (!canonicalAllowedHost) {
    throw new Error(
      `SSRF protection: Hostname ${parsedUrl.hostname} is not in the URL allow-list.`,
    );
  }

  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  if (pathSegments.some((segment) => segment === "..")) {
    throw new Error("SSRF protection: Path traversal is not allowed in URL path.");
  }

  const safePath = parsedUrl.pathname || "/";
  const outputHost =
    REQUEST_HOST_OUTPUT_MAP[canonicalAllowedHost] ?? canonicalAllowedHost;
  return `https://${outputHost}${safePath}${parsedUrl.search}`;
}

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
  return hasAllowedHostname(url, BILIBILI_HOSTNAMES);
}

// Helper function to check if a URL is a Bilibili space/author URL
export function isBilibiliSpaceUrl(url: string): boolean {
  return hasAllowedHostname(url, BILIBILI_SPACE_HOSTNAMES);
}

export function isBilibiliShortUrl(url: string): boolean {
  return hasAllowedHostname(url, ALLOWED_BILIBILI_SHORTENER_HOSTNAMES);
}

export function isYouTubeUrl(url: string): boolean {
  return hasAllowedHostname(url, YOUTUBE_HOSTNAMES);
}

export function isMissAVUrl(url: string): boolean {
  return hasAllowedHostname(url, MISSAV_HOSTNAMES);
}

export function isTwitterUrl(url: string): boolean {
  return hasAllowedHostname(url, TWITTER_HOSTNAMES);
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

    const safeShortUrl = buildSafeRequestUrl(
      url,
      ALLOWED_BILIBILI_SHORTENER_HOSTNAMES,
    );
    console.log(
      `Short URL host is allowed. Returning normalized URL without outbound resolution: ${safeShortUrl}`,
    );
    return safeShortUrl;
  } catch (error: any) {
    console.error(`Error resolving shortened URL: ${error.message}`);
    // If validation fails, return original URL only if it's already validated
    try {
      return buildSafeRequestUrl(url, ALLOWED_BILIBILI_SHORTENER_HOSTNAMES);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
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

const YOUTUBE_AUTHOR_PATH_PREFIXES = ["channel", "user", "c"] as const;

function getYouTubeAuthorBasePath(segments: string[]): string | null {
  if (segments.length === 0) return null;
  if (segments[0]?.startsWith("@")) return `/${segments[0]}`;
  const isChannelLike =
    YOUTUBE_AUTHOR_PATH_PREFIXES.includes(
      segments[0] as (typeof YOUTUBE_AUTHOR_PATH_PREFIXES)[number]
    ) && segments.length >= 2;
  return isChannelLike ? `/${segments[0]}/${segments[1]}` : null;
}

/**
 * Normalize YouTube author/channel URL by stripping tab path segments.
 * e.g. https://www.youtube.com/@huzeyfekurt/featured → https://www.youtube.com/@huzeyfekurt
 * Handles @handle, /channel/ID, /user/name, /c/name.
 */
export function normalizeYouTubeAuthorUrl(url: string): string {
  try {
    if (!isYouTubeUrl(url)) return url;
    const u = new URL(url);
    const segments = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    const basePath = getYouTubeAuthorBasePath(segments);
    return basePath ? `${u.origin}${basePath}` : url;
  } catch {
    return url;
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

const YOUTUBE_VIDEO_ID_PATTERNS: RegExp[] = [
  /[?&]v=([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /\/embed\/([a-zA-Z0-9_-]{11})/,
  /\/shorts\/([a-zA-Z0-9_-]{11})/,
];

function extractByPatternList(url: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

// Helper function to extract video ID from YouTube URL
export function extractYouTubeVideoId(url: string): string | null {
  return extractByPatternList(url, YOUTUBE_VIDEO_ID_PATTERNS);
}

function getMissAVLastPathSegment(url: string): string | null {
  const pathSegments = new URL(url).pathname
    .split("/")
    .filter((segment) => segment.length > 0);
  const videoId = pathSegments[pathSegments.length - 1];

  if (videoId && /^[a-zA-Z0-9-]+$/.test(videoId)) {
    return videoId;
  }

  return null;
}

// Helper function to extract video ID from MissAV/123AV URL
export function extractMissAVVideoId(url: string): string | null {
  try {
    // MissAV URLs have patterns like:
    // - https://missav.ai/dm2/en/jux-492-uncensored-leak
    // - https://missav.ai/dm29/en/juq-643-uncensored-leak
    // - https://missav.ai/v/VIDEO_ID
    const videoIdFromPath = getMissAVLastPathSegment(url);
    if (videoIdFromPath) {
      return videoIdFromPath;
    }

    // Fallback to old regex pattern for URLs like /v/VIDEO_ID or /dm*/VIDEO_ID (without language code)
    return extractByPatternList(url, [/\/(?:v|dm\d*)\/([a-zA-Z0-9-]+)(?:\/|$)/]);
  } catch (error) {
    console.error("Error extracting MissAV video ID:", error);
    return null;
  }
}

// Helper function to extract source video ID from any supported URL
export function extractSourceVideoId(url: string): {
  id: string | null;
  platform: string;
} {
  if (isBilibiliUrl(url)) {
    return { id: extractBilibiliVideoId(url), platform: "bilibili" };
  }

  if (isYouTubeUrl(url)) {
    return { id: extractYouTubeVideoId(url), platform: "youtube" };
  }

  if (isMissAVUrl(url)) {
    return { id: extractMissAVVideoId(url), platform: "missav" };
  }

  // For other URLs, use the full URL as ID (normalized)
  return { id: url, platform: "other" };
}

/**
 * Process video URL: extract from text, resolve shortened URLs, and extract source video ID
 * This consolidates the common pattern used across multiple controllers
 *
 * @param input - URL string that may contain text with a URL
 * @returns Object containing processed videoUrl, sourceVideoId, and platform
 */
export async function processVideoUrl(input: string): Promise<{
  videoUrl: string;
  sourceVideoId: string | null;
  platform: string;
}> {
  // Extract URL from text that might contain a title and URL
  let videoUrl = extractUrlFromText(input);

  // Resolve shortened URLs (like b23.tv)
  if (isBilibiliShortUrl(videoUrl)) {
    videoUrl = await resolveShortUrl(videoUrl);
  }

  // Extract source video ID and platform
  const { id: sourceVideoId, platform } = extractSourceVideoId(videoUrl);

  return { videoUrl, sourceVideoId, platform };
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
  const midParam = urlObj.searchParams.get("mid");
  if (midParam) {
    return midParam;
  }

  return null;
}

// Helper function to extract season_id from Bilibili URL
export function extractBilibiliSeasonId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const seasonId = urlObj.searchParams.get("season_id");
    return seasonId;
  } catch (error) {
    return null;
  }
}

// Helper function to extract series_id from Bilibili URL
export function extractBilibiliSeriesId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const seriesId = urlObj.searchParams.get("series_id");
    return seriesId;
  } catch (error) {
    return null;
  }
}

// Helper function to format video filename according to: Title-Author-YYYY
// Symbols are removed, spaces replaced by dots.
export function formatVideoFilename(
  title: string,
  author: string,
  dateString: string,
): string {
  // Helper to clean segments: remove symbols (keep letters/numbers/spaces), replace spaces with dots
  const cleanSegment = (str: string) => {
    if (!str) return "Unknown";
    return str
      .replace(/[^\p{L}\p{N}\s]/gu, "") // Remove non-letters/numbers/spaces
      .trim()
      .replace(/\s+/g, "."); // Replace spaces with dots
  };

  let cleanTitle = cleanSegment(title) || "Video";
  let cleanAuthor = cleanSegment(author) || "Unknown";

  // Extract year
  let year = new Date().getFullYear().toString();
  if (dateString) {
    const match = dateString.match(/(\d{4})/);
    if (match) {
      year = match[1];
    }
  }

  // Truncate author if it's too long (e.g. > 50 chars) to prioritize title visibility
  if (cleanAuthor.length > 50) {
    cleanAuthor = cleanAuthor.substring(0, 50);
  }

  // Construct the suffix parts
  const yearSuffix = `-${year}`;
  const authorSuffix = `-${cleanAuthor}`;
  const fullSuffix = `${authorSuffix}${yearSuffix}`;

  // Max length for the filename (leaving room for extension)
  const MAX_FILENAME_LENGTH = 200;

  // Calculate available space for title
  const availableTitleLength = MAX_FILENAME_LENGTH - fullSuffix.length;

  if (cleanTitle.length > availableTitleLength) {
    // Truncate title
    cleanTitle = cleanTitle.substring(0, Math.max(0, availableTitleLength));
  }

  return `${cleanTitle}${fullSuffix}`;
}

/**
 * Generate avatar filename in format: platform-author.name.jpg
 * Example: youtube-eric.cartman.jpg
 */
export function formatAvatarFilename(platform: string, author: string): string {
  // Clean author name: remove symbols, replace spaces with dots, lowercase
  const cleanAuthor = author
    .replace(/[^\p{L}\p{N}\s]/gu, "") // Remove non-letters/numbers/spaces
    .trim()
    .replace(/\s+/g, ".") // Replace spaces with dots
    .toLowerCase(); // Convert to lowercase

  // Clean platform name: lowercase, remove special chars
  const cleanPlatform = platform
    .replace(/[^\p{L}\p{N}]/gu, "") // Remove non-letters/numbers
    .toLowerCase();

  // Use "unknown" if author is empty
  const authorName = cleanAuthor || "unknown";

  // Truncate author if too long (max 100 chars to leave room for platform prefix)
  const maxAuthorLength = 100;
  const finalAuthor =
    authorName.length > maxAuthorLength
      ? authorName.substring(0, maxAuthorLength)
      : authorName;

  return `${cleanPlatform}-${finalAuthor}.jpg`;
}

/**
 * Generate a timestamp string for backup filenames
 * Format: YYYY-MM-DD-HH-MM-SS
 */
export function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
}

// Helper function to extract domain name from URL
export function getDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    // Remove www. prefix if present
    return hostname.replace(/^www\./, "");
  } catch (error) {
    return "Unknown";
  }
}
