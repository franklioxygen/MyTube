import type { Video } from "../storageService";

export type MediaServerExportMode = "off" | "nfo" | "nfo_and_source_json";

export interface ParsedTvLayout {
  isTvCompatible: boolean;
  showRootName?: string;
  showRootRelativeDir?: string;
  seasonDirectoryName?: string;
  seasonNumber?: number;
  episodeToken?: string;
  episodeNumber?: number;
}

export interface MediaServerExportPlan {
  videoAbsolutePath: string;
  videoRelativePath: string;
  basenameWithoutExt: string;
  episodeNfoAbsolutePath: string;
  episodeSourceJsonAbsolutePath: string;
  episodeThumbAliasAbsolutePath: string;
  showNfoAbsolutePath?: string;
  showPosterAbsolutePaths: string[];
  tvLayout: ParsedTvLayout;
}

export interface SyncMediaServerArtifactsOptions {
  rawSourceInfo?: unknown;
  libraryVideos?: Video[];
  modeOverride?: Exclude<MediaServerExportMode, "off">;
}

export interface RemoveMediaServerArtifactsOptions {
  libraryVideos?: Video[];
}

export interface MediaServerExportJobItem {
  videoId: string;
  title: string;
  status: "pending" | "success" | "skipped" | "failed";
  skipReason?:
    | "unsupported_export_mode"
    | "no_local_video_path"
    | "cloud_path"
    | "mount_path"
    | "external_http_path"
    | "video_file_missing";
  error?: string;
}

export interface MediaServerExportJob {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  lockedAt: number;
  mode: MediaServerExportMode;
  action: "rebuild" | "cleanup";
  total: number;
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  currentVideoId?: string;
  currentTitle?: string;
  items: MediaServerExportJobItem[];
  cancelRequested: boolean;
}
