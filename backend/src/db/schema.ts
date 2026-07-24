import { relations, sql } from "drizzle-orm";
import {
    check,
    foreignKey,
    index,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const videos = sqliteTable(
  "videos",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    author: text("author"),
    date: text("date"),
    source: text("source"),
    sourceUrl: text("source_url"),
    videoFilename: text("video_filename"),
    thumbnailFilename: text("thumbnail_filename"),
    videoPath: text("video_path"),
    thumbnailPath: text("thumbnail_path"),
    thumbnailUrl: text("thumbnail_url"),
    addedAt: text("added_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
    partNumber: integer("part_number"),
    totalParts: integer("total_parts"),
    seriesTitle: text("series_title"),
    rating: integer("rating"),
    // Additional fields that might be present
    description: text("description"),
    viewCount: integer("view_count"),
    duration: text("duration"),
    width: integer("width"),
    height: integer("height"),
    tags: text("tags"), // JSON stringified array of strings
    progress: integer("progress"), // Playback progress in seconds
    progressUpdatedAt: integer("progress_updated_at"), // Timestamp when progress was last saved
    fileSize: text("file_size"),
    lastPlayedAt: integer("last_played_at"), // Timestamp when video was last played
    subtitles: text("subtitles"), // JSON stringified array of subtitle objects
    channelUrl: text("channel_url"), // Author channel URL for subscriptions
    visibility: integer("visibility").default(1), // 1 = visible, 0 = hidden
    authorAvatarFilename: text("author_avatar_filename"), // Author avatar filename
    authorAvatarPath: text("author_avatar_path"), // Author avatar path
    mediaType: text("media_type").default("video"), // "video" | "audio"
  },
  (table) => ({
    // source_url is looked up on every download attempt, cloud-scan duplicate
    // check, and bilibili collection iteration (getVideoBySourceUrl).
    sourceUrlIdx: index("idx_videos_source_url").on(table.sourceUrl),
    // createdAt backs the default ORDER BY for video listings.
    createdAtIdx: index("idx_videos_created_at").on(table.createdAt),
    // visibility is filtered on every visitor request.
    visibilityIdx: index("idx_videos_visibility").on(table.visibility),
    // author / channel_url back the RSS feed filters (rssService), which are
    // polled on a schedule by feed readers.
    authorIdx: index("idx_videos_author").on(table.author),
    channelUrlIdx: index("idx_videos_channel_url").on(table.channelUrl),
  })
);

export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    title: text("title"), // Keeping for backward compatibility/alias
    origin: text("origin"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
    // Stable source identity for re-download/repair dedup (issue #295).
    // For Bilibili: sourcePlatform="bilibili", sourceType="collection"|"series",
    // sourceMid=uploader mid, sourceId=season/series id. Stored as text to avoid
    // integer precision concerns and to stay platform-agnostic.
    sourcePlatform: text("source_platform"),
    sourceType: text("source_type"),
    sourceMid: text("source_mid"),
    sourceId: text("source_id"),
  },
  (table) => ({
    // name/title lookups (getCollectionByName) used in playlist subscription checks.
    nameIdx: index("idx_collections_name").on(table.name),
    titleIdx: index("idx_collections_title").on(table.title),
    // Stable source-identity lookups (getCollectionBySourceKey).
    sourceKeyIdx: index("idx_collections_source_key").on(
      table.sourcePlatform,
      table.sourceType,
      table.sourceMid,
      table.sourceId
    ),
  })
);

export const collectionVideos = sqliteTable(
  "collection_videos",
  {
    collectionId: text("collection_id").notNull(),
    videoId: text("video_id").notNull(),
    order: integer("order"), // To maintain order if needed
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.videoId] }),
    collectionFk: foreignKey({
      columns: [t.collectionId],
      foreignColumns: [collections.id],
    }).onDelete("cascade"),
    videoFk: foreignKey({
      columns: [t.videoId],
      foreignColumns: [videos.id],
    }).onDelete("cascade"),
    // The composite PK serves (collection_id, video_id) lookups but cannot
    // serve a video_id-leading lookup; this index backs per-video membership
    // queries (e.g. getCollectionsByVideoId, retention deletion).
    videoIdIdx: index("idx_collection_videos_video_id").on(t.videoId),
  })
);

export const favoriteCollections = sqliteTable(
  "favorite_collections",
  {
    userId: text("user_id").notNull(),
    collectionId: text("collection_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.collectionId] }),
    collectionFk: foreignKey({
      columns: [table.collectionId],
      foreignColumns: [collections.id],
    }).onDelete("cascade"),
    userIdIdx: index("idx_favorite_collections_user").on(table.userId),
  })
);

