import { Video } from "../storageService";
import { BaseDownloader, DownloadOptions, VideoInfo } from "./BaseDownloader";
import { getLatestVideoUrl } from "./ytdlp/ytdlpChannel";
import { getVideoInfo as getVideoInfoFromModule } from "./ytdlp/ytdlpMetadata";
import { searchVideos } from "./ytdlp/ytdlpSearch";
import { downloadVideo as downloadVideoFromModule } from "./ytdlp/ytdlpVideo";

export class YtDlpDownloader extends BaseDownloader {
  // Search for videos (primarily for YouTube, but could be adapted)
  static async search(
    query: string,
    limit: number = 8,
    offset: number = 1
  ): Promise<any[]> {
    return searchVideos(query, limit, offset);
  }

  // Implementation of IDownloader.getVideoInfo
  async getVideoInfo(url: string): Promise<VideoInfo> {
    return YtDlpDownloader.getVideoInfo(url);
  }

  // Get video info without downloading (Static wrapper)
  static async getVideoInfo(url: string): Promise<VideoInfo> {
    return getVideoInfoFromModule(url);
  }

  // Get the latest video URL from a channel
  static async getLatestVideoUrl(channelUrl: string): Promise<string | null> {
    return getLatestVideoUrl(channelUrl);
  }

  // Get the latest Shorts URL from a channel
  static async getLatestShortsUrl(channelUrl: string): Promise<string | null> {
    const { getLatestShortsUrl } = await import("./ytdlp/ytdlpChannel");
    return getLatestShortsUrl(channelUrl);
  }

  // Implementation of IDownloader.downloadVideo
  async downloadVideo(url: string, options?: DownloadOptions): Promise<Video> {
    return YtDlpDownloader.downloadVideo(
      url,
      options?.downloadId,
      options?.onStart
    );
  }

  // Download video (Static wrapper/Implementation)
  static async downloadVideo(
    videoUrl: string,
    downloadId?: string,
    onStart?: (cancel: () => void) => void
  ): Promise<Video> {
    return downloadVideoFromModule(videoUrl, downloadId, onStart);
  }
}
