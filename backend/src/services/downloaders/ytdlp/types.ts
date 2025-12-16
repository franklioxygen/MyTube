import { Video } from "../../storageService";

export interface YtDlpVideoInfo {
  title: string;
  author: string;
  date: string;
  thumbnailUrl: string | null;
  thumbnailSaved: boolean;
  description?: string;
  source?: string;
}

export interface YtDlpDownloadContext {
  videoUrl: string;
  downloadId?: string;
  onStart?: (cancel: () => void) => void;
  baseFilename: string;
  videoFilename: string;
  thumbnailFilename: string;
  videoPath: string;
  thumbnailPath: string;
}

