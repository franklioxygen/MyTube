import { Video } from "../../storageService";

export interface BilibiliVideoInfo {
  title: string;
  author: string;
  date: string;
  thumbnailUrl: string | null;
  thumbnailSaved: boolean;
  description?: string;
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

export interface CollectionDownloadResult {
  success: boolean;
  collectionId?: string;
  videosDownloaded?: number;
  error?: string;
}
