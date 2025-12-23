CREATE TABLE `continuous_download_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text,
	`author_url` text NOT NULL,
	`author` text NOT NULL,
	`platform` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`total_videos` integer DEFAULT 0,
	`downloaded_count` integer DEFAULT 0,
	`skipped_count` integer DEFAULT 0,
	`failed_count` integer DEFAULT 0,
	`current_video_index` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`completed_at` integer,
	`error` text
);
