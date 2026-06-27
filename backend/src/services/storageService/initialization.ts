import { eq } from "drizzle-orm";
import fs from "fs-extra";
import {
    AVATARS_DIR,
    DATA_DIR,
    IMAGES_DIR,
    STATUS_DATA_PATH,
    SUBTITLES_DIR,
    UPLOADS_DIR,
    VIDEOS_DIR,
} from "../../config/paths";
import { db } from "../../db";
import { downloads } from "../../db/schema";
import { logger } from "../../utils/logger";
import {
  pathExistsSafeSync,
  readFileSafeSync,
  writeFileSafeSync,
} from "../../utils/security";
import {
  migrateColumnsAndTables,
  migrateTagsColumn,
} from "./migrations/schemaMigrations";
import { migrateStatisticsSchema } from "./migrations/statisticsSchema";

// Initialize storage directories and files, then run runtime self-heal
// migrations. The heavy lifting lives in ./migrations/*; this file just
// orchestrates the startup sequence.
export function initializeStorage(): void {
  fs.ensureDirSync(UPLOADS_DIR);
  fs.ensureDirSync(VIDEOS_DIR);
  fs.ensureDirSync(IMAGES_DIR);
  fs.ensureDirSync(AVATARS_DIR);
  fs.ensureDirSync(SUBTITLES_DIR);
  fs.ensureDirSync(DATA_DIR);

  // Initialize status.json if it doesn't exist
  if (!pathExistsSafeSync(STATUS_DATA_PATH, DATA_DIR)) {
    writeFileSafeSync(
      STATUS_DATA_PATH,
      DATA_DIR,
      JSON.stringify({ activeDownloads: [], queuedDownloads: [] }, null, 2)
    );
  } else {
    try {
      const status = JSON.parse(readFileSafeSync(STATUS_DATA_PATH, DATA_DIR, "utf8"));
      status.activeDownloads = [];
      if (!status.queuedDownloads) status.queuedDownloads = [];
      writeFileSafeSync(
        STATUS_DATA_PATH,
        DATA_DIR,
        JSON.stringify(status, null, 2)
      );
      logger.info("Cleared active downloads on startup");
    } catch (error) {
      logger.error(
        "Error resetting active downloads",
        error instanceof Error ? error : new Error(String(error))
      );
      writeFileSafeSync(
        STATUS_DATA_PATH,
        DATA_DIR,
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

  // Runtime self-heal migrations (additive columns/tables + data backfills).
  migrateTagsColumn();
  migrateColumnsAndTables();
  migrateStatisticsSchema();
}
