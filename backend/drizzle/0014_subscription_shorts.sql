ALTER TABLE subscriptions
ADD COLUMN download_shorts integer DEFAULT 0;

ALTER TABLE subscriptions ADD COLUMN last_short_video_link text;