ALTER TABLE `videos` ADD `source_video_id` text;--> statement-breakpoint
UPDATE `videos`
SET `source_video_id` = (
  SELECT `video_downloads`.`source_video_id`
  FROM `video_downloads`
  WHERE `video_downloads`.`video_id` = `videos`.`id`
)
WHERE `source_video_id` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `video_downloads`
    WHERE `video_downloads`.`video_id` = `videos`.`id`
  )
  AND (
    SELECT COUNT(*)
    FROM `video_downloads`
    WHERE `video_downloads`.`video_id` = `videos`.`id`
  ) = 1;--> statement-breakpoint
CREATE INDEX `idx_videos_source_video_id` ON `videos` (`source_video_id`);
