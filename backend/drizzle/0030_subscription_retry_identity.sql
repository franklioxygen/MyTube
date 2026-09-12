ALTER TABLE `subscription_video_retries` ADD COLUMN `video_key` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `subscription_video_retries_identity_idx` ON `subscription_video_retries` (`subscription_id`,`video_key`);
