import { sqlite } from "../../../db";
import { logger } from "../../../utils/logger";
import { backfillDownloadHistoryDimensions } from "./dataBackfill";

// Statistics feature self-heal: additive columns + new tables.
// Tolerates legacy installs that skipped the drizzle migration.
export function migrateStatisticsSchema(): void {
  try {
    const dhInfo = sqlite.prepare("PRAGMA table_info(download_history)").all();
    const dhCols = (dhInfo as any[]).map((c: any) => c.name);
    if (!dhCols.includes("platform")) {
      sqlite.prepare("ALTER TABLE download_history ADD COLUMN platform TEXT").run();
      logger.info("Migration successful: download_history.platform added.");
    }
    if (!dhCols.includes("source_kind")) {
      sqlite.prepare("ALTER TABLE download_history ADD COLUMN source_kind TEXT").run();
      logger.info("Migration successful: download_history.source_kind added.");
    }
    if (!dhCols.includes("download_type")) {
      sqlite.prepare("ALTER TABLE download_history ADD COLUMN download_type TEXT").run();
      logger.info("Migration successful: download_history.download_type added.");
    }
    if (!dhCols.includes("retry_count")) {
      sqlite.prepare("ALTER TABLE download_history ADD COLUMN retry_count INTEGER").run();
      logger.info("Migration successful: download_history.retry_count added.");
    }
    if (!dhCols.includes("retry_limit")) {
      sqlite.prepare("ALTER TABLE download_history ADD COLUMN retry_limit INTEGER").run();
      logger.info("Migration successful: download_history.retry_limit added.");
    }
    if (!dhCols.includes("retry_interval_minutes")) {
      sqlite
        .prepare(
          "ALTER TABLE download_history ADD COLUMN retry_interval_minutes INTEGER"
        )
        .run();
      logger.info(
        "Migration successful: download_history.retry_interval_minutes added."
      );
    }
    if (!dhCols.includes("next_retry_at")) {
      sqlite.prepare("ALTER TABLE download_history ADD COLUMN next_retry_at INTEGER").run();
      logger.info("Migration successful: download_history.next_retry_at added.");
    }
    if (!dhCols.includes("retry_metadata")) {
      sqlite
        .prepare("ALTER TABLE download_history ADD COLUMN retry_metadata TEXT")
        .run();
      logger.info("Migration successful: download_history.retry_metadata added.");
    }
    sqlite
      .prepare(
        `CREATE INDEX IF NOT EXISTS download_history_statistics_idx
         ON download_history (finished_at, platform, source_kind, status)`
      )
      .run();
    sqlite
      .prepare(
        `CREATE INDEX IF NOT EXISTS download_history_retry_schedule_idx
         ON download_history (status, next_retry_at)`
      )
      .run();

    const subInfo = sqlite.prepare("PRAGMA table_info(subscriptions)").all();
    const subCols = (subInfo as any[]).map((c: any) => c.name);
    if (subCols.length > 0 && !subCols.includes("consecutive_failure_count")) {
      sqlite
        .prepare(
          "ALTER TABLE subscriptions ADD COLUMN consecutive_failure_count INTEGER NOT NULL DEFAULT 0"
        )
        .run();
      logger.info("Migration successful: subscriptions.consecutive_failure_count added.");
    }
    if (subCols.length > 0 && !subCols.includes("last_check_status")) {
      sqlite
        .prepare("ALTER TABLE subscriptions ADD COLUMN last_check_status TEXT")
        .run();
      logger.info("Migration successful: subscriptions.last_check_status added.");
    }
    if (subCols.length > 0 && !subCols.includes("last_failure_reason")) {
      sqlite
        .prepare("ALTER TABLE subscriptions ADD COLUMN last_failure_reason TEXT")
        .run();
      logger.info("Migration successful: subscriptions.last_failure_reason added.");
    }

    sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS usage_statistics_events (
          id TEXT PRIMARY KEY NOT NULL,
          schema_version INTEGER DEFAULT 1 NOT NULL,
          event_type TEXT NOT NULL,
          recorded_at INTEGER NOT NULL,
          client_occurred_at INTEGER,
          day TEXT NOT NULL,
          actor_role TEXT NOT NULL,
          surface TEXT NOT NULL,
          session_id TEXT,
          related_event_id TEXT,
          video_id TEXT,
          collection_id TEXT,
          subscription_id TEXT,
          rss_token_id TEXT,
          platform TEXT,
          source_kind TEXT,
          duration_seconds INTEGER,
          value INTEGER,
          payload TEXT DEFAULT '{}' NOT NULL
        )`
      )
      .run();
    sqlite
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_usage_statistics_events_day
         ON usage_statistics_events (day, event_type)`
      )
      .run();
    sqlite
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_usage_statistics_events_recorded_at
         ON usage_statistics_events (recorded_at)`
      )
      .run();
    sqlite
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_usage_statistics_events_video
         ON usage_statistics_events (video_id, event_type, recorded_at)`
      )
      .run();
    sqlite
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_usage_statistics_events_subscription
         ON usage_statistics_events (subscription_id, event_type, recorded_at)`
      )
      .run();
    sqlite
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_usage_statistics_events_related
         ON usage_statistics_events (related_event_id, event_type)`
      )
      .run();

    sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS usage_statistics_rollup_days (
          day TEXT PRIMARY KEY NOT NULL,
          dirty INTEGER DEFAULT 1 NOT NULL,
          sealed INTEGER DEFAULT 0 NOT NULL,
          last_event_recorded_at INTEGER,
          last_rolled_up_at INTEGER
        )`
      )
      .run();

    sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS usage_statistics_daily (
          day TEXT NOT NULL,
          metric_key TEXT NOT NULL,
          schema_version INTEGER DEFAULT 1 NOT NULL,
          platform TEXT,
          actor_role TEXT,
          source_kind TEXT,
          dimension_key TEXT DEFAULT '' NOT NULL,
          dimension_value TEXT DEFAULT '' NOT NULL,
          dimensions_hash TEXT NOT NULL,
          dimensions_json TEXT DEFAULT '{}' NOT NULL,
          count INTEGER DEFAULT 0 NOT NULL,
          sum INTEGER DEFAULT 0 NOT NULL,
          min INTEGER,
          max INTEGER,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (day, metric_key, dimensions_hash)
        )`
      )
      .run();
    sqlite
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_usage_statistics_daily_metric_day
         ON usage_statistics_daily (metric_key, day)`
      )
      .run();
    sqlite
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_usage_statistics_daily_common_dims
         ON usage_statistics_daily (metric_key, day, platform, actor_role, source_kind)`
      )
      .run();

    sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS usage_statistics_ingestion_minutes (
          minute_bucket INTEGER PRIMARY KEY NOT NULL,
          accepted_count INTEGER DEFAULT 0 NOT NULL,
          dropped_count INTEGER DEFAULT 0 NOT NULL,
          error_count INTEGER DEFAULT 0 NOT NULL,
          sealed_day_drop_count INTEGER DEFAULT 0 NOT NULL,
          updated_at INTEGER NOT NULL
        )`
      )
      .run();

    // Best-effort backfill of download_history.platform / source_kind for legacy rows.
    backfillDownloadHistoryDimensions();
  } catch (error) {
    logger.error(
      "Error self-healing statistics tables/columns",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
