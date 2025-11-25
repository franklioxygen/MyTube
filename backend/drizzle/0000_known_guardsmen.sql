CREATE TABLE `collection_videos` (
	`collection_id` text NOT NULL,
	`video_id` text NOT NULL,
	`order` integer,
	PRIMARY KEY(`collection_id`, `video_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`title` text,
	`created_at` text NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`timestamp` integer,
	`filename` text,
	`total_size` text,
	`downloaded_size` text,
	`progress` integer,
	`speed` text,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`date` text,
	`source` text,
	`source_url` text,
	`video_filename` text,
	`thumbnail_filename` text,
	`video_path` text,
	`thumbnail_path` text,
	`thumbnail_url` text,
	`added_at` text,
	`created_at` text NOT NULL,
	`updated_at` text,
	`part_number` integer,
	`total_parts` integer,
	`series_title` text,
	`rating` integer,
	`description` text,
	`view_count` integer,
	`duration` text
);
