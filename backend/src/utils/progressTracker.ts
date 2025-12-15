/**
 * ProgressTracker utility for parsing and tracking download progress
 * Centralizes progress parsing logic used across multiple downloaders
 */

import * as storageService from "../services/storageService";
import { calculateDownloadedSize, parseSize } from "./downloadUtils";

export interface ProgressUpdate {
  percentage: number;
  downloadedSize: string;
  totalSize: string;
  speed: string;
}

export class ProgressTracker {
  private downloadId?: string;

  constructor(downloadId?: string) {
    this.downloadId = downloadId;
  }

  /**
   * Parse yt-dlp progress output from stdout/stderr
   * Handles multiple formats:
   * - [download]  23.5% of 10.00MiB at  2.00MiB/s ETA 00:05
   * - [download] 55.8MiB of 123.45MiB at 5.67MiB/s ETA 00:12
   * - 23.5% of ~10.00MiB at 2.00MiB/s
   */
  parseYtDlpOutput(output: string): ProgressUpdate | null {
    // Try to match format with percentage: [download]  23.5% of 10.00MiB at  2.00MiB/s
    let progressMatch = output.match(
      /(\d+\.?\d*)%\s+of\s+~?\s*([~\d\w.]+)\s+at\s+([~\d\w.\/]+)/
    );

    if (progressMatch && progressMatch.length >= 4) {
      const percentage = parseFloat(progressMatch[1]);
      const totalSize = progressMatch[2].replace(/^~/, ""); // Remove ~ prefix if present
      const speed = progressMatch[3];

      // Check if the original output had ~ prefix
      const hasTilde =
        output.includes(`of ~ ${totalSize}`) ||
        output.includes(`of ~${totalSize}`);
      const formattedTotalSize = hasTilde ? `~${totalSize}` : totalSize;

      const downloadedSize = calculateDownloadedSize(
        percentage,
        formattedTotalSize
      );

      return {
        percentage,
        downloadedSize,
        totalSize: formattedTotalSize,
        speed,
      };
    }

    // Try to match format with explicit sizes: [download] 55.8MiB of 123.45MiB at 5.67MiB/s
    const progressWithSizeMatch = output.match(
      /([~\d\w.]+)\s+of\s+([~\d\w.]+)\s+at\s+([~\d\w.\/]+)/
    );

    if (progressWithSizeMatch && progressWithSizeMatch.length >= 4) {
      const downloadedSize = progressWithSizeMatch[1];
      const totalSize = progressWithSizeMatch[2];
      const speed = progressWithSizeMatch[3];

      // Calculate percentage from downloaded and total sizes
      const downloadedBytes = parseSize(downloadedSize);
      const totalBytes = parseSize(totalSize);
      const percentage = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

      return {
        percentage,
        downloadedSize,
        totalSize,
        speed,
      };
    }

    // Try to match segment-based progress: [download] Downloading segment 5 of 10
    const segmentMatch = output.match(
      /\[download\]\s+Downloading\s+segment\s+(\d+)\s+of\s+(\d+)/
    );

    if (segmentMatch && segmentMatch.length >= 3) {
      const current = parseInt(segmentMatch[1]);
      const total = parseInt(segmentMatch[2]);
      const percentage = (current / total) * 100;

      return {
        percentage,
        downloadedSize: `${current}/${total} segments`,
        totalSize: `${total} segments`,
        speed: "0 B/s",
      };
    }

    return null;
  }

  /**
   * Update download progress in storage service
   * @param progress - Progress update to apply
   */
  update(progress: ProgressUpdate): void {
    if (!this.downloadId) {
      return;
    }

    storageService.updateActiveDownload(this.downloadId, {
      progress: progress.percentage,
      totalSize: progress.totalSize,
      downloadedSize: progress.downloadedSize,
      speed: progress.speed,
    });
  }

  /**
   * Parse output and update progress if valid progress data is found
   * @param output - Raw output string from download process
   */
  parseAndUpdate(output: string): void {
    const progress = this.parseYtDlpOutput(output);
    if (progress) {
      this.update(progress);
    }
  }
}

