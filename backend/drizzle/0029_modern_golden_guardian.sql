ALTER TABLE `collections` ADD `export_as_show` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collections` ADD `media_server_title` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `media_server_description` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `media_server_poster_path` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `media_server_metadata_source` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `tmdb_id` integer;--> statement-breakpoint
ALTER TABLE `collections` ADD `tmdb_media_type` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `tmdb_premiere_date` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `tmdb_match_strategy` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `tmdb_match_confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `media_server_shows` ADD `source_collection_id` text REFERENCES collections(id);--> statement-breakpoint
ALTER TABLE `media_server_shows` ADD `tmdb_id` integer;--> statement-breakpoint
ALTER TABLE `media_server_shows` ADD `tmdb_media_type` text;--> statement-breakpoint
ALTER TABLE `media_server_shows` ADD `premiered` text;--> statement-breakpoint
CREATE UNIQUE INDEX `media_server_shows_source_collection_uidx` ON `media_server_shows` (`source_collection_id`) WHERE "media_server_shows"."source_collection_id" IS NOT NULL;