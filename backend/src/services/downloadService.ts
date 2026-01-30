import { extractBilibiliVideoId, isBilibiliUrl } from "../utils/helpers";
import { VideoInfo } from "./downloaders/BaseDownloader";
import {
  BilibiliCollectionCheckResult,
  BilibiliDownloader,
  BilibiliPartsCheckResult,
  BilibiliVideoInfo,
  BilibiliVideosResult,
  CollectionDownloadResult,
  DownloadResult,
} from "./downloaders/BilibiliDownloader";
import { MissAVDownloader } from "./downloaders/MissAVDownloader";
import { YtDlpDownloader } from "./downloaders/YtDlpDownloader";
import { Video } from "./storageService";

// Re-export types for compatibility
export type {
  BilibiliCollectionCheckResult,
  BilibiliPartsCheckResult,
  BilibiliVideoInfo,
  BilibiliVideosResult,
  CollectionDownloadResult,
  DownloadResult,
};

// Helper function to download Bilibili video
export async function downloadBilibiliVideo(
  url: string,
  videoPath: string,
  thumbnailPath: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void,
): Promise<BilibiliVideoInfo> {
  return BilibiliDownloader.downloadVideo(
    url,
    videoPath,
    thumbnailPath,
    downloadId,
    onStart,
  );
}

// Helper function to check if a Bilibili video has multiple parts
export async function checkBilibiliVideoParts(
  videoId: string,
): Promise<BilibiliPartsCheckResult> {
  return BilibiliDownloader.checkVideoParts(videoId);
}

// Helper function to check if a YouTube URL is a playlist
export async function checkPlaylist(playlistUrl: string): Promise<{
  success: boolean;
  title?: string;
  videoCount?: number;
  error?: string;
}> {
  try {
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getUserYtDlpConfig,
    } = await import("../utils/ytDlpUtils");
    const { getProviderScript } =
      await import("./downloaders/ytdlp/ytdlpHelpers");

    const userConfig = getUserYtDlpConfig(playlistUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const PROVIDER_SCRIPT = getProviderScript();

    // Get playlist info using flat playlist (faster, doesn't download)
    const info = await executeYtDlpJson(playlistUrl, {
      ...networkConfig,
      noWarnings: true,
      flatPlaylist: true,
      ...(PROVIDER_SCRIPT
        ? {
            extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
          }
        : {}),
    });

    // Check if it's a playlist
    if (
      info._type === "playlist" ||
      (info.entries && info.entries.length > 0)
    ) {
      const videoCount = info.playlist_count || info.entries?.length || 0;
      const title = info.title || info.playlist || "Playlist";

      return {
        success: true,
        title,
        videoCount,
      };
    }

    return {
      success: false,
      error: "Not a valid playlist",
    };
  } catch (error) {
    const { logger } = await import("../utils/logger");
    logger.error("Error checking playlist:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to check playlist",
    };
  }
}

// Helper function to check if a Bilibili video belongs to a collection or series
export async function checkBilibiliCollectionOrSeries(
  videoId: string,
): Promise<BilibiliCollectionCheckResult> {
  return BilibiliDownloader.checkCollectionOrSeries(videoId);
}

// Helper function to get all videos from a Bilibili collection
export async function getBilibiliCollectionVideos(
  mid: number,
  seasonId: number,
): Promise<BilibiliVideosResult> {
  return BilibiliDownloader.getCollectionVideos(mid, seasonId);
}

// Helper function to get all videos from a Bilibili series
export async function getBilibiliSeriesVideos(
  mid: number,
  seriesId: number,
): Promise<BilibiliVideosResult> {
  return BilibiliDownloader.getSeriesVideos(mid, seriesId);
}

// Helper function to download a single Bilibili part
export async function downloadSingleBilibiliPart(
  url: string,
  partNumber: number,
  totalParts: number,
  seriesTitle: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void,
  collectionName?: string,
): Promise<DownloadResult> {
  return BilibiliDownloader.downloadSinglePart(
    url,
    partNumber,
    totalParts,
    seriesTitle,
    downloadId,
    onStart,
    collectionName,
  );
}

