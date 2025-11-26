CREATE TABLE `download_history` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`source_url` text,
	`finished_at` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`video_path` text,
	`thumbnail_path` text,
	`total_size` text
);