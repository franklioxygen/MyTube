import type {
  Collection,
  MediaServerEpisodeAssignment,
  MediaServerExportArtifact,
  MediaServerShow,
  Video,
} from "../storageService/types";

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
  /** Issue #411. Absent means "use the saved setting", which defaults to adjacent. */
  layoutOverride?: MediaServerExportLayout;
  /**
   * Issue #411. Set by a playlist-origin download so the mirror is built by the
   * later collection-link call instead. Without it the video would first be
   * exported as an unassigned Season 00 episode, and episode numbering is
   * immutable once written.
   */
  suppressPlaylistTvSync?: boolean;
}

export interface RemoveMediaServerArtifactsOptions {
  libraryVideos?: Video[];
  layoutOverride?: MediaServerExportLayout;
}

/**
 * Machine-readable reasons an item was skipped or failed. The first six are the
 * historical adjacent-mode reasons and must keep their meaning; the rest are
 * added by the playlist_tv layout (issue #411).
 */
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
  /** Same vocabulary as `skipReason`, reported when `status === "failed"`. */
  errorCode?: MediaServerExportSkipReason;
  error?: string;
}

// ---------------------------------------------------------------------------
// Playlist-TV hierarchy (issue #411)
// ---------------------------------------------------------------------------

/**
 * A consistent read of everything the planner needs. Loaded once under the
 * maintenance lock so planning is deterministic and never touches the database.
 */
export interface MediaServerCatalogSnapshot {
  shows: MediaServerShow[];
  /** Source-backed playlist collections already attached to a show. */
  seasons: MediaServerSeason[];
  assignments: MediaServerEpisodeAssignment[];
  videosById: Map<string, Video>;
  artifactsByPath: Map<string, MediaServerExportArtifact>;
}

/** One source-backed playlist collection attached to a show as a season. */
export interface MediaServerSeason {
  showId: string;
  seasonNumber: number;
  collectionId?: string;
  title: string;
  plot: string;
}

export interface PlannedSubtitleArtifact {
  language: string;
  sourceAbsolutePath: string;
  targetAbsolutePath: string;
  targetRelativePath: string;
}

/**
 * Hierarchy plans deliberately use required season/episode numbers. An invalid
 * catalog row is rejected during planning, before it can reach an NFO builder
 * or a filesystem write.
 */
export interface HierarchyEpisodePlan {
  assignment: MediaServerEpisodeAssignment;
  video: Video;
  sourceMediaAbsolutePath: string;
  sourceMediaExtension: string;
  targetMediaAbsolutePath: string;
  targetMediaRelativePath: string;
  targetNfoAbsolutePath: string;
  targetNfoRelativePath: string;
  targetThumbAbsolutePath: string;
  targetThumbRelativePath: string;
  thumbSourceAbsolutePath?: string;
  targetSourceJsonAbsolutePath?: string;
  targetSourceJsonRelativePath?: string;
  subtitles: PlannedSubtitleArtifact[];
  occurrenceId: string;
}

export interface HierarchySeasonPlan {
  collectionId?: string;
  seasonNumber: number;
  title: string;
  plot: string;
  directoryAbsolutePath: string;
  directoryRelativePath: string;
  seasonNfoAbsolutePath: string;
  seasonNfoRelativePath: string;
  seasonUniqueId: string;
  episodes: HierarchyEpisodePlan[];
}

export interface HierarchyShowPlan {
  show: MediaServerShow;
  rootAbsolutePath: string;
  rootRelativePath: string;
  tvshowNfoAbsolutePath: string;
  tvshowNfoRelativePath: string;
  posterAbsolutePath: string;
  posterRelativePath: string;
  posterSourceAbsolutePath?: string;
  showUniqueId: string;
  premiered?: string;
  seasons: HierarchySeasonPlan[];
}

export interface HierarchyPlanSkip {
  videoId: string;
  title: string;
  assignmentId?: string;
  reason: MediaServerExportSkipReason;
  detail?: string;
}

export interface HierarchyPlanCollision {
  relativePath: string;
  assignmentIds: string[];
  detail: string;
}

export interface MediaServerHierarchyPlan {
  shows: HierarchyShowPlan[];
  skipped: HierarchyPlanSkip[];
  collisions: HierarchyPlanCollision[];
  /** Every relative path the plan expects to exist, for ledger-driven sweeping. */
  expectedRelativePaths: Set<string>;
}

export interface PlanMediaServerHierarchyOptions {
  mode: Exclude<MediaServerExportMode, "off">;
  /** Restrict planning to these shows. Absent means the whole catalog. */
  showIds?: Set<string>;
}

/** Collections whose durable source identity qualifies them as a season. */
export type SourceBackedCollection = Collection & {
  mediaServerShowId: string;
  mediaServerSeasonNumber: number;
};

/** Observable phases of a playlist_tv rebuild (issue #411, design §10.1). */
export type MediaServerExportJobPhase =
  | "snapshot"
  | "catalog_reconcile"
  | "plan"
  | "materialize"
  | "sweep"
  | "completed";

/**
 * Materialization counters for the playlist_tv layout. Always present so the
 * frontend can render them unconditionally; all zero in adjacent mode.
 */
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
  /** Issue #411. Older clients ignore this; it is always populated. */
  layout: MediaServerExportLayout;
  action: "rebuild" | "cleanup";
  phase: MediaServerExportJobPhase;
  /**
   * Adjacent: raw video rows. playlist_tv: episode assignments. The unit is
   * layout-specific, which is why `phase` is reported alongside it.
   */
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
