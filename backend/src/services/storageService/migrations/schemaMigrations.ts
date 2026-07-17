import { sqlite } from "../../../db";
import { MigrationError } from "../../../errors/DownloadErrors";
import { logger } from "../../../utils/logger";
import { backfillLegacyCollectionOrigins } from "../authorCollectionUtils";
import {
  deduplicateVideoDownloadsBySourceAndPlatform,
  normalizeLegacyTwitchDownloads,
} from "./legacyTwitchDownloads";
import {
  backfillDownloadHistoryVideoIds,
  populateVideoFileSizes,
} from "./dataBackfill";

interface TableColumnInfo {
  name: string;
}

/**
 * Column names from a `PRAGMA table_info(...)` result. Centralizes the single
 * cast so the migration self-heal checks don't each sprinkle `as any[]`.
 */
function columnNames(tableInfo: unknown[]): string[] {
  return (tableInfo as TableColumnInfo[]).map((col) => col.name);
}

// Create performance indexes on the videos, collection_videos, and collections
// tables for existing databases. These indexes are declared in the schema but
// older installs created via runtime self-heal (rather than drizzle-kit) will
// not have them, so we add them idempotently at startup. CREATE INDEX IF NOT
// EXISTS makes this safe to run on every boot.
function migratePerformanceIndexes(): void {
  const indexDefs: Array<{ label: string; sql: string; requires?: string[] }> = [
    {
      label: "videos.source_url",
      sql: "CREATE INDEX IF NOT EXISTS idx_videos_source_url ON videos (source_url)",
    },
    {
      label: "videos.created_at",
      sql: "CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at)",
    },
    {
      label: "videos.visibility",
      sql: "CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos (visibility)",
    },
    {
      label: "collection_videos.video_id",
      sql: "CREATE INDEX IF NOT EXISTS idx_collection_videos_video_id ON collection_videos (video_id)",
      requires: ["collection_videos"],
    },
    {
      label: "collections.name",
      sql: "CREATE INDEX IF NOT EXISTS idx_collections_name ON collections (name)",
      requires: ["collections"],
    },
    {
      label: "collections.title",
      sql: "CREATE INDEX IF NOT EXISTS idx_collections_title ON collections (title)",
      requires: ["collections"],
    },
    {
      label: "collections.source_key",
      sql:
        "CREATE INDEX IF NOT EXISTS idx_collections_source_key ON collections " +
        "(source_platform, source_type, source_mid, source_id)",
      requires: ["collections"],
    },
    {
      label: "videos.author",
      sql: "CREATE INDEX IF NOT EXISTS idx_videos_author ON videos (author)",
    },
    {
      label: "videos.channel_url",
      sql: "CREATE INDEX IF NOT EXISTS idx_videos_channel_url ON videos (channel_url)",
    },
    {
      label: "download_history.source_url",
      sql:
        "CREATE INDEX IF NOT EXISTS download_history_source_url_idx " +
        "ON download_history (source_url)",
      requires: ["download_history"],
    },
  ];

  for (const { label, sql, requires } of indexDefs) {
    try {
      if (requires && requires.length > 0) {
        // Only create the index if the table exists (very old installs).
        const tableCheck = sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
          )
          .get(requires[0]);
        if (!tableCheck) {
          continue;
        }
      }
      sqlite.prepare(sql).run();
      logger.debug(`Index ensured: ${label}`);
    } catch (indexError) {
      // Indexes might already exist or table might not be ready; ignore.
      logger.debug(
        `Index creation skipped for ${label} (may already exist)`,
        indexError instanceof Error
          ? indexError
          : new Error(String(indexError))
      );
    }
  }
}

