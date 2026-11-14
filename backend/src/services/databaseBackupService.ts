import Database from "better-sqlite3";
import { bumpVideosListRevision } from "./storageService/videoListRevision";
import crypto from "crypto";
import path from "path";
import { DATA_DIR } from "../config/paths";
import { sqlite } from "../db";
import { runMigrations } from "../db/migrate";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { disablePeersAfterRestore, invalidateInFlightSyncs } from "./federation/peerService";
import { suspendUsableFederationTokens } from "./federation/tokenService";
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
 * Runs once a replaced database is migrated. A backup can bring back
 * federation tokens revoked after it was taken, so every usable token waits
 * for owner confirmation; restored peer bindings likewise wait for the owner
 * and a fresh sync before serving anything. (The callers' finally blocks move
 * the list revision, which the federation export revision follows.)
 */
function afterDatabaseReplaced(): void {
  const suspended = suspendUsableFederationTokens();
  if (suspended > 0) {
    logger.warn(
      `Suspended ${suspended} federation token(s) restored with the database; confirm them in federation settings to resume.`
    );
  }
  const disabledPeers = disablePeersAfterRestore();
  if (disabledPeers > 0) {
    logger.warn(
      `Disabled ${disabledPeers} federation peer(s) restored with the database; re-enable them to sync again.`
    );
  }
}

/**
 * Put the backup taken before an import or restore back in place after the
 * operation failed, so a half-applied file (possibly carrying restored
 * federation credentials that were never suspended) does not stay live. Best
 * effort: a failed rollback is logged and the caller rethrows the original
 * error.
 */
function rollBackToBackup(backupPath: string, operation: "import" | "restore"): void {
  if (!pathExistsSafeSync(backupPath, DATA_DIR)) return;
  try {
    const resolvedBackupPath = path.resolve(backupPath);
    if (!isPathWithinDirectory(resolvedBackupPath, RESOLVED_DATA_DIR)) {
      throw new ValidationError("Invalid backup file path", "file");
    }
    invalidateInFlightSyncs();
    copyFileSafeSync(resolvedBackupPath, DATA_DIR, RESOLVED_DB_PATH, DATA_DIR);
    // The failure may have happened after the connection was reopened on the
    // replaced file, so point it back at the rolled-back database.
    reinitializeDatabase();
    logger.info(`Restored database from backup after failed ${operation}`);
  } catch (restoreError) {
    logger.error("Failed to restore database from backup:", restoreError);
  }
}

/**
 * Export database as backup file
 * Returns an immutable SQLite snapshot. The caller owns cleanup after transfer.
 */
export async function exportDatabase(): Promise<string> {
  if (!pathExistsSafeSync(dbPath, DATA_DIR)) {
    throw new NotFoundError("Database file", "mytube.db");
  }
  const snapshotPath = resolveSafePath(
    path.join(DATA_DIR, `export-${crypto.randomUUID()}.db.tmp`),
    DATA_DIR
  );
  try {
    await sqlite.backup(snapshotPath);
    return snapshotPath;
  } catch (error) {
    cleanupTempImportFile(snapshotPath);
    throw error;
  }
}

export function cleanupDatabaseExport(snapshotPath: string): void {
  // Never let a cleanup mistake target mytube.db or a saved restore backup.
  if (!/^export-[0-9a-f-]+\.db\.tmp$/i.test(path.basename(snapshotPath))) {
    throw new ValidationError("Invalid database export path", "file");
  }
  cleanupTempImportFile(snapshotPath);
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
    // Nothing a federation sync read from the old file may land in the new one.
    invalidateInFlightSyncs();
    // Close the current database connection before replacing the file
    sqlite.close();
    logger.info("Closed current database connection for import");

    // Simply copy the uploaded file to replace the database
    copyFileSafeSync(tempImportPath, DATA_DIR, RESOLVED_DB_PATH, DATA_DIR);
    logger.info(`Database file replaced successfully`);

    // Reinitialize the database connection with the new file
    reinitializeDatabase();

    // The imported file is live from here, and migrations yield: requests
    // holding the old list ETag must not get a 304 meanwhile. The finally
    // bumps again once migrations end, for anyone who listed mid-migration.
    bumpVideosListRevision();

    // Bring the imported database up to the current schema. An older backup
    // may predate recent migrations; running them (rather than an ad-hoc table
    // self-heal) also records Drizzle's migration journal, so the next startup
    // does not re-run an already-applied migration and crash on "table already
    // exists". Skip the legacy JSON data migration so stale on-disk files do
    // not overwrite the just-imported backup.
    await runMigrations({ skipLegacyDataMigration: true });

    // Inside the try: if this fails, the import rolls back rather than
    // leaving restored credentials usable.
    afterDatabaseReplaced();
  } catch (error: unknown) {
    rollBackToBackup(backupPath, "import");

    // Log the actual error for debugging
    logger.error(
      "Database import failed:",
      error instanceof Error ? error : new Error(String(error))
    );

    throw error;
  } finally {
    // Whatever happened (imported, rolled back, or a rollback that failed),
    // the live database may no longer be the library clients last listed, and
    // requests may have read the imported file while migrations ran. Bump last
    // so no client keeps getting a 304 for an earlier library.
    bumpVideosListRevision();
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

    // Merged videos are inserted directly, bypassing videoMutations' bump.
    if (summary.videos.merged > 0 || summary.authorProfiles.merged > 0) {
      bumpVideosListRevision();
    }
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
  const preRestoreBackupPath = createBackup();

  // From the copy on, the restored file may be live even if a later step
  // fails (a reconnect can reopen it on the next request), so every path
  // through here bumps; see importDatabase.
  try {
    // Nothing a federation sync read from the old file may land in the new one.
    invalidateInFlightSyncs();
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

    // Live from here; migrations yield, so invalidate the old ETag now too.
    bumpVideosListRevision();

    // Migrate the restored database to the current schema and record Drizzle's
    // migration journal, so an older backup does not leave later migrations
    // unapplied (and does not crash a subsequent startup re-running them). Skip
    // the legacy JSON data migration so stale on-disk files do not overwrite the
    // just-restored backup.
    await runMigrations({ skipLegacyDataMigration: true });

    // Inside the try, as for import: if this fails, the restore rolls back
    // rather than leaving restored credentials usable.
    afterDatabaseReplaced();
  } catch (error: unknown) {
    rollBackToBackup(preRestoreBackupPath, "restore");
    throw error;
  } finally {
    bumpVideosListRevision();
  }
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
