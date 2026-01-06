import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import fs from "fs-extra";
import { ROOT_DIR } from "../config/paths";
import { configureDatabase, db, sqlite } from "./index";

export async function runMigrations() {
  try {
    console.log("Running database migrations...");
    
    // For network filesystems (NFS/SMB), add a small delay to ensure
    // the database file is fully accessible before attempting migration
    // This helps prevent "database is locked" errors on first deployment
    const dbPath = path.join(ROOT_DIR, "data", "mytube.db");
    if (!fs.existsSync(dbPath)) {
      console.log("Database file does not exist yet, waiting for file system sync...");
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay
    }
    
    // In production/docker, the drizzle folder is copied to the root or src/drizzle
    // We need to find where it is.
    // Based on Dockerfile: COPY . . -> it should be at /app/drizzle

    const migrationsFolder = path.join(ROOT_DIR, "drizzle");

    migrate(db, { migrationsFolder });
    console.log("Database migrations completed successfully.");

    // Re-apply database configuration after migration
    // This ensures journal_mode is set to DELETE even if migration changed it
    // or if the database file already existed with WAL mode
    // This is critical for NTFS/FUSE filesystem compatibility
    configureDatabase(sqlite);
    console.log("Database configuration applied (NTFS/FUSE compatible mode).");

    // Check for legacy data files and run data migration if found
    const { runMigration: runDataMigration } = await import(
      "../services/migrationService"
    );
    const { VIDEOS_DATA_PATH, COLLECTIONS_DATA_PATH, STATUS_DATA_PATH } =
      await import("../config/paths");

    // Hardcoded path for settings as in migrationService
    const SETTINGS_DATA_PATH = path.join(
      path.dirname(VIDEOS_DATA_PATH),
      "settings.json"
    );

    const hasLegacyData =
      fs.existsSync(VIDEOS_DATA_PATH) ||
      fs.existsSync(COLLECTIONS_DATA_PATH) ||
      fs.existsSync(STATUS_DATA_PATH) ||
      fs.existsSync(SETTINGS_DATA_PATH);

    if (hasLegacyData) {
      console.log("Legacy data files found. Running data migration...");
      await runDataMigration();
    } else {
      console.log("No legacy data files found. Skipping data migration.");
    }
  } catch (error) {
    console.error("Error running database migrations:", error);
    // Don't throw, as we might want the app to start even if migration fails (though it might be broken)
    // But for initial setup, it's critical.
    throw error;
    // console.warn("Migration failed but continuing server startup...");
  }
}
