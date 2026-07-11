/* tsqllint-disable */
ALTER TABLE "video_downloads" ADD COLUMN "media_type" text DEFAULT 'video' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "video_downloads_source_video_id_platform_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "video_downloads_source_video_id_platform_media_type_uidx" ON "video_downloads" ("source_video_id","platform","media_type");
