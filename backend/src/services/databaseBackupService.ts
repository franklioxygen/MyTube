import Database from "better-sqlite3";
import path from "path";
import { DATA_DIR } from "../config/paths";
import { sqlite } from "../db";
import { runMigrations } from "../db/migrate";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { logger } from "../utils/logger";
import {
  copyFileSafeSync,
  isPathWithinDirectory,
  pathExistsSafeSync,
  readdirSafeSync,
  resolveSafePath,
  unlinkSafeSync,
} from "../utils/security";
import {
  backupPattern,
  dbPath,
  RESOLVED_DATA_DIR,
  RESOLVED_DB_PATH,
} from "./databaseBackup/constants";
import {
  cleanupTempImportFile,
  createBackup,
  getBackupFiles,
  prepareTempImportFile,
  reinitializeDatabase,
  validateDatabase,
} from "./databaseBackup/backupFiles";
import { executeDatabaseMerge } from "./databaseBackup/tableMerges";
import { hasTable } from "./databaseBackup/sqliteHelpers";
import { MERGEABLE_TABLES } from "./databaseBackup/types";

export type { DatabaseMergeSummary } from "./databaseBackup/types";
import type { DatabaseMergeSummary } from "./databaseBackup/types";

/**
 * Export database as backup file
 * Returns the path to the database file
 */
export function exportDatabase(): string {
  if (!pathExistsSafeSync(dbPath, DATA_DIR)) {
    throw new NotFoundError("Database file", "mytube.db");
  }
  return dbPath;
}

/**
 * Import database from backup file
 * @param fileBuffer - Uploaded SQLite database bytes
 */
export async function importDatabase(fileBuffer: Buffer): Promise<void> {
  const tempImportPath = prepareTempImportFile(fileBuffer);

  // Create backup of current database before import
  const backupPath = createBackup();

  try {
    // Close the current database connection before replacing the file
    sqlite.close();
    logger.info("Closed current database connection for import");

    // Simply copy the uploaded file to replace the database
    copyFileSafeSync(tempImportPath, DATA_DIR, RESOLVED_DB_PATH, DATA_DIR);
    logger.info(`Database file replaced successfully`);

    // Reinitialize the database connection with the new file
    reinitializeDatabase();

    // Bring the imported database up to the current schema. An older backup
    // may predate recent migrations; running them (rather than an ad-hoc table
    // self-heal) also records Drizzle's migration journal, so the next startup
    // does not re-run an already-applied migration and crash on "table already
    // exists".
    await runMigrations();
  } catch (error: unknown) {
    // Restore backup if import failed
    if (pathExistsSafeSync(backupPath, DATA_DIR)) {
      try {
        const resolvedBackupPath = path.resolve(backupPath);
        const isSafeBackupPath = isPathWithinDirectory(
          resolvedBackupPath,
          RESOLVED_DATA_DIR,
        );
        if (!isSafeBackupPath) {
          throw new ValidationError("Invalid backup file path", "file");
        }
        copyFileSafeSync(
          resolvedBackupPath,
          DATA_DIR,
          RESOLVED_DB_PATH,
          DATA_DIR,
        );
        // The failure may have happened after the connection was reopened on
        // the (bad) imported file, so point it back at the restored backup.
        reinitializeDatabase();
        logger.info("Restored database from backup after failed import");
      } catch (restoreError) {
        logger.error("Failed to restore database from backup:", restoreError);
      }
    }

    // Log the actual error for debugging
    logger.error(
      "Database import failed:",
      error instanceof Error ? error : new Error(String(error))
    );

    throw error;
  } finally {
    cleanupTempImportFile(tempImportPath);
  }
}

/**
 * Preview what a database merge would add or skip without mutating current data.
 */
