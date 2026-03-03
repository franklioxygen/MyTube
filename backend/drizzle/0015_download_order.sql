ALTER TABLE "continuous_download_tasks"
ADD COLUMN "download_order" text NOT NULL DEFAULT 'dateDesc';
--> statement-breakpoint
ALTER TABLE "continuous_download_tasks"
ADD COLUMN "frozen_video_list_path" text;
