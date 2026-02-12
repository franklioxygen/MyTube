CREATE TABLE "video_downloads" (
	"id" text PRIMARY KEY NOT NULL,
	"source_video_id" text NOT NULL,
	"source_url" text NOT NULL,
	"platform" text NOT NULL,
	"video_id" text,
	"title" text,
	"author" text,
	"status" text DEFAULT 'exists' NOT NULL,
	"downloaded_at" integer NOT NULL,
	"deleted_at" integer
);
--> statement-breakpoint
CREATE INDEX "video_downloads_source_video_id_idx" ON "video_downloads" ("source_video_id");
--> statement-breakpoint
CREATE INDEX "video_downloads_source_url_idx" ON "video_downloads" ("source_url");

