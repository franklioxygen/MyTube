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
    DownloadResult
};

// Helper function to download Bilibili video
export async function downloadBilibiliVideo(
  url: string,
  videoPath: string,
  thumbnailPath: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void
): Promise<BilibiliVideoInfo> {
  return BilibiliDownloader.downloadVideo(
    url,
    videoPath,
    thumbnailPath,
    downloadId,
    onStart
  );
}

// Helper function to check if a Bilibili video has multiple parts
export async function checkBilibiliVideoParts(
  videoId: string
): Promise<BilibiliPartsCheckResult> {
  return BilibiliDownloader.checkVideoParts(videoId);
}

// Helper function to check if a YouTube URL is a playlist
export async function checkPlaylist(
  playlistUrl: string
): Promise<{ success: boolean; title?: string; videoCount?: number; error?: string }> {
  try {
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getUserYtDlpConfig,
    } = await import("../utils/ytDlpUtils");
    const { getProviderScript } = await import("./downloaders/ytdlp/ytdlpHelpers");
    
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
    if (info._type === "playlist" || (info.entries && info.entries.length > 0)) {
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
      error: error instanceof Error ? error.message : "Failed to check playlist",
    };
  }
}

// Helper function to check if a Bilibili video belongs to a collection or series
export async function checkBilibiliCollectionOrSeries(
  videoId: string
): Promise<BilibiliCollectionCheckResult> {
  return BilibiliDownloader.checkCollectionOrSeries(videoId);
}

// Helper function to get all videos from a Bilibili collection
export async function getBilibiliCollectionVideos(
  mid: number,
  seasonId: number
): Promise<BilibiliVideosResult> {
  return BilibiliDownloader.getCollectionVideos(mid, seasonId);
}

// Helper function to get all videos from a Bilibili series
export async function getBilibiliSeriesVideos(
  mid: number,
  seriesId: number
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
  onStart?: (cancel: () => void) => void
): Promise<DownloadResult> {
  return BilibiliDownloader.downloadSinglePart(
    url,
    partNumber,
    totalParts,
    seriesTitle,
    downloadId,
    onStart
  );
}

// Helper function to download all videos from a Bilibili collection or series
export async function downloadBilibiliCollection(
  collectionInfo: BilibiliCollectionCheckResult,
  collectionName: string,
  downloadId: string
): Promise<CollectionDownloadResult> {
  return BilibiliDownloader.downloadCollection(
    collectionInfo,
    collectionName,
    downloadId
  );
}

// Helper function to download remaining Bilibili parts in sequence
export async function downloadRemainingBilibiliParts(
  baseUrl: string,
  startPart: number,
  totalParts: number,
  seriesTitle: string,
  collectionId: string | null,
  downloadId: string
): Promise<void> {
  return BilibiliDownloader.downloadRemainingParts(
    baseUrl,
    startPart,
    totalParts,
    seriesTitle,
    collectionId,
    downloadId
  );
}

// Search for videos on YouTube (using yt-dlp)
export async function searchYouTube(
  query: string,
  limit?: number,
  offset?: number
): Promise<any[]> {
  return YtDlpDownloader.search(query, limit, offset);
}

// Download generic video (using yt-dlp)
export async function downloadYouTubeVideo(
  videoUrl: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void
): Promise<Video> {
  return YtDlpDownloader.downloadVideo(videoUrl, downloadId, onStart);
}

// Helper function to download MissAV video
export async function downloadMissAVVideo(
  url: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void
): Promise<Video> {
  return MissAVDownloader.downloadVideo(url, downloadId, onStart);
}



// Helper function to get video info without downloading
export async function getVideoInfo(
  url: string
): Promise<VideoInfo> {
  if (isBilibiliUrl(url)) {
    const videoId = extractBilibiliVideoId(url);
    if (videoId) {
      return BilibiliDownloader.getVideoInfo(videoId);
    }
  } else if (url.includes("missav") || url.includes("123av")) {
    return MissAVDownloader.getVideoInfo(url);
  }

  // Default fallback to yt-dlp for everything else
  return YtDlpDownloader.getVideoInfo(url);
}

// Factory function to create a download task
export function createDownloadTask(
  type: string,
  url: string,
  downloadId: string
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
        registerCancel
      );
    } else {
      // Default to yt-dlp
      return YtDlpDownloader.downloadVideo(url, downloadId, registerCancel);
    }
  };
}
