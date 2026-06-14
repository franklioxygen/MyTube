import { Video } from "../../storageService";

export interface BilibiliVideoInfo {
  title: string;
  author: string;
  date: string;
  thumbnailUrl: string | null;
  thumbnailSaved: boolean;
  description?: string;
  authorAvatarUrl?: string | null;
  authorAvatarSaved?: boolean;
  authorAvatarFilename?: string;
  authorAvatarPath?: string;
  error?: string;
}

export interface BilibiliPartsCheckResult {
  success: boolean;
  videosNumber: number;
  title?: string;
}

export interface BilibiliCollectionCheckResult {
  success: boolean;
  type: "collection" | "series" | "none";
  id?: number;
  title?: string;
  count?: number;
  mid?: number;
}

export interface BilibiliVideoItem {
  bvid: string;
  title: string;
  aid: number;
  uploadDate?: string; // YYYYMMDD
  viewCount?: number; // total views
}

export interface BilibiliVideosResult {
  success: boolean;
  videos: BilibiliVideoItem[];
}

export interface DownloadResult {
  success: boolean;
  videoData?: Video;
  error?: string;
}

export interface BilibiliAggregateDownloadResult {
  success: boolean;
  partial: boolean;
  expectedCount: number;
  downloadedCount: number;
  skippedCount: number;
  failedPartNumbers: number[];
  firstVideo?: Video;
  collectionId?: string;
  videosDownloaded?: number;
  isMultiPart?: boolean;
  isCollection?: boolean;
  totalParts?: number;
  error?: string;
}

export interface CollectionDownloadResult extends BilibiliAggregateDownloadResult {}
