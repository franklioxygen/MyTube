ALTER TABLE `downloads` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `downloads` ADD `type` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `progress` integer;--> statement-breakpoint
ALTER TABLE `videos` ADD `last_played_at` integer;--> statement-breakpoint
ALTER TABLE `videos` ADD `subtitles` text;