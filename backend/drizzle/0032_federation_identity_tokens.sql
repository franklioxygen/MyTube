CREATE TABLE `federation_instance` (
	`id` integer PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "federation_instance_singleton_check" CHECK("federation_instance"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `federation_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_hash` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`scopes` text NOT NULL,
	`visibility_ceiling` text DEFAULT 'public' NOT NULL,
	`policy_revision` integer DEFAULT 1 NOT NULL,
	`consumer_instance_id` text,
	`expires_at` integer,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "federation_tokens_visibility_check" CHECK("federation_tokens"."visibility_ceiling" IN ('public', 'owner')),
	CONSTRAINT "federation_tokens_policy_revision_check" CHECK("federation_tokens"."policy_revision" >= 1)
);
