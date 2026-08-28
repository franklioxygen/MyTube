-- Idempotent for the same reason every statement in 0028 is: the startup
-- self-heal (ensureMediaServerExportTables) may have created this table already
-- on an install whose migration journal is out of sync, and a plain CREATE TABLE
-- would then roll the migration back and leave it retrying on every boot.
CREATE TABLE IF NOT EXISTS `media_server_retired_episodes` (
	`show_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`retired_at` integer NOT NULL,
	PRIMARY KEY(`show_id`, `season_number`, `episode_number`),
	FOREIGN KEY (`show_id`) REFERENCES `media_server_shows`(`id`) ON UPDATE no action ON DELETE cascade
);
