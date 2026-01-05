import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { DownloadCancelledError } from "../../errors/DownloadErrors";
import {
  isCancellationError,
  isDownloadActive,
} from "../../utils/downloadUtils";
import { formatVideoFilename } from "../../utils/helpers";
import { logger } from "../../utils/logger";
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
  search?(query: string, limit?: number, offset?: number): Promise<any[]>;
  getLatestVideoUrl?(url: string): Promise<string | null>;
}

export abstract class BaseDownloader implements IDownloader {
  abstract getVideoInfo(url: string): Promise<VideoInfo>;

  abstract downloadVideo(
    url: string,
    options?: DownloadOptions
  ): Promise<Video>;

  // Default timeout for thumbnail downloads (60 seconds)
  protected static readonly THUMBNAIL_DOWNLOAD_TIMEOUT = 60000;

  /**
   * Common helper to download a thumbnail
   */
  protected async downloadThumbnail(
    thumbnailUrl: string,
    savePath: string,
    axiosConfig: any = {}
  ): Promise<boolean> {
    try {
      logger.info("Downloading thumbnail from:", thumbnailUrl);
      if (axiosConfig.proxy || axiosConfig.httpAgent) {
        logger.debug("Using proxy for thumbnail download");
      }

      // Ensure directory exists
      fs.ensureDirSync(path.dirname(savePath));

      const response = await axios({
        method: "GET",
        url: thumbnailUrl,
        responseType: "stream",
        timeout: BaseDownloader.THUMBNAIL_DOWNLOAD_TIMEOUT,
        ...axiosConfig,
      });

      const writer = fs.createWriteStream(savePath);
      response.data.pipe(writer);

      return new Promise<boolean>((resolve, reject) => {
        writer.on("finish", () => {
          logger.info("Thumbnail saved to:", savePath);
          resolve(true);
        });
        writer.on("error", (err) => {
          logger.error("Error writing thumbnail file:", err);
          reject(err);
        });
      });
    } catch (error) {
      logger.error("Error downloading thumbnail:", error);
      return false;
    }
  }

  /**
   * Helper to format filename using the standard utility
   */
  protected getSafeFilename(
    title: string,
    author: string,
    date: string
  ): string {
    return formatVideoFilename(title, author, date);
  }

  /**
   * Check if download was cancelled and throw if so
   * Common cancellation check used across all downloaders
   * @param downloadId - The download ID to check
   * @throws DownloadCancelledError if download was cancelled
   */
  protected throwIfCancelled(downloadId?: string): void {
    if (!isDownloadActive(downloadId)) {
      logger.info("Download was cancelled (no longer in active downloads)");
      throw DownloadCancelledError.create();
    }
  }

  /**
   * Handle cancellation errors consistently
   * Checks if error is a cancellation error and throws DownloadCancelledError
   * @param error - The error to check
   * @param cleanupFn - Optional cleanup function to call before throwing
   * @throws DownloadCancelledError if error is a cancellation error
   */
  protected async handleCancellationError(
    error: unknown,
    cleanupFn?: () => void | Promise<void>
  ): Promise<void> {
    if (isCancellationError(error)) {
      logger.info("Download was cancelled");
      if (cleanupFn) {
        await cleanupFn();
      }
      throw DownloadCancelledError.create();
    }
  }
}
