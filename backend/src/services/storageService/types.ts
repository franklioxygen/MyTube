export interface Video {
  id: string;
  title: string;
  sourceUrl: string;
  videoFilename?: string;
  thumbnailFilename?: string;
  subtitles?: Array<{ language: string; filename: string; path: string }>;
  createdAt: string;
  tags?: string[];
  viewCount?: number;
  progress?: number;
  fileSize?: string;
  description?: string;
  [key: string]: any;
}

export interface Collection {
  id: string;
  title: string;
  videos: string[];
  updatedAt?: string;
  name?: string;
  [key: string]: any;
}

export interface DownloadInfo {
  id: string;
  title: string;
  timestamp: number;
  filename?: string;
  totalSize?: string;
  downloadedSize?: string;
  progress?: number;
  speed?: string;
  sourceUrl?: string;
  type?: string;
}

export interface DownloadHistoryItem {
  id: string;
  title: string;
  author?: string;
  sourceUrl?: string;
  finishedAt: number;
  status: "success" | "failed" | "skipped" | "deleted";
  error?: string;
  videoPath?: string;
  thumbnailPath?: string;
  totalSize?: string;
  videoId?: string; // Reference to the video for skipped items
  downloadedAt?: number; // Original download timestamp for deleted items
  deletedAt?: number; // Deletion timestamp for deleted items
  subscriptionId?: string; // Reference to subscription if downloaded via subscription
  taskId?: string; // Reference to continuous download task if downloaded via task
}

export interface VideoDownloadRecord {
  id: string;
  sourceVideoId: string;
  sourceUrl: string;
  platform: string;
  videoId?: string;
  title?: string;
  author?: string;
  status: "exists" | "deleted";
  downloadedAt: number;
  deletedAt?: number;
}

export interface VideoDownloadCheckResult {
  found: boolean;
  status?: "exists" | "deleted";
  videoId?: string;
  title?: string;
  author?: string;
  downloadedAt?: number;
  deletedAt?: number;
}

export interface DownloadStatus {
  activeDownloads: DownloadInfo[];
  queuedDownloads: DownloadInfo[];
}

