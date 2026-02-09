import { relations } from "drizzle-orm";
import {
    foreignKey,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const videos = sqliteTable("videos", {
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
  tags: text("tags"), // JSON stringified array of strings
  progress: integer("progress"), // Playback progress in seconds
  fileSize: text("file_size"),
  lastPlayedAt: integer("last_played_at"), // Timestamp when video was last played
  subtitles: text("subtitles"), // JSON stringified array of subtitle objects
  channelUrl: text("channel_url"), // Author channel URL for subscriptions
  visibility: integer("visibility").default(1), // 1 = visible, 0 = hidden
  authorAvatarFilename: text("author_avatar_filename"), // Author avatar filename
  authorAvatarPath: text("author_avatar_path"), // Author avatar path
});

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title"), // Keeping for backward compatibility/alias
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

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
});

export const downloadHistory = sqliteTable("download_history", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author"),
  sourceUrl: text("source_url"),
  finishedAt: integer("finished_at").notNull(), // Timestamp
  status: text("status").notNull(), // 'success', 'failed', 'skipped', or 'deleted'
  error: text("error"), // Error message if failed
  videoPath: text("video_path"), // Path to video file if successful
  thumbnailPath: text("thumbnail_path"), // Path to thumbnail if successful
  totalSize: text("total_size"),
  videoId: text("video_id"), // Reference to video for skipped items
  downloadedAt: integer("downloaded_at"), // Original download timestamp for deleted items
  deletedAt: integer("deleted_at"), // Deletion timestamp for deleted items
  subscriptionId: text("subscription_id"), // Reference to subscription if downloaded via subscription
  taskId: text("task_id"), // Reference to continuous download task if downloaded via task
});

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
  subscriptionType: text("subscription_type").default("author"), // 'author' or 'playlist'
  collectionId: text("collection_id"), // Reference to collection for auto-adding videos
  downloadShorts: integer("download_shorts").default(0), // 0 = disabled, 1 = enabled
  lastShortVideoLink: text("last_short_video_link"),
});

// Track downloaded video IDs to prevent re-downloading
export const videoDownloads = sqliteTable(
  "video_downloads",
  {
    id: text("id").primaryKey(), // Unique identifier
    sourceVideoId: text("source_video_id").notNull(), // Video ID from source (YouTube ID, Bilibili BV ID, etc.)
    sourceUrl: text("source_url").notNull(), // Original source URL
    platform: text("platform").notNull(), // YouTube, Bilibili, MissAV, etc.
    videoId: text("video_id"), // Reference to local video ID (null if deleted)
    title: text("title"), // Video title for display
    author: text("author"), // Video author
    status: text("status").notNull().default("exists"), // 'exists' or 'deleted'
    downloadedAt: integer("downloaded_at").notNull(), // Timestamp of first download
    deletedAt: integer("deleted_at"), // Timestamp when video was deleted (nullable)
  },
  (table) => ({
    sourceVideoPlatformUnique: uniqueIndex(
      "video_downloads_source_video_id_platform_uidx"
    ).on(table.sourceVideoId, table.platform),
  })
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
  }
);
