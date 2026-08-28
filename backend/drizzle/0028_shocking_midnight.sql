CREATE TABLE IF NOT EXISTS `media_server_episode_assignments` (
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
CREATE UNIQUE INDEX IF NOT EXISTS `media_server_episode_occurrence_uidx` ON `media_server_episode_assignments` (`show_id`,`season_number`,`video_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `media_server_episode_number_uidx` ON `media_server_episode_assignments` (`show_id`,`season_number`,`episode_number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_server_episode_collection` ON `media_server_episode_assignments` (`collection_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_server_episode_video` ON `media_server_episode_assignments` (`video_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_server_export_artifacts` (
	`relative_path` text PRIMARY KEY NOT NULL,
	`artifact_type` text NOT NULL,
	`show_id` text,
	`assignment_id` text,
	`source_absolute_path` text,
	`source_size` integer,
	`source_mtime_ms` integer,
	`materialization` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `media_server_shows`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignment_id`) REFERENCES `media_server_episode_assignments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_server_artifact_show` ON `media_server_export_artifacts` (`show_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_server_artifact_assignment` ON `media_server_export_artifacts` (`assignment_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_server_shows` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_key` text NOT NULL,
	`source_platform` text NOT NULL,
	`source_channel_id` text,
	`source_channel_url` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`directory_name` text NOT NULL,
	`next_season_number` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `media_server_shows_identity_key_uidx` ON `media_server_shows` (`identity_key`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `media_server_shows_directory_name_uidx` ON `media_server_shows` (`directory_name`);
-- Every statement above is idempotent, and the two statements drizzle-kit also
-- wanted here are deliberately omitted, because SQLite cannot express either of
-- them idempotently and a single failure rolls the whole migration back — which
-- leaves it unrecorded and retrying on every boot:
--
--   * the eight `ALTER TABLE collections ADD ...` columns for this feature, and
--     the `idx_collections_media_server_show` / `collections_media_server_season_uidx`
--     indexes built on them, are added at startup by
--     ensureMediaServerExportTables(), which checks PRAGMA table_info first;
--   * `ALTER TABLE download_history ADD media_type` is pre-existing schema drift
--     already healed by migrateColumnsAndTables().
--
-- The snapshot beside this file still records all of them, so a later
-- `drizzle-kit generate` does not re-emit them.