export const favoriteAuthors = sqliteTable(
  "favorite_authors",
  {
    userId: text("user_id").notNull(),
    author: text("author").notNull(),
    displayName: text("display_name"),
    avatarPath: text("avatar_path"),
    channelUrl: text("channel_url"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.author] }),
    userIdIdx: index("idx_favorite_authors_user").on(table.userId),
    authorIdx: index("idx_favorite_authors_author").on(table.author),
  })
);

// Relations
export const videosRelations = relations(videos, ({ many }) => ({
  collections: many(collectionVideos),
}));

export const collectionsRelations = relations(collections, ({ many }) => ({
  videos: many(collectionVideos),
}));

export const collectionVideosRelations = relations(
  collectionVideos,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionVideos.collectionId],
      references: [collections.id],
    }),
    video: one(videos, {
      fields: [collectionVideos.videoId],
      references: [videos.id],
    }),
  })
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON stringified value
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("visitor"),
    enabled: integer("enabled").notNull().default(1),
    isLegacyShared: integer("is_legacy_shared").notNull().default(0),
    sessionVersion: integer("session_version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastLoginAt: integer("last_login_at"),
  },
  (table) => [
    check("users_role_check", sql`${table.role} IN ('visitor')`),
    uniqueIndex("users_username_lower_uidx").on(sql`lower(${table.username})`),
  ]
);

export const downloads = sqliteTable("downloads", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  timestamp: integer("timestamp"),
  filename: text("filename"),
  totalSize: text("total_size"),
  downloadedSize: text("downloaded_size"),
  progress: integer("progress"), // Using integer for percentage (0-100) or similar
  speed: text("speed"),
  status: text("status").notNull().default("active"), // 'active' or 'queued'
  sourceUrl: text("source_url"),
  type: text("type"),
  retryMetadata: text("retry_metadata"),
});

export const downloadHistory = sqliteTable(
  "download_history",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    author: text("author"),
    sourceUrl: text("source_url"),
    finishedAt: integer("finished_at").notNull(), // Timestamp
    status: text("status").notNull(), // 'success', 'failed', 'partial', 'skipped', 'deleted', or 'pending_retry'
    error: text("error"), // Error message if failed
    videoPath: text("video_path"), // Path to video file if successful
    thumbnailPath: text("thumbnail_path"), // Path to thumbnail if successful
    totalSize: text("total_size"),
    videoId: text("video_id"), // Reference to video for skipped items
    downloadedAt: integer("downloaded_at"), // Original download timestamp for deleted items
    deletedAt: integer("deleted_at"), // Deletion timestamp for deleted items
    subscriptionId: text("subscription_id"), // Reference to subscription if downloaded via subscription
    taskId: text("task_id"), // Reference to continuous download task if downloaded via task
    platform: text("platform"), // canonical: youtube/bilibili/twitch/missav/local/cloud/unknown
    sourceKind: text("source_kind"), // canonical: manual/search_result/subscription/extension/task/api/upload/scan/library/rss/unknown
    downloadType: text("download_type"),
    retryCount: integer("retry_count"),
    retryLimit: integer("retry_limit"),
    retryIntervalMinutes: integer("retry_interval_minutes"),
    nextRetryAt: integer("next_retry_at"),
    retryMetadata: text("retry_metadata"),
  },
  (table) => ({
    retentionSubscriptionIdx: index(
      "download_history_retention_subscription_idx"
    ).on(table.subscriptionId, table.status, table.finishedAt),
    retentionVideoRefsIdx: index("download_history_retention_video_refs_idx").on(
      table.videoId,
      table.status,
      table.subscriptionId
    ),
    statisticsIdx: index("download_history_statistics_idx").on(
      table.finishedAt,
      table.platform,
      table.sourceKind,
      table.status
    ),
    retryScheduleIdx: index("download_history_retry_schedule_idx").on(
      table.status,
      table.nextRetryAt
    ),
    // source_url backs getLatestRetryHistoryItemBySourceUrl, which runs on
    // every Bilibili download enqueue; without it each enqueue scans the
    // append-only history table.
    sourceUrlIdx: index("download_history_source_url_idx").on(table.sourceUrl),
  })
);

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  author: text("author").notNull(),
  authorUrl: text("author_url").notNull(),
  interval: integer("interval").notNull(), // Check interval in minutes
  lastVideoLink: text("last_video_link"),
  lastCheck: integer("last_check"), // Timestamp
  downloadCount: integer("download_count").default(0),
  createdAt: integer("created_at").notNull(),
  platform: text("platform").default("YouTube"),
  paused: integer("paused").default(0), // 0 = active, 1 = paused
  // Playlist subscription fields
  playlistId: text("playlist_id"), // Platform-specific playlist ID (YouTube list=, Bilibili season_id, etc.)
  playlistTitle: text("playlist_title"), // Original playlist title
  channelName: text("channel_name"), // Clean channel name for playlist subscriptions
  subscriptionType: text("subscription_type").default("author"), // 'author' or 'playlist'
  collectionId: text("collection_id"), // Reference to collection for auto-adding videos
  downloadShorts: integer("download_shorts").default(0), // 0 = disabled, 1 = enabled
  lastShortVideoLink: text("last_short_video_link"),
  twitchBroadcasterId: text("twitch_broadcaster_id"),
  twitchBroadcasterLogin: text("twitch_broadcaster_login"),
  lastTwitchVideoId: text("last_twitch_video_id"),
  retentionDays: integer("retention_days"), // Auto-delete subscription-owned videos older than this many days (null = disabled)
  // Durable subscription state for the consecutive-failure-streak alert (statistics feature).
  consecutiveFailureCount: integer("consecutive_failure_count").notNull().default(0),
  lastCheckStatus: text("last_check_status"), // 'success' | 'fail'
  lastFailureReason: text("last_failure_reason"), // bucket key only, never raw error text
  // Per-subscription yt-dlp config override (issue #345).
  // Free-text yt-dlp config snippet; null/empty = use the global ytDlpConfig.
  // Same format as the global setting. Trust-gated to "container".
  ytdlpConfig: text("ytdlp_config"),
  // Per-subscription filename-template override (issue #368).
  // null = inherit the current global filename naming settings.
  filenameTemplate: text("filename_template"),
});

