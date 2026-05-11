/* tsqllint-disable */
-- Statistics feature: durable dimensions + tables for events, rollups, and ingestion health.
ALTER TABLE "download_history" ADD COLUMN "platform" text;
--> statement-breakpoint
ALTER TABLE "download_history" ADD COLUMN "source_kind" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "download_history_statistics_idx" ON "download_history" ("finished_at", "platform", "source_kind", "status");
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "consecutive_failure_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_check_status" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_failure_reason" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_statistics_events" (
  "id" text PRIMARY KEY NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "event_type" text NOT NULL,
  "recorded_at" integer NOT NULL,
  "client_occurred_at" integer,
  "day" text NOT NULL,
  "actor_role" text NOT NULL,
  "surface" text NOT NULL,
  "session_id" text,
  "related_event_id" text,
  "video_id" text,
  "collection_id" text,
  "subscription_id" text,
  "rss_token_id" text,
  "platform" text,
  "source_kind" text,
  "duration_seconds" integer,
  "value" integer,
  "payload" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_statistics_events_day" ON "usage_statistics_events" ("day", "event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_statistics_events_recorded_at" ON "usage_statistics_events" ("recorded_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_statistics_events_video" ON "usage_statistics_events" ("video_id", "event_type", "recorded_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_statistics_events_subscription" ON "usage_statistics_events" ("subscription_id", "event_type", "recorded_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_statistics_events_related" ON "usage_statistics_events" ("related_event_id", "event_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_statistics_rollup_days" (
  "day" text PRIMARY KEY NOT NULL,
  "dirty" integer DEFAULT 1 NOT NULL,
  "sealed" integer DEFAULT 0 NOT NULL,
  "last_event_recorded_at" integer,
  "last_rolled_up_at" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_statistics_daily" (
  "day" text NOT NULL,
  "metric_key" text NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "platform" text,
  "actor_role" text,
  "source_kind" text,
  "dimension_key" text DEFAULT '' NOT NULL,
  "dimension_value" text DEFAULT '' NOT NULL,
  "dimensions_hash" text NOT NULL,
  "dimensions_json" text DEFAULT '{}' NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "sum" integer DEFAULT 0 NOT NULL,
  "min" integer,
  "max" integer,
  "updated_at" integer NOT NULL,
  PRIMARY KEY ("day", "metric_key", "dimensions_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_statistics_daily_metric_day" ON "usage_statistics_daily" ("metric_key", "day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_statistics_daily_common_dims" ON "usage_statistics_daily" ("metric_key", "day", "platform", "actor_role", "source_kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_statistics_ingestion_minutes" (
  "minute_bucket" integer PRIMARY KEY NOT NULL,
  "accepted_count" integer DEFAULT 0 NOT NULL,
  "dropped_count" integer DEFAULT 0 NOT NULL,
  "error_count" integer DEFAULT 0 NOT NULL,
  "sealed_day_drop_count" integer DEFAULT 0 NOT NULL,
  "updated_at" integer NOT NULL
);