// Helper function to download all videos from a Bilibili collection or series
export async function downloadBilibiliCollection(
  collectionInfo: BilibiliCollectionCheckResult,
  collectionName: string,
  downloadId: string,
): Promise<CollectionDownloadResult> {
  return BilibiliDownloader.downloadCollection(
    collectionInfo,
    collectionName,
    downloadId,
  );
}

// Helper function to download remaining Bilibili parts in sequence
export async function downloadRemainingBilibiliParts(
  baseUrl: string,
  startPart: number,
  totalParts: number,
  seriesTitle: string,
  collectionId: string | null,
  downloadId: string,
): Promise<void> {
  return BilibiliDownloader.downloadRemainingParts(
    baseUrl,
    startPart,
    totalParts,
    seriesTitle,
    collectionId,
    downloadId,
  );
}

// Search for videos on YouTube (using yt-dlp)
export async function searchYouTube(
  query: string,
  limit?: number,
  offset?: number,
): Promise<any[]> {
  return YtDlpDownloader.search(query, limit, offset);
}

// Download generic video (using yt-dlp)
export async function downloadYouTubeVideo(
  videoUrl: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void,
): Promise<Video> {
  return YtDlpDownloader.downloadVideo(videoUrl, downloadId, onStart);
}

// Helper function to download MissAV video
export async function downloadMissAVVideo(
  url: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void,
): Promise<Video> {
  return MissAVDownloader.downloadVideo(url, downloadId, onStart);
}

// Helper function to get video info without downloading
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  if (isBilibiliUrl(url)) {
    const videoId = extractBilibiliVideoId(url);
    if (videoId) {
      return BilibiliDownloader.getVideoInfo(videoId);
    }
  } else if (
    url.includes("missav") ||
    url.includes("123av") ||
    url.includes("njavtv")
  ) {
    return MissAVDownloader.getVideoInfo(url);
  }

  // Default fallback to yt-dlp for everything else
  return YtDlpDownloader.getVideoInfo(url);
}

// Factory function to create a download task
export function createDownloadTask(
  type: string,
  url: string,
  downloadId: string,
): (registerCancel: (cancel: () => void) => void) => Promise<any> {
  return async (registerCancel: (cancel: () => void) => void) => {
    if (type === "missav") {
      return MissAVDownloader.downloadVideo(url, downloadId, registerCancel);
    } else if (type === "bilibili") {
      // For restored tasks, we assume single video download for now
      // Complex collection handling would require persisting more state
      return BilibiliDownloader.downloadSinglePart(
        url,
        1,
        1,
        "",
        downloadId,
        registerCancel,
      );
    } else {
      // Default to yt-dlp
      return YtDlpDownloader.downloadVideo(url, downloadId, registerCancel);
    }
  };
}

