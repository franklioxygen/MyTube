import { Video } from "../storageService";
import {
  BaseDownloader,
  DownloadModeOptions,
  DownloadOptions,
  VideoInfo,
} from "./BaseDownloader";
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
  static async getLatestVideoUrl(
    channelUrl: string,
    subscriptionYtdlpConfig?: string | null
  ): Promise<string | null> {
    return getLatestVideoUrl(channelUrl, subscriptionYtdlpConfig);
  }

  // Get the latest Shorts URL from a channel
  static async getLatestShortsUrl(
    channelUrl: string,
    subscriptionYtdlpConfig?: string | null
  ): Promise<string | null> {
    const { getLatestShortsUrl } = await import("./ytdlp/ytdlpChannel");
    return getLatestShortsUrl(channelUrl, subscriptionYtdlpConfig);
  }

  // Implementation of IDownloader.downloadVideo
  async downloadVideo(url: string, options?: DownloadOptions): Promise<Video> {
    return YtDlpDownloader.downloadVideo(url, options);
  }

  // Download video (Static wrapper/Implementation). The positional overload is
  // retained for existing integrations; new callers use DownloadModeOptions.
  static async downloadVideo(
    videoUrl: string,
    options?: DownloadModeOptions,
  ): Promise<Video>;
  static async downloadVideo(
    videoUrl: string,
    downloadId?: string,
    onStart?: (cancel: () => void) => void,
    filenameTemplateSourceOptions?: import("../filenameTemplate/types").FilenameTemplateSourceOptions,
  ): Promise<Video>;
  static async downloadVideo(
    videoUrl: string,
    downloadId?: string | DownloadModeOptions,
    onStart?: (cancel: () => void) => void,
    filenameTemplateSourceOptions?: import("../filenameTemplate/types").FilenameTemplateSourceOptions
  ): Promise<Video> {
    if (typeof downloadId === "object" && downloadId !== null) {
      return downloadVideoFromModule(videoUrl, downloadId);
    }
    return downloadVideoFromModule(videoUrl, {
      downloadId,
      onStart,
      filenameTemplateSourceOptions,
    });
  }
}
