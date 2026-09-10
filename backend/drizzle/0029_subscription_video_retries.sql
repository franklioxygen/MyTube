CREATE TABLE IF NOT EXISTS `subscription_video_retries` (
	`subscription_id` text NOT NULL,
	`video_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_attempt_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`subscription_id`, `video_url`),
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `subscription_video_retries_schedule_idx` ON `subscription_video_retries` (`subscription_id`,`last_attempt_at`,`created_at`,`video_url`);
