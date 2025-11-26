import { relations } from 'drizzle-orm';
import { foreignKey, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  author: text('author'),
  date: text('date'),
  source: text('source'),
  sourceUrl: text('source_url'),
  videoFilename: text('video_filename'),
  thumbnailFilename: text('thumbnail_filename'),
  videoPath: text('video_path'),
  thumbnailPath: text('thumbnail_path'),
  thumbnailUrl: text('thumbnail_url'),
  addedAt: text('added_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
  partNumber: integer('part_number'),
  totalParts: integer('total_parts'),
  seriesTitle: text('series_title'),
  rating: integer('rating'),
  // Additional fields that might be present
  description: text('description'),
  viewCount: integer('view_count'),
  duration: text('duration'),
  tags: text('tags'), // JSON stringified array of strings
  progress: integer('progress'), // Playback progress in seconds
});

export const collections = sqliteTable('collections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  title: text('title'), // Keeping for backward compatibility/alias
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

export const collectionVideos = sqliteTable('collection_videos', {
  collectionId: text('collection_id').notNull(),
  videoId: text('video_id').notNull(),
  order: integer('order'), // To maintain order if needed
}, (t) => ({
  pk: primaryKey({ columns: [t.collectionId, t.videoId] }),
  collectionFk: foreignKey({
    columns: [t.collectionId],
    foreignColumns: [collections.id],
  }).onDelete('cascade'),
  videoFk: foreignKey({
    columns: [t.videoId],
    foreignColumns: [videos.id],
  }).onDelete('cascade'),
}));

// Relations
export const videosRelations = relations(videos, ({ many }) => ({
  collections: many(collectionVideos),
}));

export const collectionsRelations = relations(collections, ({ many }) => ({
  videos: many(collectionVideos),
}));

export const collectionVideosRelations = relations(collectionVideos, ({ one }) => ({
  collection: one(collections, {
    fields: [collectionVideos.collectionId],
    references: [collections.id],
  }),
  video: one(videos, {
    fields: [collectionVideos.videoId],
    references: [videos.id],
  }),
}));

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON stringified value
});

export const downloads = sqliteTable('downloads', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  timestamp: integer('timestamp'),
  filename: text('filename'),
  totalSize: text('total_size'),
  downloadedSize: text('downloaded_size'),
  progress: integer('progress'), // Using integer for percentage (0-100) or similar
  speed: text('speed'),
  status: text('status').notNull().default('active'), // 'active' or 'queued'
});