// Track downloaded video IDs to prevent re-downloading
export const videoDownloads = sqliteTable(
  "video_downloads",
  {
    id: text("id").primaryKey(), // Unique identifier
    sourceVideoId: text("source_video_id").notNull(), // Video ID from source (YouTube ID, Bilibili BV ID, etc.)
    sourceUrl: text("source_url").notNull(), // Original source URL
    platform: text("platform").notNull(), // YouTube, Bilibili, MissAV, etc.
    // Media type of the tracked download. Audio-only downloads are tracked as a
    // separate row from the video for the same source so downloading one does
    // not mask the other as a duplicate.
    mediaType: text("media_type").notNull().default("video"), // "video" | "audio"
    videoId: text("video_id"), // Reference to local video ID (null if deleted)
    title: text("title"), // Video title for display
    author: text("author"), // Video author
    status: text("status").notNull().default("exists"), // 'exists' or 'deleted'
    downloadedAt: integer("downloaded_at").notNull(), // Timestamp of first download
    deletedAt: integer("deleted_at"), // Timestamp when video was deleted (nullable)
  },
  (table) => ({
    sourceVideoPlatformMediaTypeUnique: uniqueIndex(
      "video_downloads_source_video_id_platform_media_type_uidx"
    ).on(table.sourceVideoId, table.platform, table.mediaType),
  })
);

export const rssTokens = sqliteTable(
  "rss_tokens",
  {
    id:             text("id").primaryKey(),
    label:          text("label").notNull().default(""),
    role:           text("role").notNull().default("visitor"),
    filters:        text("filters").notNull().default("{}"),
    isActive:       integer("is_active").notNull().default(1),
    accessCount:    integer("access_count").notNull().default(0),
    lastAccessedAt: integer("last_accessed_at"),
    createdAt:      integer("created_at").notNull(),
    updatedAt:      integer("updated_at").notNull(),
  },
  (table) => [
    check("rss_tokens_role_check", sql`${table.role} IN ('admin', 'visitor')`),
  ]
);