// Helper function to download all playlists from a channel
export async function downloadChannelPlaylists(
  channelUrl: string,
  onProgress?: (data: any) => void,
): Promise<{ success: boolean; message: string }> {
  try {
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getUserYtDlpConfig,
    } = await import("../utils/ytDlpUtils");
    const { getProviderScript } =
      await import("./downloaders/ytdlp/ytdlpHelpers");
    const {
      getCollectionByName,
      saveCollection,
      generateUniqueCollectionName,
    } = await import("./storageService");
    const { logger } = await import("../utils/logger");
    const { v4: uuidv4 } = await import("uuid");
    const { continuousDownloadService } =
      await import("./continuousDownloadService");

    logger.info(`Fetching playlists for channel: ${channelUrl}`);

    // Adjust URL to ensure we target playlists tab
    let targetUrl = channelUrl;
    if (!channelUrl.includes("/playlists")) {
      targetUrl = channelUrl.endsWith("/")
        ? `${channelUrl}playlists`
        : `${channelUrl}/playlists`;
    }

    const userConfig = getUserYtDlpConfig(targetUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const PROVIDER_SCRIPT = getProviderScript();

    // Use yt-dlp to get all playlists
    // --flat-playlist to get playlist metadata without downloading videos
    // --dump-json to get JSON output
    const result = await executeYtDlpJson(targetUrl, {
      ...networkConfig,
      noWarnings: true,
      flatPlaylist: true,
      dumpSingleJson: true,
      playlistEnd: 100, // Limit to 100 playlists for safety
      ...(PROVIDER_SCRIPT
        ? {
            extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
          }
        : {}),
    });

    if (!result.entries || result.entries.length === 0) {
      return { success: false, message: "No playlists found on this channel." };
    }

    // Extract channel name from result
    let channelName = "Unknown";
    if (result.uploader) {
      channelName = result.uploader;
    } else if (result.channel) {
      channelName = result.channel;
    } else if (
      result.channel_id &&
      result.entries &&
      result.entries.length > 0
    ) {
      // Try to get channel name from first entry if available
      const firstEntry = result.entries[0];
      if (firstEntry.uploader) {
        channelName = firstEntry.uploader;
      } else if (firstEntry.channel) {
        channelName = firstEntry.channel;
      }
    }

    // Fallback: try to extract from URL if still not found
    if (channelName === "Unknown") {
      const match = decodeURI(channelUrl).match(/youtube\.com\/(@[^\/]+)/);
      if (match && match[1]) {
        channelName = match[1];
      } else {
        const parts = channelUrl.split("/");
        if (parts.length > 0) {
          const lastPart = parts[parts.length - 1];
          if (
            lastPart &&
            lastPart !== "videos" &&
            lastPart !== "about" &&
            lastPart !== "channel" &&
            lastPart !== "playlists"
          ) {
            channelName = lastPart;
          }
        }
      }
    }

    logger.info(
      `Found ${result.entries.length} playlists for channel: ${channelName}`,
    );

    let startedCount = 0;

    // Process each playlist
    for (const entry of result.entries) {
      // Must be a playlist type or have a title and url/id
      if (!entry.url && !entry.id) continue;

      const playlistUrl =
        entry.url || `https://www.youtube.com/playlist?list=${entry.id}`;
      // Clean title
      const title = (entry.title || "Untitled Playlist")
        .replace(/[\/\\:*?"<>|]/g, "-")
        .trim();

      logger.info(`Processing playlist: ${title} (${playlistUrl})`);

      // Check if there's already a task for this playlist URL
      const existingTask =
        await continuousDownloadService.getTaskByAuthorUrl(playlistUrl);

      if (existingTask) {
        // Task already exists for this playlist
        if (existingTask.collectionId) {
          const { getCollectionById } = await import("./storageService");
          const existingCollection = getCollectionById(
            existingTask.collectionId,
          );
          if (existingCollection) {
            logger.info(
              `Skipping playlist "${title}": task already exists with collection "${existingCollection.name}"`,
            );
            continue; // Skip creating duplicate task
          } else {
            logger.warn(
              `Task exists for playlist "${title}" but collection ${existingTask.collectionId} not found. Skipping.`,
            );
            continue; // Skip to avoid data inconsistency
          }
        } else {
          logger.info(
            `Skipping playlist "${title}": task already exists (no collection)`,
          );
          continue; // Skip creating duplicate task
        }
      }

      // Construct collection name: "Playlist Title - Author Name"
      // Clean channel name and only include if it's not "Unknown"
      const cleanChannelName =
        channelName && channelName !== "Unknown"
          ? channelName.replace(/[\/\\:*?"<>|]/g, "-").trim()
          : null;
      const collectionName = cleanChannelName
        ? `${title} - ${cleanChannelName}`
        : title;

      // No existing task found - check if a collection with the exact name already exists
      let collection = getCollectionByName(collectionName);

      if (!collection) {
        // Also check if a collection exists with just the title (backward compatibility or user renamed)
        collection = getCollectionByName(title);
      }

      if (!collection) {
        // Only create a new collection if one doesn't exist
        logger.info(`Creating new collection: ${collectionName}`);
        collection = saveCollection({
          id: uuidv4(),
          name: collectionName,
          title: collectionName,
          videos: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else {
        logger.info(
          `Reusing existing collection "${collection.name}" for playlist: ${title}`,
        );
      }

      // Create a playlist download task
      // Use helper to create continuous download task
      await continuousDownloadService.createPlaylistTask(
        playlistUrl,
        channelName, // Use extracted channel name as author
        "YouTube",
        collection.id,
      );

      startedCount++;
    }

    return {
      success: true,
      message: `Started downloading ${startedCount} playlists. Collections created.`,
    };
  } catch (error: any) {
    const { logger } = await import("../utils/logger");
    logger.error("Error processing channel playlists:", error);
    return {
      success: false,
      message: error.message || "Failed to download channel playlists",
    };
  }
}
