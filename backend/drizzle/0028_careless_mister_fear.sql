CREATE TABLE `media_server_episode_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`collection_id` text,
	`video_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`source_position` integer,
	`export_stem` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `media_server_shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_server_episode_occurrence_uidx` ON `media_server_episode_assignments` (`show_id`,`season_number`,`video_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_server_episode_number_uidx` ON `media_server_episode_assignments` (`show_id`,`season_number`,`episode_number`);--> statement-breakpoint
CREATE INDEX `idx_media_server_episode_collection` ON `media_server_episode_assignments` (`collection_id`);--> statement-breakpoint
CREATE INDEX `idx_media_server_episode_video` ON `media_server_episode_assignments` (`video_id`);--> statement-breakpoint
CREATE TABLE `media_server_export_artifacts` (
	`relative_path` text PRIMARY KEY NOT NULL,
	`artifact_type` text NOT NULL,
	`show_id` text,
	`assignment_id` text,
	`source_absolute_path` text,
	`source_size` integer,
	`source_mtime_ms` integer,
	`materialization` text NOT NULL,
	`content_digest` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `media_server_shows`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignment_id`) REFERENCES `media_server_episode_assignments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_media_server_artifact_show` ON `media_server_export_artifacts` (`show_id`);--> statement-breakpoint
CREATE INDEX `idx_media_server_artifact_assignment` ON `media_server_export_artifacts` (`assignment_id`);--> statement-breakpoint
CREATE TABLE `media_server_shows` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_key` text NOT NULL,
	`source_platform` text NOT NULL,
	`source_channel_id` text,
	`source_channel_url` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`poster_source_path` text,
	`directory_name` text NOT NULL,
	`next_season_number` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_server_shows_identity_key_uidx` ON `media_server_shows` (`identity_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_server_shows_directory_name_uidx` ON `media_server_shows` (`directory_name`);--> statement-breakpoint
ALTER TABLE `collections` ADD `description` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `source_channel_id` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `source_channel_url` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `source_channel_name` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `media_server_show_id` text REFERENCES media_server_shows(id);--> statement-breakpoint
ALTER TABLE `collections` ADD `media_server_season_number` integer;--> statement-breakpoint
CREATE INDEX `idx_collections_media_server_show` ON `collections` (`media_server_show_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `collections_media_server_season_uidx` ON `collections` (`media_server_show_id`,`media_server_season_number`) WHERE "collections"."media_server_show_id" IS NOT NULL AND "collections"."media_server_season_number" IS NOT NULL;
-- NOTE: drizzle-kit also wanted `ALTER TABLE download_history ADD media_type text` here.
-- That column is pre-existing drift: it is added at runtime by
-- migrateColumnsAndTables() in storageService/migrations/schemaMigrations.ts and was
-- never captured in a drizzle migration. Emitting it would raise "duplicate column
-- name" on every existing database and roll back this whole migration, so the media
-- server tables above would never be created. The 0028 snapshot records the column so
-- later migrations do not re-emit it.