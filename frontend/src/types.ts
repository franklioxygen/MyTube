export interface Video {
  id: string;
  title: string;
  author: string;
  date: string;
  source: 'youtube' | 'bilibili';
  sourceUrl: string;
  videoFilename?: string;
  thumbnailFilename?: string;
  thumbnailUrl?: string;
  videoPath?: string;
  thumbnailPath?: string | null;
  addedAt: string;
  partNumber?: number;
  totalParts?: number;
  seriesTitle?: string;
  [key: string]: any;
}

export interface Collection {
  id: string;
  name: string;
  videos: string[];
  createdAt: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface DownloadInfo {
  id: string;
  title: string;
  timestamp?: number;
}
