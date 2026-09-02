CREATE TABLE `admin_gesture_credential` (
	`id` integer PRIMARY KEY NOT NULL,
	`pattern_hash` text NOT NULL,
	`pepper_key_id` text NOT NULL,
	`credential_version` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`last_failed_at` integer,
	`locked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "admin_gesture_singleton_check" CHECK("admin_gesture_credential"."id" = 1),
	CONSTRAINT "admin_gesture_attempts_check" CHECK("admin_gesture_credential"."failed_attempts" >= 0 AND "admin_gesture_credential"."failed_attempts" <= 3),
	CONSTRAINT "admin_gesture_failure_state_check" CHECK((
        ("admin_gesture_credential"."failed_attempts" = 0 AND "admin_gesture_credential"."last_failed_at" IS NULL AND "admin_gesture_credential"."locked_at" IS NULL)
        OR ("admin_gesture_credential"."failed_attempts" IN (1, 2) AND "admin_gesture_credential"."last_failed_at" IS NOT NULL AND "admin_gesture_credential"."locked_at" IS NULL)
        OR ("admin_gesture_credential"."failed_attempts" = 3 AND "admin_gesture_credential"."last_failed_at" IS NOT NULL AND "admin_gesture_credential"."locked_at" IS NOT NULL)
      ))
);
