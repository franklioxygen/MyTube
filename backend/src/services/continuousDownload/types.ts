/**
 * Type definitions for continuous download tasks
 */

export interface ContinuousDownloadTask {
  id: string;
  subscriptionId?: string;
  collectionId?: string; // For playlist tasks
  playlistName?: string; // Name of the collection (playlist)
  authorUrl: string;
  author: string;
  platform: string;
  status: "active" | "paused" | "completed" | "cancelled";
  totalVideos: number;
  downloadedCount: number;
  skippedCount: number;
  failedCount: number;
  currentVideoIndex: number;
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  error?: string;
}

