export type MediaType = "video" | "audio";

export function normalizeMediaType(value: unknown): MediaType {
  return value === "audio" ? "audio" : "video";
}

export interface Video {
  id: string;
  title: string;
  sourceUrl: string;
  sourceVideoId?: string | null;
  videoFilename?: string;
  thumbnailFilename?: string;
  subtitles?: Array<{ language: string; filename: string; path: string }>;
  createdAt: string;
  tags?: string[];
  viewCount?: number;
  progress?: number;
  progressUpdatedAt?: number;
  fileSize?: string;
  width?: number;
  height?: number;
  mediaType?: MediaType;
  /** Transient result metadata for this download attempt; never saved with the video. */
  incompleteDownloadNote?: IncompleteDownloadNote;
  description?: string;
  // null/0 = auto-delete eligible (unlocked), 1 = locked (protected from all
  // automatic deletion). See db/schema.ts videos.auto_delete_locked.
  autoDeleteLocked?: number | null;
  [key: string]: any;
}

export type CollectionOrigin = "manual" | "author_auto";

export interface Collection {
  id: string;
  title: string;
  videos: string[];
  updatedAt?: string;
  name?: string;
  origin?: CollectionOrigin;
  // Stable source identity used to reuse the same collection on re-download/repair
  // (issue #295). See db/schema.ts collections table.
  sourcePlatform?: string;
  sourceType?: string;
  sourceMid?: string;
  sourceId?: string;
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
  retryMetadata?: string;
}

/**
 * What a download saved with content missing lost. Stored as JSON in the
 * history row's `error` and rendered by the client, in the viewer's language.
 */
export interface IncompleteDownloadNote {
  kind: "incomplete_download";
  /** Fragments yt-dlp gave up on and left out. */
  skippedFragments: number;
  /** Where the content is missing; empty when the gaps could not be located. */
  gaps: Array<{ stream: "video" | "audio"; atSeconds: number; gapSeconds: number }>;
}

/** Keep an attempt's note with its result, even when another attempt saves the same video ID. */
export function withIncompleteDownloadNote<T extends Video>(
  video: T,
  note: IncompleteDownloadNote | null
): T {
  return { ...video, incompleteDownloadNote: note ?? undefined };
}

export interface DownloadHistoryItem {
  id: string;
  title: string;
  author?: string;
  sourceUrl?: string;
  finishedAt: number;
  status: "success" | "failed" | "partial" | "skipped" | "deleted" | "pending_retry";
  error?: string;
  /** Transient note from the matching download result, serialized into `error`. */
  incompleteDownloadNote?: IncompleteDownloadNote;
  videoPath?: string;
  thumbnailPath?: string;
  totalSize?: string;
  videoId?: string; // Reference to the video for skipped items
  downloadedAt?: number; // Original download timestamp for deleted items
  deletedAt?: number; // Deletion timestamp for deleted items
  // Audio and video of one source are separate items. A deleted-history row is
  // the only per-item record of a deleted multipart part, so it has to say
  // which of the two it was. Absent on legacy rows, which read as video.
  mediaType?: MediaType;
  subscriptionId?: string; // Reference to subscription if downloaded via subscription
  taskId?: string; // Reference to continuous download task if downloaded via task
  platform?: string; // canonical lowercase, statistics-friendly bucket
  sourceKind?: string; // canonical lowercase, statistics-friendly bucket
  downloadType?: string;
  retryCount?: number;
  retryLimit?: number;
  retryIntervalMinutes?: number;
  nextRetryAt?: number;
  retryMetadata?: string;
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
  /**
   * Source URL of the matched tracking row. Lets callers tell *which* item the
   * shared source video id actually matched — needed for multipart Bilibili
   * videos, where every part collapses onto one tracking row.
   */
  sourceUrl?: string;
}

export interface DownloadStatus {
  activeDownloads: DownloadInfo[];
  queuedDownloads: DownloadInfo[];
}
