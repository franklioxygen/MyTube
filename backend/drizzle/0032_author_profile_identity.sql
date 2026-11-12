PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_author_profiles` (
	`author` text PRIMARY KEY NOT NULL,
	`custom_avatar_path` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_author_profiles`("author", "custom_avatar_path", "updated_at") SELECT "author", "custom_avatar_path", "updated_at" FROM `author_profiles`;--> statement-breakpoint
DROP TABLE `author_profiles`;--> statement-breakpoint
ALTER TABLE `__new_author_profiles` RENAME TO `author_profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;