// Track continuous download tasks for downloading all previous videos from an author
export const continuousDownloadTasks = sqliteTable(
  "continuous_download_tasks",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id"), // Reference to subscription (nullable if subscription deleted)
    collectionId: text("collection_id"), // Reference to collection (nullable, for playlist tasks)
    authorUrl: text("author_url").notNull(),
    author: text("author").notNull(),
    platform: text("platform").notNull(), // YouTube, Bilibili, etc.
    status: text("status").notNull().default("active"), // 'active', 'paused', 'completed', 'cancelled'
    totalVideos: integer("total_videos").default(0), // Total videos found
    downloadedCount: integer("downloaded_count").default(0), // Number of videos downloaded
    skippedCount: integer("skipped_count").default(0), // Number of videos skipped (already downloaded)
    failedCount: integer("failed_count").default(0), // Number of videos that failed
    currentVideoIndex: integer("current_video_index").default(0), // Current video being processed
    createdAt: integer("created_at").notNull(), // Timestamp when task was created
    updatedAt: integer("updated_at"), // Timestamp of last update
    completedAt: integer("completed_at"), // Timestamp when task completed
    error: text("error"), // Error message if task failed
    downloadOrder: text("download_order").notNull().default("dateDesc"), // User-selected backfill order
    frozenVideoListPath: text("frozen_video_list_path"), // Path to persisted ordered URL snapshot
  }
);

// Statistics feature tables.
// Append-only event records for recent detail; daily rollups for long-term charts;
// minute-bucketed ingestion-health counters for the dashboard.
export const usageStatisticsEvents = sqliteTable(
  "usage_statistics_events",
  {
    id: text("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull().default(1),
    eventType: text("event_type").notNull(),
    recordedAt: integer("recorded_at").notNull(),
    clientOccurredAt: integer("client_occurred_at"),
    day: text("day").notNull(),
    actorRole: text("actor_role").notNull(),
    surface: text("surface").notNull(),
    sessionId: text("session_id"),
    relatedEventId: text("related_event_id"),
    videoId: text("video_id"),
    collectionId: text("collection_id"),
    subscriptionId: text("subscription_id"),
    rssTokenId: text("rss_token_id"),
    platform: text("platform"),
    sourceKind: text("source_kind"),
    durationSeconds: integer("duration_seconds"),
    value: integer("value"),
    payload: text("payload").notNull().default("{}"),
  },
  (table) => ({
    dayEventTypeIdx: index("idx_usage_statistics_events_day").on(
      table.day,
      table.eventType
    ),
    recordedAtIdx: index("idx_usage_statistics_events_recorded_at").on(
      table.recordedAt
    ),
    videoIdx: index("idx_usage_statistics_events_video").on(
      table.videoId,
      table.eventType,
      table.recordedAt
    ),
    subscriptionIdx: index("idx_usage_statistics_events_subscription").on(
      table.subscriptionId,
      table.eventType,
      table.recordedAt
    ),
    relatedIdx: index("idx_usage_statistics_events_related").on(
      table.relatedEventId,
      table.eventType
    ),
  })
);

export const usageStatisticsRollupDays = sqliteTable(
  "usage_statistics_rollup_days",
  {
    day: text("day").primaryKey(),
    dirty: integer("dirty").notNull().default(1),
    sealed: integer("sealed").notNull().default(0),
    lastEventRecordedAt: integer("last_event_recorded_at"),
    lastRolledUpAt: integer("last_rolled_up_at"),
  }
);

export const usageStatisticsDaily = sqliteTable(
  "usage_statistics_daily",
  {
    day: text("day").notNull(),
    metricKey: text("metric_key").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    platform: text("platform"),
    actorRole: text("actor_role"),
    sourceKind: text("source_kind"),
    dimensionKey: text("dimension_key").notNull().default(""),
    dimensionValue: text("dimension_value").notNull().default(""),
    dimensionsHash: text("dimensions_hash").notNull(),
    dimensionsJson: text("dimensions_json").notNull().default("{}"),
    count: integer("count").notNull().default(0),
    sum: integer("sum").notNull().default(0),
    min: integer("min"),
    max: integer("max"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.day, table.metricKey, table.dimensionsHash] }),
    metricDayIdx: index("idx_usage_statistics_daily_metric_day").on(
      table.metricKey,
      table.day
    ),
    commonDimsIdx: index("idx_usage_statistics_daily_common_dims").on(
      table.metricKey,
      table.day,
      table.platform,
      table.actorRole,
      table.sourceKind
    ),
  })
);

export const usageStatisticsIngestionMinutes = sqliteTable(
  "usage_statistics_ingestion_minutes",
  {
    minuteBucket: integer("minute_bucket").primaryKey(),
    acceptedCount: integer("accepted_count").notNull().default(0),
    droppedCount: integer("dropped_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    sealedDayDropCount: integer("sealed_day_drop_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  }
);
