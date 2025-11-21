const axios = require("axios");

// Helper function to check if a string is a valid URL
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Helper function to check if a URL is from Bilibili
function isBilibiliUrl(url) {
  return url.includes("bilibili.com") || url.includes("b23.tv");
}

// Helper function to extract URL from text that might contain a title and URL
function extractUrlFromText(text) {
  // Regular expression to find URLs in text
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);

  if (matches && matches.length > 0) {
    return matches[0];
  }

  return text; // Return original text if no URL found
}

// Helper function to resolve shortened URLs (like b23.tv)
async function resolveShortUrl(url) {
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
  } catch (error) {
    console.error(`Error resolving shortened URL: ${error.message}`);
    return url; // Return original URL if resolution fails
  }
}

// Helper function to trim Bilibili URL by removing query parameters
function trimBilibiliUrl(url) {
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
function extractBilibiliVideoId(url) {
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

// Helper function to create a safe filename that preserves non-Latin characters
function sanitizeFilename(filename) {
  // Replace only unsafe characters for filesystems
  // This preserves non-Latin characters like Chinese, Japanese, Korean, etc.
  return filename
    .replace(/[\/\\:*?"<>|]/g, "_") // Replace unsafe filesystem characters
    .replace(/\s+/g, "_"); // Replace spaces with underscores
}

// Helper function to extract user mid from Bilibili URL
function extractBilibiliMid(url) {
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
function extractBilibiliSeasonId(url) {
  try {
    const urlObj = new URL(url);
    const seasonId = urlObj.searchParams.get('season_id');
    return seasonId;
  } catch (error) {
    return null;
  }
}

// Helper function to extract series_id from Bilibili URL
function extractBilibiliSeriesId(url) {
  try {
    const urlObj = new URL(url);
    const seriesId = urlObj.searchParams.get('series_id');
    return seriesId;
  } catch (error) {
    return null;
  }
}

module.exports = {
  isValidUrl,
  isBilibiliUrl,
  extractUrlFromText,
  resolveShortUrl,
  trimBilibiliUrl,
  extractBilibiliVideoId,
  sanitizeFilename,
  extractBilibiliMid,
  extractBilibiliSeasonId,
  extractBilibiliSeriesId,
};
