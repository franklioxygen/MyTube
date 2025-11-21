const storageService = require("./storageService");

class DownloadManager {
  constructor() {
    this.queue = [];
    this.activeDownloads = 0;
    this.maxConcurrentDownloads = 3;
  }

  /**
   * Add a download task to the manager
   * @param {Function} downloadFn - Async function that performs the download
   * @param {string} id - Unique ID for the download
   * @param {string} title - Title of the video being downloaded
   * @returns {Promise} - Resolves when the download is complete
   */
  async addDownload(downloadFn, id, title) {
    return new Promise((resolve, reject) => {
      const task = {
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
  async processQueue() {
    if (
      this.activeDownloads >= this.maxConcurrentDownloads ||
      this.queue.length === 0
    ) {
      return;
    }

    const task = this.queue.shift();
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
  getStatus() {
    return {
      active: this.activeDownloads,
      queued: this.queue.length,
    };
  }
}

// Export a singleton instance
module.exports = new DownloadManager();
