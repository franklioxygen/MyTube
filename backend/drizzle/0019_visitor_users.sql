CREATE TABLE `users` (
    `id` text PRIMARY KEY NOT NULL,
    `username` text NOT NULL,
    `password_hash` text NOT NULL,
    `role` text DEFAULT 'visitor' NOT NULL,
    `enabled` integer DEFAULT 1 NOT NULL,
    `is_legacy_shared` integer DEFAULT 0 NOT NULL,
    `session_version` integer DEFAULT 1 NOT NULL,
    `created_at` integer NOT NULL,
    `updated_at` integer NOT NULL,
    `last_login_at` integer,
    CONSTRAINT "users_role_check" CHECK("users"."role" IN ('visitor'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_lower_uidx` ON `users` (lower(`username`));
