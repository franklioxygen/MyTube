import { Collection, Video } from "../../types";

export interface DownloadInfo {
  id: string;
  title: string;
  timestamp?: number;
  filename?: string;
  totalSize?: string;
  downloadedSize?: string;
  progress?: number;
  speed?: string;
}

export interface HeaderProps {
  onSubmit: (url: string) => Promise<any>;
  onSearch: (term: string) => Promise<any>;
  activeDownloads?: DownloadInfo[];
  queuedDownloads?: DownloadInfo[];
  isSearchMode?: boolean;
  searchTerm?: string;
  onResetSearch?: () => void;
  collections?: Collection[];
  videos?: Video[];
}
