CREATE TABLE IF NOT EXISTS `subscription_video_retries` (
	`subscription_id` text NOT NULL,
	`video_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_attempt_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`subscription_id`, `video_url`),
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