// Check and migrate the tags column on the videos table if needed.
export function migrateTagsColumn(): void {
  try {
    const tableInfo = sqlite.prepare("PRAGMA table_info(videos)").all();
    const hasTags = columnNames(tableInfo).includes("tags");

    if (!hasTags) {
      logger.info("Migrating database: Adding tags column to videos table...");
      sqlite.prepare("ALTER TABLE videos ADD COLUMN tags TEXT").run();
      logger.info("Migration successful.");
    }
  } catch (error) {
    logger.error(
      "Error checking/migrating tags column",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new MigrationError(
      "Failed to migrate tags column",
      "tags_column",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

// Collections + subscriptions self-heal columns. Tolerates tables that may not
// exist yet on very old installs.
function migrateCollectionsAndSubscriptionsColumns(): void {
  try {
    const collectionsTableInfo = sqlite
      .prepare("PRAGMA table_info(collections)")
      .all();
    const collectionsColumns = columnNames(collectionsTableInfo);

    if (
      collectionsColumns.length > 0 &&
      !collectionsColumns.includes("origin")
    ) {
      logger.info(
        "Migrating database: Adding origin column to collections table..."
      );
      sqlite
        .prepare("ALTER TABLE collections ADD COLUMN origin TEXT")
        .run();
      logger.info("Migration successful: origin added.");
    }

    if (collectionsColumns.length > 0) {
      const sourceKeyColumns: Array<{ name: string; column: string }> = [
        { name: "source_platform", column: "source_platform" },
        { name: "source_type", column: "source_type" },
        { name: "source_mid", column: "source_mid" },
        { name: "source_id", column: "source_id" },
      ];
      for (const { name, column } of sourceKeyColumns) {
        if (!collectionsColumns.includes(name)) {
          logger.info(
            `Migrating database: Adding ${column} column to collections table...`
          );
          sqlite
            .prepare(`ALTER TABLE collections ADD COLUMN ${column} TEXT`)
            .run();
          logger.info(`Migration successful: ${column} added.`);
        }
      }
    }

    if (collectionsColumns.length > 0) {
      backfillLegacyCollectionOrigins();
    }

    const subscriptionsTableInfo = sqlite
      .prepare("PRAGMA table_info(subscriptions)")
      .all();
    const subscriptionsColumns = columnNames(subscriptionsTableInfo);

    if (!subscriptionsColumns.includes("playlist_id")) {
      logger.info(
        "Migrating database: Adding playlist_id column to subscriptions table..."
      );
      sqlite
        .prepare("ALTER TABLE subscriptions ADD COLUMN playlist_id TEXT")
        .run();
      logger.info("Migration successful: playlist_id added.");
    }

    if (!subscriptionsColumns.includes("playlist_title")) {
      logger.info(
        "Migrating database: Adding playlist_title column to subscriptions table..."
      );
      sqlite
        .prepare("ALTER TABLE subscriptions ADD COLUMN playlist_title TEXT")
        .run();
      logger.info("Migration successful: playlist_title added.");
    }

    if (!subscriptionsColumns.includes("channel_name")) {
      logger.info(
        "Migrating database: Adding channel_name column to subscriptions table..."
      );
      sqlite
        .prepare("ALTER TABLE subscriptions ADD COLUMN channel_name TEXT")
        .run();
      logger.info("Migration successful: channel_name added.");
    }

    if (!subscriptionsColumns.includes("subscription_type")) {
      logger.info(
        "Migrating database: Adding subscription_type column to subscriptions table..."
      );
      sqlite
        .prepare(
          "ALTER TABLE subscriptions ADD COLUMN subscription_type TEXT DEFAULT 'author'"
        )
        .run();
      logger.info("Migration successful: subscription_type added.");
    }

    if (!subscriptionsColumns.includes("collection_id")) {
      logger.info(
        "Migrating database: Adding collection_id column to subscriptions table..."
      );
      sqlite
        .prepare("ALTER TABLE subscriptions ADD COLUMN collection_id TEXT")
        .run();
      logger.info("Migration successful: collection_id added.");
    }

    if (!subscriptionsColumns.includes("download_shorts")) {
      logger.info(
        "Migrating database: Adding download_shorts column to subscriptions table..."
      );
      sqlite
        .prepare(
          "ALTER TABLE subscriptions ADD COLUMN download_shorts INTEGER DEFAULT 0"
        )
        .run();
      logger.info("Migration successful: download_shorts added.");
    }

    if (!subscriptionsColumns.includes("last_short_video_link")) {
      logger.info(
        "Migrating database: Adding last_short_video_link column to subscriptions table..."
      );
      sqlite
        .prepare(
          "ALTER TABLE subscriptions ADD COLUMN last_short_video_link TEXT"
        )
        .run();
      logger.info("Migration successful: last_short_video_link added.");
    }

    if (!subscriptionsColumns.includes("twitch_broadcaster_id")) {
      logger.info(
        "Migrating database: Adding twitch_broadcaster_id column to subscriptions table..."
      );
      sqlite
        .prepare(
          "ALTER TABLE subscriptions ADD COLUMN twitch_broadcaster_id TEXT"
        )
        .run();
      logger.info("Migration successful: twitch_broadcaster_id added.");
    }

    if (!subscriptionsColumns.includes("twitch_broadcaster_login")) {
      logger.info(
        "Migrating database: Adding twitch_broadcaster_login column to subscriptions table..."
      );
      sqlite
        .prepare(
          "ALTER TABLE subscriptions ADD COLUMN twitch_broadcaster_login TEXT"
        )
        .run();
      logger.info("Migration successful: twitch_broadcaster_login added.");
    }

    if (!subscriptionsColumns.includes("last_twitch_video_id")) {
      logger.info(
        "Migrating database: Adding last_twitch_video_id column to subscriptions table..."
      );
      sqlite
        .prepare(
          "ALTER TABLE subscriptions ADD COLUMN last_twitch_video_id TEXT"
        )
        .run();
      logger.info("Migration successful: last_twitch_video_id added.");
    }

    if (!subscriptionsColumns.includes("retention_days")) {
      logger.info(
        "Migrating database: Adding retention_days column to subscriptions table..."
      );
      sqlite
        .prepare("ALTER TABLE subscriptions ADD COLUMN retention_days INTEGER")
        .run();
      logger.info("Migration successful: retention_days added.");
    }

    // Per-subscription yt-dlp config override (issue #345). Self-heal in case
    // drizzle aborted its batch before applying 0024 on an existing install.
    if (!subscriptionsColumns.includes("ytdlp_config")) {
      logger.info(
        "Migrating database: Adding ytdlp_config column to subscriptions table..."
      );
      sqlite
        .prepare("ALTER TABLE subscriptions ADD COLUMN ytdlp_config TEXT")
        .run();
      logger.info("Migration successful: ytdlp_config added.");
    }

    // Per-subscription filename-template override (issue #368). Self-heal in
    // case drizzle aborted its batch before applying 0025 on an existing install.
    if (!subscriptionsColumns.includes("filename_template")) {
      logger.info(
        "Migrating database: Adding filename_template column to subscriptions table..."
      );
      sqlite
        .prepare(
          "ALTER TABLE subscriptions ADD COLUMN filename_template TEXT"
        )
        .run();
      logger.info("Migration successful: filename_template added.");
    }

    sqlite
      .prepare(
        `
        UPDATE subscriptions
        SET channel_name = substr(author, length(playlist_title) + 4)
        WHERE subscription_type = 'playlist'
          AND (channel_name IS NULL OR channel_name = '')
          AND playlist_title IS NOT NULL
          AND playlist_title != ''
          AND substr(author, 1, length(playlist_title) + 3) = playlist_title || ' - '
      `
      )
      .run();
  } catch (subscriptionsError) {
    // Subscriptions table might not exist yet, ignore error
    logger.debug(
      "Subscriptions table migration skipped (table may not exist yet)",
      subscriptionsError instanceof Error
        ? subscriptionsError
        : new Error(String(subscriptionsError))
    );
  }
}

// Check continuous_download_tasks table columns for download-order feature fields.
// This is a runtime self-heal for older databases where drizzle migrations were skipped.
function migrateContinuousDownloadTaskColumns(): void {
  try {
    const taskTableInfo = sqlite
      .prepare("PRAGMA table_info(continuous_download_tasks)")
      .all();
    const taskColumns = columnNames(taskTableInfo);

    if (taskColumns.length > 0) {
      if (!taskColumns.includes("download_order")) {
        logger.info(
          "Migrating database: Adding download_order column to continuous_download_tasks table..."
        );
        sqlite
          .prepare(
            "ALTER TABLE continuous_download_tasks ADD COLUMN download_order TEXT NOT NULL DEFAULT 'dateDesc'"
          )
          .run();
        logger.info("Migration successful: download_order added.");
      }

      if (!taskColumns.includes("frozen_video_list_path")) {
        logger.info(
          "Migrating database: Adding frozen_video_list_path column to continuous_download_tasks table..."
        );
        sqlite
          .prepare(
            "ALTER TABLE continuous_download_tasks ADD COLUMN frozen_video_list_path TEXT"
          )
          .run();
        logger.info("Migration successful: frozen_video_list_path added.");
      }
    }
  } catch (taskTableMigrationError) {
    // Table might not exist yet on very old installs; migration will be handled by drizzle.
    logger.debug(
      "Continuous download tasks table migration skipped (table may not exist yet)",
      taskTableMigrationError instanceof Error
        ? taskTableMigrationError
        : new Error(String(taskTableMigrationError))
    );
  }
}

// Ensure the visitor `users` table (and its case-insensitive username index)
// exists even if drizzle never applied the visitor-users migration (0019).
//
// On installs whose __drizzle_migrations journal is out of sync with the
// migration files, drizzle-kit aborts the whole migration batch on the first
// duplicate-column ALTER it encounters. runMigrations() swallows that error
// ("verified by initialization.ts"), which means every migration ordered after
// the failing one -- including the CREATE TABLE users in 0019 -- silently never
// runs, leaving the app to throw "no such table: users" on every request.
// CREATE TABLE / INDEX IF NOT EXISTS makes this idempotent and safe on every
// boot, mirroring the rss_tokens / video_downloads self-heals below.
export function ensureVisitorUsersTable(): void {
  try {
    sqlite
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'visitor' NOT NULL,
        enabled INTEGER DEFAULT 1 NOT NULL,
        is_legacy_shared INTEGER DEFAULT 0 NOT NULL,
        session_version INTEGER DEFAULT 1 NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER,
        CONSTRAINT users_role_check CHECK(role IN ('visitor'))
      )
    `
      )
      .run();
    sqlite
      .prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx ON users (lower(username))"
      )
      .run();
  } catch (error) {
    logger.error(
      "Error ensuring visitor users table exists",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new MigrationError(
      "Failed to ensure visitor users table",
      "users_table",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

// Ensure the favorites tables (favorite_collections / favorite_authors) exist
// even if drizzle never applied the favorites migration (0021).
//
// Same failure mode as ensureVisitorUsersTable above: on installs whose
// __drizzle_migrations journal is out of sync with the migration files,
// drizzle-kit aborts the whole batch on the first duplicate-column ALTER, and
// runMigrations() swallows that error. Every migration ordered after the
// failing one -- including the CREATE TABLEs in 0021 -- then silently never
// runs, so GET /favorites/collections and /favorites/authors throw
// "no such table: favorite_collections" (HTTP 500) on every request.
// CREATE TABLE / INDEX IF NOT EXISTS makes this idempotent and safe every boot.
export function ensureFavoritesTables(): void {
  try {
    sqlite
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS favorite_collections (
        user_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, collection_id),
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON UPDATE no action ON DELETE cascade
      )
    `
      )
      .run();
    sqlite
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_favorite_collections_user ON favorite_collections (user_id)"
      )
      .run();

    sqlite
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS favorite_authors (
        user_id TEXT NOT NULL,
        author TEXT NOT NULL,
        display_name TEXT,
        avatar_path TEXT,
        channel_url TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, author)
      )
    `
      )
      .run();
    sqlite
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_favorite_authors_user ON favorite_authors (user_id)"
      )
      .run();
    sqlite
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_favorite_authors_author ON favorite_authors (author)"
      )
      .run();
  } catch (error) {
    logger.error(
      "Error ensuring favorites tables exist",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new MigrationError(
      "Failed to ensure favorites tables",
      "favorites_tables",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

// Additive column/table self-heal for videos, downloads, collections,
// subscriptions, continuous tasks, video_downloads, rss_tokens, users,
// favorites and download_history, plus the file-size/video_id data backfills.
export function migrateColumnsAndTables(): void {
  try {
    const tableInfo = sqlite.prepare("PRAGMA table_info(videos)").all();
    const columns = columnNames(tableInfo);

    if (!columns.includes("view_count")) {
      logger.info(
        "Migrating database: Adding view_count column to videos table..."
      );
      sqlite
        .prepare("ALTER TABLE videos ADD COLUMN view_count INTEGER DEFAULT 0")
        .run();
      logger.info("Migration successful: view_count added.");
    }

    if (!columns.includes("progress")) {
      logger.info(
        "Migrating database: Adding progress column to videos table..."
      );
      sqlite
        .prepare("ALTER TABLE videos ADD COLUMN progress INTEGER DEFAULT 0")
        .run();
      logger.info("Migration successful: progress added.");
    }

    if (!columns.includes("progress_updated_at")) {
      logger.info(
        "Migrating database: Adding progress_updated_at column to videos table..."
      );
      sqlite
        .prepare("ALTER TABLE videos ADD COLUMN progress_updated_at INTEGER")
        .run();
      logger.info("Migration successful: progress_updated_at added.");
    }

    if (!columns.includes("duration")) {
      logger.info(
        "Migrating database: Adding duration column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN duration TEXT").run();
      logger.info("Migration successful: duration added.");
    }

    if (!columns.includes("width")) {
      logger.info(
        "Migrating database: Adding width column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN width INTEGER").run();
      logger.info("Migration successful: width added.");
    }

    if (!columns.includes("height")) {
      logger.info(
        "Migrating database: Adding height column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN height INTEGER").run();
      logger.info("Migration successful: height added.");
    }

    if (!columns.includes("file_size")) {
      logger.info(
        "Migrating database: Adding file_size column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN file_size TEXT").run();
      logger.info("Migration successful: file_size added.");
    }

    if (!columns.includes("last_played_at")) {
      logger.info(
        "Migrating database: Adding last_played_at column to videos table..."
      );
      sqlite
        .prepare("ALTER TABLE videos ADD COLUMN last_played_at INTEGER")
        .run();
      logger.info("Migration successful: last_played_at added.");
    }

    if (!columns.includes("subtitles")) {
      logger.info(
        "Migrating database: Adding subtitles column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN subtitles TEXT").run();
      logger.info("Migration successful: subtitles added.");
    }

    if (!columns.includes("description")) {
      logger.info(
        "Migrating database: Adding description column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN description TEXT").run();
      logger.info("Migration successful: description added.");
    }

    if (!columns.includes("author_avatar_filename")) {
      logger.info(
        "Migrating database: Adding author_avatar_filename column to videos table..."
      );
      sqlite
        .prepare("ALTER TABLE videos ADD COLUMN author_avatar_filename TEXT")
        .run();
      logger.info("Migration successful: author_avatar_filename added.");
    }

    if (!columns.includes("author_avatar_path")) {
      logger.info(
        "Migrating database: Adding author_avatar_path column to videos table..."
      );
      sqlite
        .prepare("ALTER TABLE videos ADD COLUMN author_avatar_path TEXT")
        .run();
      logger.info("Migration successful: author_avatar_path added.");
    }

    if (!columns.includes("media_type")) {
      logger.info(
        "Migrating database: Adding media_type column to videos table..."
      );
      sqlite
        .prepare("ALTER TABLE videos ADD COLUMN media_type TEXT DEFAULT 'video'")
        .run();
      logger.info("Migration successful: media_type added.");
    }

    // Check downloads table columns
    const downloadsTableInfo = sqlite
      .prepare("PRAGMA table_info(downloads)")
      .all();
    const downloadsColumns = columnNames(downloadsTableInfo);

    if (!downloadsColumns.includes("source_url")) {
      logger.info(
        "Migrating database: Adding source_url column to downloads table..."
      );
      sqlite.prepare("ALTER TABLE downloads ADD COLUMN source_url TEXT").run();
      logger.info("Migration successful: source_url added.");
    }

    if (!downloadsColumns.includes("type")) {
      logger.info(
        "Migrating database: Adding type column to downloads table..."
      );
      sqlite.prepare("ALTER TABLE downloads ADD COLUMN type TEXT").run();
      logger.info("Migration successful: type added.");
    }

    if (!downloadsColumns.includes("retry_metadata")) {
      logger.info(
        "Migrating database: Adding retry_metadata column to downloads table..."
      );
      sqlite
        .prepare("ALTER TABLE downloads ADD COLUMN retry_metadata TEXT")
        .run();
      logger.info("Migration successful: retry_metadata added.");
    }

    // Check subscriptions table columns for playlist subscription fields
    migrateCollectionsAndSubscriptionsColumns();

    // Check continuous_download_tasks table columns for download-order feature fields.
    migrateContinuousDownloadTaskColumns();

    // Create video_downloads table if it doesn't exist
    sqlite
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS video_downloads (
        id TEXT PRIMARY KEY NOT NULL,
        source_video_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        platform TEXT NOT NULL,
        media_type TEXT DEFAULT 'video' NOT NULL,
        video_id TEXT,
        title TEXT,
        author TEXT,
        status TEXT DEFAULT 'exists' NOT NULL,
        downloaded_at INTEGER NOT NULL,
        deleted_at INTEGER
      )
    `
      )
      .run();

    // Self-heal the media_type column on older databases so audio-only
    // downloads can be tracked separately from the video for the same source.
    const videoDownloadsInfo = sqlite
      .prepare("PRAGMA table_info(video_downloads)")
      .all();
    if (!columnNames(videoDownloadsInfo).includes("media_type")) {
      sqlite
        .prepare(
          "ALTER TABLE video_downloads ADD COLUMN media_type TEXT DEFAULT 'video' NOT NULL"
        )
        .run();
    }

    // Create indexes for video_downloads
    try {
      normalizeLegacyTwitchDownloads();
      deduplicateVideoDownloadsBySourceAndPlatform();
      // The unique constraint now includes media_type; drop the legacy
      // (source_video_id, platform) index so audio and video rows for the same
      // source can coexist.
      sqlite
        .prepare(
          `DROP INDEX IF EXISTS video_downloads_source_video_id_platform_uidx`
        )
        .run();
      sqlite
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS video_downloads_source_video_id_platform_media_type_uidx ON video_downloads (source_video_id, platform, media_type)`
        )
        .run();
      sqlite
        .prepare(
          `CREATE INDEX IF NOT EXISTS video_downloads_source_video_id_idx ON video_downloads (source_video_id)`
        )
        .run();
      sqlite
        .prepare(
          `CREATE INDEX IF NOT EXISTS video_downloads_source_url_idx ON video_downloads (source_url)`
        )
        .run();
    } catch (indexError) {
      // Indexes might already exist, ignore error
      logger.debug(
        "Index creation skipped (may already exist)",
        indexError instanceof Error ? indexError : new Error(String(indexError))
      );
    }

    // Ensure RSS tokens table exists even if older self-healing migrations stopped
    // Drizzle before the RSS migration was applied.
    sqlite
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS rss_tokens (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT DEFAULT '' NOT NULL,
        role TEXT DEFAULT 'visitor' NOT NULL,
        filters TEXT DEFAULT '{}' NOT NULL,
        is_active INTEGER DEFAULT 1 NOT NULL,
        access_count INTEGER DEFAULT 0 NOT NULL,
        last_accessed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CONSTRAINT rss_tokens_role_check CHECK(role IN ('admin', 'visitor'))
      )
    `
      )
      .run();
    sqlite
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_rss_tokens_active ON rss_tokens (is_active)"
      )
      .run();
    sqlite
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_rss_tokens_created_at ON rss_tokens (created_at)"
      )
      .run();

    // Ensure the visitor users table exists even if drizzle stopped before the
    // 0019 visitor-users migration was applied.
    ensureVisitorUsersTable();

    // Ensure the favorites tables exist even if drizzle stopped before the
    // 0021 favorites migration was applied.
    ensureFavoritesTables();

    // Check download_history table for video_id, downloaded_at, deleted_at columns
    const downloadHistoryTableInfo = sqlite
      .prepare("PRAGMA table_info(download_history)")
      .all();
    const downloadHistoryColumns = columnNames(downloadHistoryTableInfo);

    if (!downloadHistoryColumns.includes("video_id")) {
      logger.info(
        "Migrating database: Adding video_id column to download_history table..."
      );
      sqlite
        .prepare("ALTER TABLE download_history ADD COLUMN video_id TEXT")
        .run();
      downloadHistoryColumns.push("video_id");
      logger.info("Migration successful: video_id added to download_history.");
    }

    if (!downloadHistoryColumns.includes("downloaded_at")) {
      logger.info(
        "Migrating database: Adding downloaded_at column to download_history table..."
      );
      sqlite
        .prepare(
          "ALTER TABLE download_history ADD COLUMN downloaded_at INTEGER"
        )
        .run();
      logger.info(
        "Migration successful: downloaded_at added to download_history."
      );
      downloadHistoryColumns.push("downloaded_at");
    }

    if (!downloadHistoryColumns.includes("deleted_at")) {
      logger.info(
        "Migrating database: Adding deleted_at column to download_history table..."
      );
      sqlite
        .prepare("ALTER TABLE download_history ADD COLUMN deleted_at INTEGER")
        .run();
      logger.info(
        "Migration successful: deleted_at added to download_history."
      );
      downloadHistoryColumns.push("deleted_at");
    }

    if (
      downloadHistoryColumns.includes("subscription_id") &&
      downloadHistoryColumns.includes("status") &&
      downloadHistoryColumns.includes("finished_at")
    ) {
      sqlite
        .prepare(
          `CREATE INDEX IF NOT EXISTS download_history_retention_subscription_idx
           ON download_history (subscription_id, status, finished_at)`
        )
        .run();
    }

    if (
      downloadHistoryColumns.includes("video_id") &&
      downloadHistoryColumns.includes("status") &&
      downloadHistoryColumns.includes("subscription_id")
    ) {
      sqlite
        .prepare(
          `CREATE INDEX IF NOT EXISTS download_history_retention_video_refs_idx
           ON download_history (video_id, status, subscription_id)`
        )
        .run();
    }

    // Populate fileSize for existing videos
    populateVideoFileSizes();

    // Backfill video_id in download_history for existing records
    backfillDownloadHistoryVideoIds();

    // Ensure performance indexes exist on existing databases.
    migratePerformanceIndexes();
  } catch (error) {
    logger.error(
      "Error checking/migrating viewCount/progress/duration/fileSize columns",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new MigrationError(
      "Failed to migrate database columns",
      "columns_migration",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
