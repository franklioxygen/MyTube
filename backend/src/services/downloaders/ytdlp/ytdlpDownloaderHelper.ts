import { BaseDownloader } from "../BaseDownloader";

/**
 * Helper class to access BaseDownloader protected methods without a circular
 * dependency on the concrete YtDlpDownloader subclass. Both ytdlpVideo and
 * ytdlpSubtitle module functions need the cancellation/cleanup/thumbnail
 * helpers, so the accessor lives here to avoid a duplicated definition in each.
 */
export class YtDlpDownloaderHelper extends BaseDownloader {
  async getVideoInfo(): Promise<any> {
    throw new Error("Not implemented");
  }
  async downloadVideo(): Promise<any> {
    throw new Error("Not implemented");
  }

  // Expose protected methods as public for use in module functions
  public handleCancellationErrorPublic(
    error: unknown,
    cleanupFn?: () => void | Promise<void>,
  ): Promise<void> {
    return this.handleCancellationError(error, cleanupFn);
  }

  public throwIfCancelledPublic(downloadId?: string): void {
    return this.throwIfCancelled(downloadId);
  }

  public async downloadThumbnailPublic(
    thumbnailUrl: string,
    savePath: string,
    axiosConfig: any = {},
  ): Promise<boolean> {
    return this.downloadThumbnail(thumbnailUrl, savePath, axiosConfig);
  }
}
