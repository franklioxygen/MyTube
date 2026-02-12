import { eq } from "drizzle-orm";
import fs from "fs-extra";
import path from "path";
import {
    AVATARS_DIR,
    DATA_DIR,
    IMAGES_DIR,
    STATUS_DATA_PATH,
    SUBTITLES_DIR,
    UPLOADS_DIR,
    VIDEOS_DIR,
} from "../../config/paths";
import { db, sqlite } from "../../db";
import { downloads, videos } from "../../db/schema";
import { MigrationError } from "../../errors/DownloadErrors";
import { logger } from "../../utils/logger";
import { findVideoFile } from "./fileHelpers";

type VideoDownloadDuplicateGroup = {
  sourceVideoId: string;
  platform: string;
  count: number;
};

type VideoDownloadRecord = {
  id: string;
  status: string;
  downloadedAt: number | null;
};

function deduplicateVideoDownloadsBySourceAndPlatform(): void {
  const duplicateGroups = sqlite
    .prepare(
      `
      SELECT
        source_video_id AS sourceVideoId,
        platform,
        COUNT(*) AS count
      FROM video_downloads
      GROUP BY source_video_id, platform
      HAVING COUNT(*) > 1
      `
    )
    .all() as VideoDownloadDuplicateGroup[];

  if (duplicateGroups.length === 0) {
    return;
  }

  logger.warn(
    `Found ${duplicateGroups.length} duplicated video_downloads groups, deduplicating before unique index migration`
  );

  const getRecordsStatement = sqlite.prepare(
    `
    SELECT
      id,
      status,
      downloaded_at AS downloadedAt
    FROM video_downloads
    WHERE source_video_id = ? AND platform = ?
    ORDER BY
      CASE WHEN status = 'exists' THEN 0 ELSE 1 END ASC,
      COALESCE(downloaded_at, 0) DESC,
      id ASC
    `
  );

  const deleteDuplicatesStatement = sqlite.prepare(
    `
    DELETE FROM video_downloads
    WHERE source_video_id = ? AND platform = ? AND id <> ?
    `
  );

  for (const group of duplicateGroups) {
    const records = getRecordsStatement.all(
      group.sourceVideoId,
      group.platform
    ) as VideoDownloadRecord[];

    if (records.length <= 1) {
      continue;
    }

    const keepRecord = records[0];
    const deletedCount = deleteDuplicatesStatement.run(
      group.sourceVideoId,
      group.platform,
      keepRecord.id
    ).changes;

    logger.warn(
      `Deduplicated video_downloads (${group.sourceVideoId}, ${group.platform}), kept ${keepRecord.id}, removed ${deletedCount} records`
    );
  }
}

