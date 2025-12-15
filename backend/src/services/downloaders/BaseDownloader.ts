import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { formatVideoFilename } from "../../utils/helpers";
import { Video } from "../storageService";

export interface VideoInfo {
  title: string;
  author: string;
  date: string;
  thumbnailUrl: string | null;
  description?: string;
  duration?: string;
}

export interface DownloadOptions {
  downloadId?: string;
  onStart?: (cancel: () => void) => void;
  // Generic key-value store for specific downloader options
  [key: string]: any;
}

export interface IDownloader {
  getVideoInfo(url: string): Promise<VideoInfo>;
  downloadVideo(url: string, options?: DownloadOptions): Promise<Video>;
}

export abstract class BaseDownloader implements IDownloader {
  abstract getVideoInfo(url: string): Promise<VideoInfo>;

  abstract downloadVideo(url: string, options?: DownloadOptions): Promise<Video>;

  /**
   * Common helper to download a thumbnail
   */
  protected async downloadThumbnail(
    thumbnailUrl: string,
    savePath: string
  ): Promise<boolean> {
    try {
      console.log("Downloading thumbnail from:", thumbnailUrl);

      // Ensure directory exists
      fs.ensureDirSync(path.dirname(savePath));

      const response = await axios({
        method: "GET",
        url: thumbnailUrl,
        responseType: "stream",
      });

      const writer = fs.createWriteStream(savePath);
      response.data.pipe(writer);

      return new Promise<boolean>((resolve, reject) => {
        writer.on("finish", () => {
          console.log("Thumbnail saved to:", savePath);
          resolve(true);
        });
        writer.on("error", (err) => {
          console.error("Error writing thumbnail file:", err);
          reject(err);
        });
      });
    } catch (error) {
      console.error("Error downloading thumbnail:", error);
      return false;
    }
  }

  /**
   * Helper to format filename using the standard utility
   */
  protected getSafeFilename(title: string, author: string, date: string): string {
    return formatVideoFilename(title, author, date);
  }
}
