CREATE TABLE `subscriptions` (
    `id` text PRIMARY KEY NOT NULL,
    `author` text NOT NULL,
    `author_url` text NOT NULL,
    `interval` integer NOT NULL,
    `last_video_link` text,
    `last_check` integer,
    `download_count` integer DEFAULT 0,
    `created_at` integer NOT NULL,
    `platform` text DEFAULT 'YouTube'
);