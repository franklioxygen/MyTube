import { logger } from "../../../utils/logger";
import {
  executeYtDlpJson,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../../utils/ytDlpUtils";
import { getProviderScript } from "./ytdlpHelpers";

/**
 * Search for videos (primarily for YouTube, but could be adapted)
 */
export async function searchVideos(
  query: string,
  limit: number = 8,
  offset: number = 1
): Promise<any[]> {
  logger.info(
    `Processing search request for query: "${query}", limit: ${limit}, offset: ${offset}`
  );

  // Get user config for network options
  const userConfig = getUserYtDlpConfig();
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);
  const PROVIDER_SCRIPT = getProviderScript();

  // Calculate the total number of items to fetch from search
  // We need to request enough items to cover the offset + limit
  const searchLimit = offset + limit - 1;

  // Use ytsearch for searching
  const searchResults = await executeYtDlpJson(
    `ytsearch${searchLimit}:${query}`,
    {
      ...networkConfig,
      noWarnings: true,
      skipDownload: true,
      flatPlaylist: true, // Use flat playlist for faster search results
      playlistStart: offset,
      playlistEnd: searchLimit,
      ...(PROVIDER_SCRIPT
        ? {
            extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
          }
        : {}),
    }
  );

  if (!searchResults || !searchResults.entries) {
    return [];
  }

  // Format the search results
  const formattedResults = searchResults.entries.map((entry: any) => ({
    id: entry.id,
    title: entry.title,
    author: entry.uploader,
    thumbnailUrl:
      entry.thumbnail ||
      (entry.thumbnails && entry.thumbnails.length > 0
        ? entry.thumbnails[0].url
        : ""),
    duration: entry.duration,
    viewCount: entry.view_count,
    sourceUrl: `https://www.youtube.com/watch?v=${entry.id}`, // Default to YT for search results
    source: "youtube",
  }));

  logger.info(
    `Found ${formattedResults.length} search results for "${query}" (requested ${limit})`
  );

  return formattedResults;
}

