CREATE TABLE `federation_peers` (
	`id` text PRIMARY KEY NOT NULL,
	`peer_instance_id` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`lan_origin` text,
	`credential_ciphertext` text NOT NULL,
	`audience` text NOT NULL,
	`can_stream_media` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`library_revision` text,
	`policy_revision` text,
	`generation` integer DEFAULT 1 NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "federation_peers_audience_check" CHECK("federation_peers"."audience" IN ('public', 'owner')),
	CONSTRAINT "federation_peers_status_check" CHECK("federation_peers"."status" IN ('pending', 'ok', 'error', 'credential_rejected', 'credential_missing', 'identity_mismatch', 'incompatible'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `federation_peers_instance_uidx` ON `federation_peers` (`peer_instance_id`);--> statement-breakpoint
CREATE TABLE `federation_remote_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`peer_id` text NOT NULL,
	`remote_video_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`summary` text NOT NULL,
	`asset_revision` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`deleted_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`peer_id`) REFERENCES `federation_peers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `federation_remote_videos_peer_remote_uidx` ON `federation_remote_videos` (`peer_id`,`remote_video_id`);--> statement-breakpoint
CREATE INDEX `idx_federation_remote_videos_created_at` ON `federation_remote_videos` (`created_at`);