ALTER TABLE subscriptions ADD COLUMN twitch_broadcaster_id text;
--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN twitch_broadcaster_login text;
--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN last_twitch_video_id text;
