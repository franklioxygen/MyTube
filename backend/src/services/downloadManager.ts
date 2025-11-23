import * as storageService from "./storageService";

interface DownloadTask {
  downloadFn: () => Promise<any>;
  id: string;
  title: string;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

class DownloadManager {
  private queue: DownloadTask[];
  private activeDownloads: number;
  private maxConcurrentDownloads: number;

  constructor() {
    this.queue = [];
    this.activeDownloads = 0;
    this.maxConcurrentDownloads = 3;
  }

  /**
   * Set the maximum number of concurrent downloads
   * @param limit - Maximum number of concurrent downloads
   */
  setMaxConcurrentDownloads(limit: number): void {
    this.maxConcurrentDownloads = limit;
    this.processQueue();
  }

  /**
   * Add a download task to the manager
   * @param downloadFn - Async function that performs the download
   * @param id - Unique ID for the download
   * @param title - Title of the video being downloaded
   * @returns - Resolves when the download is complete
   */
  async addDownload(
    downloadFn: () => Promise<any>,
    id: string,
    title: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const task: DownloadTask = {
        downloadFn,
        id,
        title,
        resolve,
        reject,
      };

      this.queue.push(task);
      this.processQueue();
    });
  }

  /**
   * Process the download queue
   */
  private async processQueue(): Promise<void> {
    if (
      this.activeDownloads >= this.maxConcurrentDownloads ||
      this.queue.length === 0
    ) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.activeDownloads++;

    // Update status in storage
    storageService.addActiveDownload(task.id, task.title);

    try {
      console.log(`Starting download: ${task.title} (${task.id})`);
      const result = await task.downloadFn();

      // Download complete
      storageService.removeActiveDownload(task.id);
      this.activeDownloads--;
      task.resolve(result);
    } catch (error) {
      console.error(`Error downloading ${task.title}:`, error);

      // Download failed
      storageService.removeActiveDownload(task.id);
      this.activeDownloads--;
      task.reject(error);
    } finally {
      // Process next item in queue
      this.processQueue();
    }
  }

  /**
   * Get current status
   */
  getStatus(): { active: number; queued: number } {
    return {
      active: this.activeDownloads,
      queued: this.queue.length,
    };
  }
}

// Export a singleton instance
export default new DownloadManager();