// Initialize storage directories and files
export function initializeStorage(): void {
  fs.ensureDirSync(UPLOADS_DIR);
  fs.ensureDirSync(VIDEOS_DIR);
  fs.ensureDirSync(IMAGES_DIR);
  fs.ensureDirSync(AVATARS_DIR);
  fs.ensureDirSync(SUBTITLES_DIR);
  fs.ensureDirSync(DATA_DIR);

  // Initialize status.json if it doesn't exist
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (!fs.existsSync(STATUS_DATA_PATH)) {
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    fs.writeFileSync(
      STATUS_DATA_PATH,
      JSON.stringify({ activeDownloads: [], queuedDownloads: [] }, null, 2)
    );
  } else {
    try {
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      const status = JSON.parse(fs.readFileSync(STATUS_DATA_PATH, "utf8"));
      status.activeDownloads = [];
      if (!status.queuedDownloads) status.queuedDownloads = [];
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(status, null, 2));
      logger.info("Cleared active downloads on startup");
    } catch (error) {
      logger.error(
        "Error resetting active downloads",
        error instanceof Error ? error : new Error(String(error))
      );
      fs.writeFileSync(
        STATUS_DATA_PATH,
        JSON.stringify({ activeDownloads: [], queuedDownloads: [] }, null, 2)
      );
    }
  }

  // Clean up active downloads from database on startup
  try {
    db.delete(downloads).where(eq(downloads.status, "active")).run();
    logger.info("Cleared active downloads from database on startup");
  } catch (error) {
    logger.error(
      "Error clearing active downloads from database",
      error instanceof Error ? error : new Error(String(error))
    );
  }

  // Check and migrate tags column if needed
  try {
    const tableInfo = sqlite.prepare("PRAGMA table_info(videos)").all();
    const hasTags = (tableInfo as any[]).some(
      (col: any) => col.name === "tags"
    );

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

  // Check and migrate viewCount and progress columns if needed
  try {
    const tableInfo = sqlite.prepare("PRAGMA table_info(videos)").all();
    const columns = (tableInfo as any[]).map((col: any) => col.name);

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

    if (!columns.includes("duration")) {
      logger.info(
        "Migrating database: Adding duration column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN duration TEXT").run();
      logger.info("Migration successful: duration added.");
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

    // Check downloads table columns
    const downloadsTableInfo = sqlite
      .prepare("PRAGMA table_info(downloads)")
      .all();
    const downloadsColumns = (downloadsTableInfo as any[]).map(
      (col: any) => col.name
    );

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

    // Check subscriptions table columns for playlist subscription fields
    try {
      const subscriptionsTableInfo = sqlite
        .prepare("PRAGMA table_info(subscriptions)")
        .all();
      const subscriptionsColumns = (subscriptionsTableInfo as any[]).map(
        (col: any) => col.name
      );

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
    } catch (subscriptionsError) {
      // Subscriptions table might not exist yet, ignore error
      logger.debug(
        "Subscriptions table migration skipped (table may not exist yet)",
        subscriptionsError instanceof Error
          ? subscriptionsError
          : new Error(String(subscriptionsError))
      );
    }

    // Create video_downloads table if it doesn't exist
    sqlite
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS video_downloads (
        id TEXT PRIMARY KEY NOT NULL,
        source_video_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        platform TEXT NOT NULL,
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

    // Create indexes for video_downloads
    try {
      deduplicateVideoDownloadsBySourceAndPlatform();
      sqlite
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS video_downloads_source_video_id_platform_uidx ON video_downloads (source_video_id, platform)`
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

    // Check download_history table for video_id, downloaded_at, deleted_at columns
    const downloadHistoryTableInfo = sqlite
      .prepare("PRAGMA table_info(download_history)")
      .all();
    const downloadHistoryColumns = (downloadHistoryTableInfo as any[]).map(
      (col: any) => col.name
    );

    if (!downloadHistoryColumns.includes("video_id")) {
      logger.info(
        "Migrating database: Adding video_id column to download_history table..."
      );
      sqlite
        .prepare("ALTER TABLE download_history ADD COLUMN video_id TEXT")
        .run();
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
    }

    // Populate fileSize for existing videos
    const allVideos = db.select().from(videos).all();
    let updatedCount = 0;
    for (const video of allVideos) {
      if (!video.fileSize) {
        let videoPath: string | null = null;
        
        // Check if video is in a mount directory
        if (video.videoPath?.startsWith("mount:")) {
          // Extract the actual file path (remove "mount:" prefix)
          const rawFilePath = video.videoPath.substring(6); // Remove "mount:" prefix
          
          // Validate path is absolute and doesn't contain traversal
          if (path.isAbsolute(rawFilePath) && !rawFilePath.includes("..") && !rawFilePath.includes("\0")) {
            const resolvedPath = path.resolve(rawFilePath);
            // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
            if (fs.existsSync(resolvedPath)) {
              videoPath = resolvedPath;
            }
          }
        } else if (video.videoFilename) {
          // For regular videos, use findVideoFile
          videoPath = findVideoFile(video.videoFilename);
        } else if (video.videoPath?.startsWith("/videos/")) {
          // Fallback: try to resolve from videoPath
          const relativePath = video.videoPath.replace("/videos/", "");
          const fullPath = path.join(VIDEOS_DIR, relativePath);
          // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
          if (fs.existsSync(fullPath)) {
            videoPath = fullPath;
          }
        }
        
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        if (videoPath && fs.existsSync(videoPath)) {
          try {
            // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
            const stats = fs.statSync(videoPath);
            // Skip 0-byte files
            if (stats.size > 0) {
              db.update(videos)
                .set({ fileSize: stats.size.toString() })
                .where(eq(videos.id, video.id))
                .run();
              updatedCount++;
            }
          } catch (error) {
            logger.warn(`Failed to get file size for video ${video.id}: ${error}`);
          }
        }
      }
    }
    if (updatedCount > 0) {
      logger.info(`Populated fileSize for ${updatedCount} videos.`);
    }

    // Backfill video_id in download_history for existing records
    try {
      const result = sqlite
        .prepare(
          `
            UPDATE download_history
            SET video_id = (SELECT id FROM videos WHERE videos.source_url = download_history.source_url)
            WHERE video_id IS NULL AND status = 'success' AND source_url IS NOT NULL
        `
        )
        .run();
      if (result && result.changes > 0) {
        logger.info(
          `Backfilled video_id for ${result.changes} download history items.`
        );
      }
    } catch (error) {
      logger.error(
        "Error backfilling video_id in download history",
        error instanceof Error ? error : new Error(String(error))
      );
    }
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
