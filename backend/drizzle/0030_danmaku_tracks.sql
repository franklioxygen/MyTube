CREATE TABLE `danmaku_tracks` (
	`video_id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`cid` text,
	`revision` text,
	`event_count` integer DEFAULT 0 NOT NULL,
	`ignored_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`last_error` text,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
