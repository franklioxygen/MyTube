// Canonical statistics event vocabulary and shared shapes.

export type ActorRole = "admin" | "visitor" | "system";

export type StatisticsSurface =
  | "web"
  | "extension"
  | "api"
  | "background"
  | "unknown";

export type CanonicalPlatform =
  | "youtube"
  | "bilibili"
  | "twitch"
  | "missav"
  | "local"
  | "cloud"
  | "unknown";

export type CanonicalSourceKind =
  | "manual"
  | "search_result"
  | "subscription"
  | "extension"
  | "upload"
  | "scan"
  | "rss"
  | "library"
  | "task"
  | "api"
  | "unknown";

// P0 event types per design §7.1 / §7.2.
export type StatisticsEventType =
  // Frontend
  | "search_submitted"
  | "video_play_started"
  | "video_watch_chunk_recorded"
  | "up_next_impression"
  | "up_next_clicked"
  | "autoplay_advanced"
  | "autoplay_abandoned"
  // Backend
  | "download_enqueued"
  | "download_started"
  | "library_video_added"
  | "library_video_deleted"
  | "subscription_check_completed"
  | "retention_delete_completed"
  | "rss_feed_accessed";

export const FRONTEND_EVENT_TYPES: ReadonlySet<StatisticsEventType> = new Set([
  "search_submitted",
  "video_play_started",
  "video_watch_chunk_recorded",
  "up_next_impression",
  "up_next_clicked",
  "autoplay_advanced",
  "autoplay_abandoned",
]);

export const BACKEND_EVENT_TYPES: ReadonlySet<StatisticsEventType> = new Set([
  "download_enqueued",
  "download_started",
  "library_video_added",
  "library_video_deleted",
  "subscription_check_completed",
  "retention_delete_completed",
  "rss_feed_accessed",
]);

export interface StatisticsEventInput {
  id?: string;
  schemaVersion?: number;
  eventType: StatisticsEventType;
  recordedAt?: number;
  clientOccurredAt?: number | null;
  actorRole: ActorRole;
  surface: StatisticsSurface;
  sessionId?: string | null;
  relatedEventId?: string | null;
  videoId?: string | null;
  collectionId?: string | null;
  subscriptionId?: string | null;
  rssTokenId?: string | null;
  platform?: CanonicalPlatform | null;
  sourceKind?: CanonicalSourceKind | null;
  durationSeconds?: number | null;
  value?: number | null;
  payload?: Record<string, unknown>;
}

export type DownloadFailureBucket =
  | "auth_required"
  | "source_unavailable"
  | "geo_or_network_blocked"
  | "extractor_changed"
  | "filesystem_error"
  | "cloud_upload_failed"
  | "unknown";
