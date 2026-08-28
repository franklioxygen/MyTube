import type { Video } from "../storageService";

export type MediaServerExportMode = "off" | "nfo" | "nfo_and_source_json";
export type MediaServerExportLayout = "adjacent" | "playlist_tv";

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
  layoutOverride?: MediaServerExportLayout;
  /**
   * Set by a downloader whose caller links the new video to a source-backed
   * collection right afterwards. In `playlist_tv` the export is deferred to the
   * collection-link hook, so the video is never briefly published into Season 00
   * before its real season is known.
   */
  pendingCollectionLink?: boolean;
}

export interface RemoveMediaServerArtifactsOptions {
  libraryVideos?: Video[];
  layoutOverride?: MediaServerExportLayout;
}

export type MediaServerExportSkipReason =
  | "unsupported_export_mode"
  | "no_local_video_path"
  | "cloud_path"
  | "mount_path"
  | "external_http_path"
  | "video_file_missing"
  | "audio_media"
  | "unresolved_show_identity"
  | "ambiguous_collection_show"
  | "collection_not_source_playlist"
  | "invalid_catalog_assignment"
  | "hard_link_failed_copy_disabled"
  | "artifact_path_collision"
  | "artifact_ownership_mismatch"
  | "source_changed_during_materialization";

export interface MediaServerExportJobItem {
  videoId: string;
  title: string;
  status: "pending" | "success" | "skipped" | "failed";
  skipReason?: MediaServerExportSkipReason;
  errorCode?: MediaServerExportSkipReason;
  error?: string;
}

export type MediaServerExportJobPhase =
  | "snapshot"
  | "catalog_reconcile"
  | "plan"
  | "materialize"
  | "sweep"
  | "completed";

export interface MediaServerExportJobCounts {
  shows: number;
  seasons: number;
  episodes: number;
  linkedMedia: number;
  copiedMedia: number;
  unchangedArtifacts: number;
  removedArtifacts: number;
}

export interface MediaServerExportJob {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  lockedAt: number;
  mode: MediaServerExportMode;
  layout: MediaServerExportLayout;
  action: "rebuild" | "cleanup";
  phase: MediaServerExportJobPhase;
  total: number;
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  sweptFiles: number;
  sweptList?: string[];
  counts: MediaServerExportJobCounts;
  currentVideoId?: string;
  currentTitle?: string;
  items: MediaServerExportJobItem[];
  cancelRequested: boolean;
}

/* ------------------------------------------------------------------ */
/* Managed playlist-TV mirror (issue #411)                             */
/* ------------------------------------------------------------------ */

export interface MediaServerShow {
  id: string;
  identityKey: string;
  sourcePlatform: string;
  sourceChannelId?: string;
  sourceChannelUrl?: string;
  title: string;
  description: string;
  directoryName: string;
  nextSeasonNumber: number;
}

export interface MediaServerEpisodeAssignment {
  id: string;
  showId: string;
  collectionId?: string;
  videoId: string;
  seasonNumber: number;
  episodeNumber: number;
  sourcePosition?: number;
  exportStem: string;
}

export type MediaServerArtifactType =
  | "show_nfo"
  | "show_poster"
  | "season_nfo"
  | "episode_media"
  | "episode_nfo"
  | "episode_thumb"
  | "episode_subtitle"
  | "source_json";

export type MediaServerMaterialization =
  | "generated_text"
  | "copied_image"
  | "hard_link"
  | "copied_media"
  | "copied_subtitle";

export interface MediaServerExportArtifact {
  /** POSIX-normalized path relative to MEDIA_SERVER_LIBRARY_DIR. */
  relativePath: string;
  artifactType: MediaServerArtifactType;
  showId?: string;
  assignmentId?: string;
  sourceAbsolutePath?: string;
  sourceSize?: number;
  sourceMtimeMs?: number;
  materialization: MediaServerMaterialization;
}

export interface MediaServerExportSkip {
  videoId?: string;
  collectionId?: string;
  title: string;
  reason: MediaServerExportSkipReason;
  detail?: string;
}

/**
 * One planned output file. `content` is set for generated text, otherwise
 * `sourceAbsolutePath` names the local file to link or copy.
 */
export interface PlannedArtifact {
  relativePath: string;
  artifactType: MediaServerArtifactType;
  materialization: MediaServerMaterialization;
  content?: string;
  sourceAbsolutePath?: string;
  assignmentId?: string;
}

export interface HierarchyEpisodePlan {
  assignmentId: string;
  videoId: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  artifacts: PlannedArtifact[];
}

export interface HierarchySeasonPlan {
  seasonNumber: number;
  collectionId?: string;
  artifacts: PlannedArtifact[];
  episodes: HierarchyEpisodePlan[];
}

export interface HierarchyShowPlan {
  showId: string;
  directoryName: string;
  artifacts: PlannedArtifact[];
  seasons: HierarchySeasonPlan[];
}

export interface HierarchyPlan {
  shows: HierarchyShowPlan[];
  skips: MediaServerExportSkip[];
}

export interface MediaServerSeasonMetadata {
  showId: string;
  seasonNumber: number;
  collectionId?: string;
  title: string;
  description: string;
}

export interface MediaServerCatalogSnapshot {
  shows: MediaServerShow[];
  seasons: MediaServerSeasonMetadata[];
  assignments: MediaServerEpisodeAssignment[];
  videosById: Map<string, Video>;
  /**
   * Raw yt-dlp info per video, available only right after a download. Layered
   * into `.info.json` so the managed mirror preserves exactly what the adjacent
   * layout preserves.
   */
  rawInfoByVideoId?: Map<string, unknown>;
}