export function previewMergeDatabase(fileBuffer: Buffer): DatabaseMergeSummary {
  const tempImportPath = prepareTempImportFile(fileBuffer);
  let sourceDb: Database.Database | null = null;

  try {
    const openedSourceDb = new Database(tempImportPath, { readonly: true });
    sourceDb = openedSourceDb;

    const hasMergeableData = MERGEABLE_TABLES.some((tableName) =>
      hasTable(openedSourceDb, tableName)
    );
    if (!hasMergeableData) {
      throw new ValidationError(
        "Uploaded database does not contain compatible MyTube tables to merge.",
        "file"
      );
    }

    return executeDatabaseMerge(openedSourceDb, sqlite, {
      applyChanges: false,
      persistTagSettings: false,
    });
  } catch (error) {
    logger.error(
      "Database merge preview failed:",
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  } finally {
    if (sourceDb) {
      sourceDb.close();
    }
    cleanupTempImportFile(tempImportPath);
  }
}

/**
 * Merge another database backup into the current database
 * Current instance settings, credentials, and runtime download/task state are preserved.
 */
export function mergeDatabase(fileBuffer: Buffer): DatabaseMergeSummary {
  const tempImportPath = prepareTempImportFile(fileBuffer);
  let sourceDb: Database.Database | null = null;

  try {
    const openedSourceDb = new Database(tempImportPath, { readonly: true });
    sourceDb = openedSourceDb;

    const hasMergeableData = MERGEABLE_TABLES.some((tableName) =>
      hasTable(openedSourceDb, tableName)
    );
    if (!hasMergeableData) {
      throw new ValidationError(
        "Uploaded database does not contain compatible MyTube tables to merge.",
        "file"
      );
    }

    createBackup();

    const summary = sqlite.transaction(() =>
      executeDatabaseMerge(openedSourceDb, sqlite, {
        applyChanges: true,
        persistTagSettings: true,
      })
    )();

    logger.info(
      `Merged database backup successfully: ${JSON.stringify(summary)}`
    );

    return summary;
  } catch (error) {
    logger.error(
      "Database merge failed:",
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  } finally {
    if (sourceDb) {
      sourceDb.close();
    }
    cleanupTempImportFile(tempImportPath);
  }
}

/**
 * Get last backup database file info
 */
export function getLastBackupInfo(): {
  exists: boolean;
  filename?: string;
  timestamp?: string;
} {
  const backupFiles = getBackupFiles();

  if (backupFiles.length === 0) {
    return { exists: false };
  }

  const lastBackup = backupFiles[0];
  return {
    exists: true,
    filename: lastBackup.filename,
    timestamp: lastBackup.timestamp,
  };
}

/**
 * Restore database from last backup file
 */
export async function restoreFromLastBackup(): Promise<void> {
  const backupFiles = getBackupFiles();

  if (backupFiles.length === 0) {
    throw new NotFoundError(
      "Backup database file",
      "mytube-backup-*.db.backup"
    );
  }

  const lastBackup = backupFiles[0];
  const backupPath = lastBackup.filePath;
  const resolvedBackupPath = path.resolve(backupPath);
  const isSafeBackupPath = isPathWithinDirectory(
    resolvedBackupPath,
    RESOLVED_DATA_DIR,
  );
  if (!isSafeBackupPath) {
    throw new ValidationError("Invalid backup file path", "file");
  }

  // Validate the backup file is a valid SQLite database
  validateDatabase(resolvedBackupPath);

  // Create backup of current database before restore
  createBackup();

  // Close the current database connection before replacing the file
  sqlite.close();
  logger.info("Closed current database connection for restore");

  // Copy the backup file to replace the database
  copyFileSafeSync(resolvedBackupPath, DATA_DIR, RESOLVED_DB_PATH, DATA_DIR);
  logger.info(
    `Database file restored successfully from ${lastBackup.filename}`
  );

  // Reinitialize the database connection with the restored file
  reinitializeDatabase();

  // Migrate the restored database to the current schema and record Drizzle's
  // migration journal, so an older backup does not leave later migrations
  // unapplied (and does not crash a subsequent startup re-running them).
  await runMigrations();
}

/**
 * Clean up backup database files
 */
export function cleanupBackupDatabases(): {
  deleted: number;
  failed: number;
  errors: string[];
} {
  let deletedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  try {
    const files = readdirSafeSync(DATA_DIR, DATA_DIR);

    for (const file of files) {
      if (backupPattern.test(file)) {
        const filePath = resolveSafePath(path.join(DATA_DIR, file), DATA_DIR);
        try {
          unlinkSafeSync(filePath, DATA_DIR);
          deletedCount++;
          logger.info(`Deleted backup database file: ${file}`);
        } catch (error: unknown) {
          failedCount++;
          const errorMsg = `Failed to delete ${file}: ${
            error instanceof Error ? error.message : String(error)
          }`;
          errors.push(errorMsg);
          logger.error(errorMsg);
        }
      }
    }
  } catch (error: unknown) {
    logger.error("Error cleaning up backup databases:", error);
    throw error;
  }

  return {
    deleted: deletedCount,
    failed: failedCount,
    errors,
  };
}
