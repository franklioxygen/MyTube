import { extractBilibiliVideoId } from "../../utils/helpers";
import { Video } from "../storageService";
import { BaseDownloader, DownloadOptions, VideoInfo } from "./BaseDownloader";
import * as bilibiliApi from "./bilibili/bilibiliApi";
import * as bilibiliCollection from "./bilibili/bilibiliCollection";
import * as bilibiliCookie from "./bilibili/bilibiliCookie";
import * as bilibiliSubtitle from "./bilibili/bilibiliSubtitle";
import * as bilibiliVideo from "./bilibili/bilibiliVideo";
import {
  BilibiliCollectionCheckResult,
  BilibiliPartsCheckResult,
  BilibiliVideoInfo,
  BilibiliVideosResult,
  CollectionDownloadResult,
  DownloadResult,
} from "./bilibili/types";

// Re-export all types for backward compatibility
export type {
  BilibiliCollectionCheckResult,
  BilibiliPartsCheckResult,
  BilibiliVideoInfo,
  BilibiliVideosResult,
  CollectionDownloadResult,
  DownloadResult,
};

export class BilibiliDownloader extends BaseDownloader {
  // Implementation of IDownloader.getVideoInfo
  async getVideoInfo(url: string): Promise<VideoInfo> {
    const videoId = extractBilibiliVideoId(url);
    if (!videoId) {
      throw new Error("Invalid Bilibili URL");
    }
    return BilibiliDownloader.getVideoInfo(videoId);
  }

  // Get video info without downloading (Static wrapper)
  static async getVideoInfo(videoId: string): Promise<VideoInfo> {
    return bilibiliApi.getVideoInfo(videoId);
  }

  // Implementation of IDownloader.downloadVideo
  // Note: For Bilibili, this defaults to downloading single part/video.
  async downloadVideo(url: string, options?: DownloadOptions): Promise<Video> {
    // Assuming single part download for simplicity in the general interface
    const result = await BilibiliDownloader.downloadSinglePart(
      url,
      1,
      1,
      "",
      options?.downloadId,
      options?.onStart
    );

    if (result.success && result.videoData) {
      return result.videoData;
    }

    throw new Error(result.error || "Failed to download Bilibili video");
  }

  // Get author info from Bilibili space URL
  static async getAuthorInfo(mid: string): Promise<{
    name: string;
    mid: string;
  }> {
    return bilibiliApi.getAuthorInfo(mid);
  }

  // Get the latest video URL from a Bilibili author's space
  static async getLatestVideoUrl(spaceUrl: string): Promise<string | null> {
    return bilibiliApi.getLatestVideoUrl(spaceUrl);
  }

  // Wrapper for internal download logic, matching existing static method
  static async downloadVideo(
    url: string,
    videoPath: string,
    thumbnailPath: string,
    downloadId?: string,
    onStart?: (cancel: () => void) => void
  ): Promise<BilibiliVideoInfo> {
    return bilibiliVideo.downloadVideo(
      url,
      videoPath,
      thumbnailPath,
      downloadId,
      onStart
    );
  }

  // Helper function to check if a Bilibili video has multiple parts
  static async checkVideoParts(
    videoId: string
  ): Promise<BilibiliPartsCheckResult> {
    return bilibiliApi.checkVideoParts(videoId);
  }

  // Helper function to check if a Bilibili video belongs to a collection or series
  static async checkCollectionOrSeries(
    videoId: string
  ): Promise<BilibiliCollectionCheckResult> {
    return bilibiliApi.checkCollectionOrSeries(videoId);
  }

  // Helper function to get all videos from a Bilibili collection
  static async getCollectionVideos(
    mid: number,
    seasonId: number
  ): Promise<BilibiliVideosResult> {
    return bilibiliCollection.getCollectionVideos(mid, seasonId);
  }

  // Helper function to get all videos from a Bilibili series
  static async getSeriesVideos(
    mid: number,
    seriesId: number
  ): Promise<BilibiliVideosResult> {
    return bilibiliCollection.getSeriesVideos(mid, seriesId);
  }

  // Helper function to download a single Bilibili part
  static async downloadSinglePart(
    url: string,
    partNumber: number,
    totalParts: number,
    seriesTitle: string,
    downloadId?: string,
    onStart?: (cancel: () => void) => void
  ): Promise<DownloadResult> {
    return bilibiliVideo.downloadSinglePart(
      url,
      partNumber,
      totalParts,
      seriesTitle,
      downloadId,
      onStart
    );
  }

  // Helper function to download all videos from a Bilibili collection or series
  static async downloadCollection(
    collectionInfo: BilibiliCollectionCheckResult,
    collectionName: string,
    downloadId: string
  ): Promise<CollectionDownloadResult> {
    return bilibiliCollection.downloadCollection(
      collectionInfo,
      collectionName,
      downloadId
    );
  }

  // Helper function to download remaining Bilibili parts in sequence
  static async downloadRemainingParts(
    baseUrl: string,
    startPart: number,
    totalParts: number,
    seriesTitle: string,
    collectionId: string,
    downloadId: string
  ): Promise<void> {
    return bilibiliCollection.downloadRemainingParts(
      baseUrl,
      startPart,
      totalParts,
      seriesTitle,
      collectionId,
      downloadId
    );
  }

  // Helper function to get cookies from cookies.txt
  static getCookieHeader(): string {
    return bilibiliCookie.getCookieHeader();
  }

  // Helper function to download subtitles
  static async downloadSubtitles(
    videoUrl: string,
    baseFilename: string
  ): Promise<Array<{ language: string; filename: string; path: string }>> {
    return bilibiliSubtitle.downloadSubtitles(videoUrl, baseFilename);
  }
}
