import { extractBilibiliVideoId, isBilibiliUrl } from "../utils/helpers";
import {
    BilibiliCollectionCheckResult,
    BilibiliDownloader,
    BilibiliPartsCheckResult,
    BilibiliVideoInfo,
    BilibiliVideosResult,
    CollectionDownloadResult,
    DownloadResult
} from "./downloaders/BilibiliDownloader";
import { MissAVDownloader } from "./downloaders/MissAVDownloader";
import { YouTubeDownloader } from "./downloaders/YouTubeDownloader";
import { Video } from "./storageService";

// Re-export types for compatibility
export type {
    BilibiliCollectionCheckResult, BilibiliPartsCheckResult, BilibiliVideoInfo, BilibiliVideosResult, CollectionDownloadResult, DownloadResult
};

// Helper function to download Bilibili video
export async function downloadBilibiliVideo(
  url: string,
  videoPath: string,
  thumbnailPath: string
): Promise<BilibiliVideoInfo> {
  return BilibiliDownloader.downloadVideo(url, videoPath, thumbnailPath);
}

// Helper function to check if a Bilibili video has multiple parts
export async function checkBilibiliVideoParts(videoId: string): Promise<BilibiliPartsCheckResult> {
  return BilibiliDownloader.checkVideoParts(videoId);
}

// Helper function to check if a Bilibili video belongs to a collection or series
export async function checkBilibiliCollectionOrSeries(videoId: string): Promise<BilibiliCollectionCheckResult> {
  return BilibiliDownloader.checkCollectionOrSeries(videoId);
}

// Helper function to get all videos from a Bilibili collection
export async function getBilibiliCollectionVideos(mid: number, seasonId: number): Promise<BilibiliVideosResult> {
  return BilibiliDownloader.getCollectionVideos(mid, seasonId);
}

// Helper function to get all videos from a Bilibili series
export async function getBilibiliSeriesVideos(mid: number, seriesId: number): Promise<BilibiliVideosResult> {
  return BilibiliDownloader.getSeriesVideos(mid, seriesId);
}

// Helper function to download a single Bilibili part
export async function downloadSingleBilibiliPart(
  url: string,
  partNumber: number,
  totalParts: number,
  seriesTitle: string
): Promise<DownloadResult> {
  return BilibiliDownloader.downloadSinglePart(url, partNumber, totalParts, seriesTitle);
}

// Helper function to download all videos from a Bilibili collection or series
export async function downloadBilibiliCollection(
  collectionInfo: BilibiliCollectionCheckResult,
  collectionName: string,
  downloadId: string
): Promise<CollectionDownloadResult> {
  return BilibiliDownloader.downloadCollection(collectionInfo, collectionName, downloadId);
}

// Helper function to download remaining Bilibili parts in sequence
export async function downloadRemainingBilibiliParts(
  baseUrl: string,
  startPart: number,
  totalParts: number,
  seriesTitle: string,
  collectionId: string,
  downloadId: string
): Promise<void> {
  return BilibiliDownloader.downloadRemainingParts(baseUrl, startPart, totalParts, seriesTitle, collectionId, downloadId);
}

// Search for videos on YouTube
export async function searchYouTube(query: string): Promise<any[]> {
  return YouTubeDownloader.search(query);
}

// Download YouTube video
export async function downloadYouTubeVideo(videoUrl: string, downloadId?: string, onStart?: (cancel: () => void) => void): Promise<Video> {
  return YouTubeDownloader.downloadVideo(videoUrl, downloadId, onStart);
}

// Helper function to download MissAV video
export async function downloadMissAVVideo(url: string, downloadId?: string, onStart?: (cancel: () => void) => void): Promise<Video> {
  return MissAVDownloader.downloadVideo(url, downloadId, onStart);
}

// Helper function to get video info without downloading
export async function getVideoInfo(url: string): Promise<{ title: string; author: string; date: string; thumbnailUrl: string }> {
  if (isBilibiliUrl(url)) {
    const videoId = extractBilibiliVideoId(url);
    if (videoId) {
      return BilibiliDownloader.getVideoInfo(videoId);
    }
  } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
    return YouTubeDownloader.getVideoInfo(url);
  } else if (url.includes("missav")) {
    return MissAVDownloader.getVideoInfo(url);
  }
  
  // Default fallback
  return {
    title: "Video",
    author: "Unknown",
    date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    thumbnailUrl: "",
  };
}
