import { eq } from "drizzle-orm";
import fs from "fs-extra";
import {
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

// Initialize storage directories and files
export function initializeStorage(): void {
  fs.ensureDirSync(UPLOADS_DIR);
  fs.ensureDirSync(VIDEOS_DIR);
  fs.ensureDirSync(IMAGES_DIR);
  fs.ensureDirSync(SUBTITLES_DIR);
  fs.ensureDirSync(DATA_DIR);

  // Initialize status.json if it doesn't exist
  if (!fs.existsSync(STATUS_DATA_PATH)) {
    fs.writeFileSync(
      STATUS_DATA_PATH,
      JSON.stringify({ activeDownloads: [], queuedDownloads: [] }, null, 2)
    );
  } else {
    try {
      const status = JSON.parse(fs.readFileSync(STATUS_DATA_PATH, "utf8"));
      status.activeDownloads = [];
      if (!status.queuedDownloads) status.queuedDownloads = [];
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
      if (!video.fileSize && video.videoFilename) {
        const videoPath = findVideoFile(video.videoFilename);
        if (videoPath && fs.existsSync(videoPath)) {
          const stats = fs.statSync(videoPath);
          db.update(videos)
            .set({ fileSize: stats.size.toString() })
            .where(eq(videos.id, video.id))
            .run();
          updatedCount++;
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
      if (result.changes > 0) {
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
