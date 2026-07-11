/* tsqllint-disable */
CREATE TABLE IF NOT EXISTS `favorite_collections` (
	`user_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `collection_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_favorite_collections_user` ON `favorite_collections` (`user_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `favorite_authors` (
	`user_id` text NOT NULL,
	`author` text NOT NULL,
	`display_name` text,
	`avatar_path` text,
	`channel_url` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `author`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_favorite_authors_user` ON `favorite_authors` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_favorite_authors_author` ON `favorite_authors` (`author`);
