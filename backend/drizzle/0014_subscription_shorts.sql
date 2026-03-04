-- tsqllint-disable set-quoted-identifier
ALTER TABLE subscriptions
ADD COLUMN download_shorts integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN last_short_video_link text;
