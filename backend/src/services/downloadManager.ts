import { extractSourceVideoId } from "../utils/helpers";
import { CloudStorageService } from "./CloudStorageService";
import { createDownloadTask } from "./downloadService";
import * as storageService from "./storageService";

interface DownloadTask {
  downloadFn: (registerCancel: (cancel: () => void) => void) => Promise<any>;
  id: string;
  title: string;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  cancelFn?: () => void;
  sourceUrl?: string;
  type?: string;
  cancelled?: boolean;
}

class DownloadManager {
  private queue: DownloadTask[];
  private activeTasks: Map<string, DownloadTask>;
  private activeDownloads: number;
  private maxConcurrentDownloads: number;

  constructor() {
    this.queue = [];
    this.activeTasks = new Map();
    this.activeDownloads = 0;
    this.maxConcurrentDownloads = 3; // Default
  }

  private async loadSettings() {
    try {
      const settings = storageService.getSettings();
      if (settings.maxConcurrentDownloads) {
        this.maxConcurrentDownloads = settings.maxConcurrentDownloads;
        console.log(`Loaded maxConcurrentDownloads from database: ${this.maxConcurrentDownloads}`);
      }
    } catch (error) {
      console.error("Error loading settings in DownloadManager:", error);
    }
  }

  /**
   * Initialize the download manager and restore queued tasks
   */
  initialize(): void {
    try {
      console.log("Initializing DownloadManager...");
      this.loadSettings();
      const status = storageService.getDownloadStatus();
      const queuedDownloads = status.queuedDownloads;

      if (queuedDownloads && queuedDownloads.length > 0) {
        console.log(`Restoring ${queuedDownloads.length} queued downloads...`);
        
        for (const download of queuedDownloads) {
          if (download.sourceUrl && download.type) {
            console.log(`Restoring task: ${download.title} (${download.id})`);
            
            // Reconstruct the download function
            const downloadFn = createDownloadTask(
              download.type,
              download.sourceUrl,
              download.id
            );

            // Add to queue without persisting (since it's already in DB)
            // We need to manually construct the task and push to queue
            // We can't use addDownload because it returns a promise that we can't easily attach to
            // But for restored tasks, we don't have a client waiting for the promise anyway.
            
            const task: DownloadTask = {
              downloadFn,
              id: download.id,
              title: download.title,
              sourceUrl: download.sourceUrl,
              type: download.type,
              resolve: (val) => console.log(`Restored task ${download.id} completed`, val),
              reject: (err) => console.error(`Restored task ${download.id} failed`, err),
            };

            this.queue.push(task);
          } else {
            console.warn(`Skipping restoration of task ${download.id} due to missing sourceUrl or type`);
          }
        }
        
        // Trigger processing
        this.processQueue();
      }
    } catch (error) {
      console.error("Error initializing DownloadManager:", error);
    }
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
   * @param sourceUrl - Source URL of the video
   * @param type - Type of the download (youtube, bilibili, missav)
   * @returns - Resolves when the download is complete
   */
  async addDownload(
    downloadFn: (registerCancel: (cancel: () => void) => void) => Promise<any>,
    id: string,
    title: string,
    sourceUrl?: string,
    type?: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const task: DownloadTask = {
        downloadFn,
        id,
        title,
        resolve,
        reject,
        sourceUrl,
        type,
      };

      this.queue.push(task);
      this.updateQueuedDownloads();
      this.processQueue();
    });
  }

  /**
   * Cancel an active download
   * @param id - ID of the download to cancel
   */
  cancelDownload(id: string): void {
    const task = this.activeTasks.get(id);
    if (task) {
      console.log(`Cancelling active download: ${task.title} (${id})`);
      task.cancelled = true;
      
      // Call the cancel function if available
      if (task.cancelFn) {
        try {
          task.cancelFn();
        } catch (error) {
          console.error(`Error calling cancel function for ${id}:`, error);
        }
      }
      
      // Explicitly remove from database and clean up state
      // This ensures cleanup happens even if cancelFn doesn't properly reject
      storageService.removeActiveDownload(id);
      
      // Add to history as cancelled/failed
      storageService.addDownloadHistoryItem({
        id: task.id,
        title: task.title,
        finishedAt: Date.now(),
        status: 'failed',
        error: 'Download cancelled by user',
        sourceUrl: task.sourceUrl,
      });
      
      // Clean up internal state
      this.activeTasks.delete(id);
      this.activeDownloads--;
      
      // Reject the promise
      task.reject(new Error('Download cancelled by user'));
      
      // Process next item in queue
      this.processQueue();
    } else {
      // Check if it's in the queue and remove it
      const inQueue = this.queue.some(t => t.id === id);
      if (inQueue) {
        console.log(`Removing queued download: ${id}`);
        this.removeFromQueue(id);
      }
    }
  }

  /**
   * Remove a download from the queue
   * @param id - ID of the download to remove
   */
  removeFromQueue(id: string): void {
    this.queue = this.queue.filter(task => task.id !== id);
    this.updateQueuedDownloads();
  }

  /**
   * Clear the download queue
   */
  clearQueue(): void {
    this.queue = [];
    this.updateQueuedDownloads();
  }

  /**
   * Update the queued downloads in storage
   */
  private updateQueuedDownloads(): void {
    const queuedDownloads = this.queue.map(task => ({
      id: task.id,
      title: task.title,
      timestamp: Date.now(),
      sourceUrl: task.sourceUrl,
      type: task.type,
    }));
    storageService.setQueuedDownloads(queuedDownloads);
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

    this.updateQueuedDownloads();
    this.activeDownloads++;
    this.activeTasks.set(task.id, task);

    // Update status in storage
    storageService.addActiveDownload(task.id, task.title);
    // Update with extra info if available
    if (task.sourceUrl || task.type) {
        storageService.updateActiveDownload(task.id, {
            sourceUrl: task.sourceUrl,
            type: task.type
        });
    }

    try {
      console.log(`Starting download: ${task.title} (${task.id})`);
      const result = await task.downloadFn((cancel) => {
        task.cancelFn = cancel;
      });

      // Download complete
      storageService.removeActiveDownload(task.id);
      
      // Extract video data from result
      // videoController returns { success: true, video: ... }
      // But some downloaders might return the video object directly or different structure
      const videoData = result.video || result;

      console.log(`Download finished for ${task.title}. Result title: ${videoData.title}`);

      // Determine best title
      let finalTitle = videoData.title;
      const genericTitles = ["YouTube Video", "Bilibili Video", "MissAV Video", "Video"];
      if (!finalTitle || genericTitles.includes(finalTitle)) {
          if (task.title && !genericTitles.includes(task.title)) {
              finalTitle = task.title;
          }
      }

      // Add to history
      if (!task.cancelled) {
        storageService.addDownloadHistoryItem({
          id: task.id,
          title: finalTitle || task.title,
          finishedAt: Date.now(),
          status: 'success',
          videoPath: videoData.videoPath,
          thumbnailPath: videoData.thumbnailPath,
          sourceUrl: videoData.sourceUrl || task.sourceUrl,
          author: videoData.author,
          videoId: videoData.id,
        });

        // Record video download for future duplicate detection
        const sourceUrl = videoData.sourceUrl || task.sourceUrl;
        if (sourceUrl && videoData.id) {
          const { id: sourceVideoId, platform } = extractSourceVideoId(sourceUrl);
          if (sourceVideoId) {
            // Check if this is a re-download of previously deleted video
            const existingRecord = storageService.checkVideoDownloadBySourceId(sourceVideoId);
            if (existingRecord.found && existingRecord.status === "deleted") {
              // Update existing record
              storageService.updateVideoDownloadRecord(
                sourceVideoId,
                videoData.id,
                finalTitle || task.title,
                videoData.author
              );
            } else if (!existingRecord.found) {
              // New download, create record
              storageService.recordVideoDownload(
                sourceVideoId,
                sourceUrl,
                platform,
                videoData.id,
                finalTitle || task.title,
                videoData.author
              );
            }
          }
        }
      }

      // Trigger Cloud Upload (Async, don't await to block queue processing?)
      // Actually, we might want to await it if we want to ensure it's done before resolving,
      // but that would block the download queue.
      // Let's run it in background but log it.
      CloudStorageService.uploadVideo({
        ...videoData,
        title: finalTitle || task.title,
        sourceUrl: task.sourceUrl
      }).catch(err => console.error("Background cloud upload failed:", err));

      task.resolve(result);
    } catch (error) {
      console.error(`Error downloading ${task.title}:`, error);

      // Download failed
      storageService.removeActiveDownload(task.id);

      // Add to history
      if (!task.cancelled) {
        storageService.addDownloadHistoryItem({
          id: task.id,
          title: task.title,
          finishedAt: Date.now(),
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          sourceUrl: task.sourceUrl,
        });
      }

      task.reject(error);
    } finally {
      // Only clean up if the task wasn't already cleaned up by cancelDownload
      if (this.activeTasks.has(task.id)) {
        this.activeTasks.delete(task.id);
        this.activeDownloads--;
      }
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
