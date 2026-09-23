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

/**
 * Minimum interval between persisted progress writes. yt-dlp emits a progress
 * line roughly every 100ms; better-sqlite3 is synchronous so each persisted
 * update blocks the event loop with a committed write. Keeping the latest
 * progress in memory and persisting at most this often removes hundreds of
 * blocking writes per download without sacrificing visible progress accuracy.
 */
const PROGRESS_PERSIST_INTERVAL_MS = 1000;

/**
 * yt-dlp's fragment downloaders (HLS, DASH, ISM) retry a failing fragment and
 * then, by default, carry on without it (`skip_unavailable_fragments`). The
 * merged file keeps its timeline, so its duration is intact and its tracks still
 * agree - nothing measurable afterwards says content is gone. This line, printed
 * once per fragment given up on, is the only direct evidence.
 */
const SKIPPED_FRAGMENT_PATTERN = /Skipping fragment \d+ \.\.\./g;
// Enough of the previous chunk to rejoin a message split across two chunks.
const SKIPPED_FRAGMENT_CARRY_CHARS = 64;

export class ProgressTracker {
  private downloadId?: string;
  // Latest progress not yet persisted (kept so the throttled write catches it).
  private pendingProgress: ProgressUpdate | null = null;
  private lastPersistedAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private skipped = 0;
  private skipCarry = "";

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
   * Update download progress in storage service.
   *
   * Persists at most once per PROGRESS_PERSIST_INTERVAL_MS to avoid hammering
   * the synchronous SQLite writer on every yt-dlp progress line. The latest
   * progress is always kept in memory and flushed either on the next eligible
   * tick, on completion (>= 100%), or when flush()/dispose() is called.
   * @param progress - Progress update to apply
   */
  update(progress: ProgressUpdate): void {
    if (!this.downloadId) {
      return;
    }

    this.pendingProgress = progress;

    // Always persist the final 100% immediately so completion is not delayed.
    const isComplete = progress.percentage >= 100;
    const now = Date.now();
    const due = now - this.lastPersistedAt >= PROGRESS_PERSIST_INTERVAL_MS;

    if (isComplete || due) {
      this.persistNow();
      return;
    }

    // Schedule a flush so the in-memory progress reaches the DB even if no
    // further lines arrive (e.g. a slow tail). Coalesced to a single timer.
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        if (this.pendingProgress) {
          this.persistNow();
        }
      }, PROGRESS_PERSIST_INTERVAL_MS);
    }
  }

  private persistNow(): void {
    if (!this.downloadId || !this.pendingProgress) {
      return;
    }
    const progress = this.pendingProgress;
    this.pendingProgress = null;
    this.lastPersistedAt = Date.now();
    storageService.updateActiveDownload(this.downloadId, {
      progress: progress.percentage,
      totalSize: progress.totalSize,
      downloadedSize: progress.downloadedSize,
      speed: progress.speed,
    });
  }

  /**
   * Force-persist any pending progress. Call on download completion/failure so
   * the final state is written before the active-download row is removed.
   */
  flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.persistNow();
  }

  /**
   * Flush pending progress and stop the scheduled timer. Call when the tracker
   * is no longer needed to avoid leaking a pending timer.
   */
  dispose(): void {
    this.flush();
  }

  /** How many fragments yt-dlp gave up on and left out of the download. */
  get skippedFragments(): number {
    return this.skipped;
  }

  private countSkippedFragments(output: string): void {
    const text = this.skipCarry + output;
    for (const match of text.matchAll(SKIPPED_FRAGMENT_PATTERN)) {
      // A match that ends inside the carried-over text was counted last time.
      if ((match.index ?? 0) + match[0].length > this.skipCarry.length) {
        this.skipped += 1;
      }
    }
    this.skipCarry = text.slice(-SKIPPED_FRAGMENT_CARRY_CHARS);
  }

  /**
   * Parse output and update progress if valid progress data is found
   * @param output - Raw output string from download process
   */
  parseAndUpdate(output: string): void {
    this.countSkippedFragments(output);
    const progress = this.parseYtDlpOutput(output);
    if (progress) {
      this.update(progress);
    }
  }
}

