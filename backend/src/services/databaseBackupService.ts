import Database from "better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { DATA_DIR } from "../config/paths";
import { reinitializeDatabase as reinitDb, sqlite } from "../db";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { generateTimestamp } from "../utils/helpers";
import { logger } from "../utils/logger";
const dbPath = path.join(DATA_DIR, "mytube.db");
const backupPattern = /^mytube-backup-(.+)\.db\.backup$/;

/**
 * Validate that a file is a valid SQLite database
 */
function validateDatabase(filePath: string): void {
  let sourceDb: any = null;
  try {
    sourceDb = new Database(filePath, { readonly: true });
    // Try to query the database to verify it's valid
    sourceDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")
      .get();
    sourceDb.close();
  } catch (validationError) {
    if (sourceDb) {
      sourceDb.close();
    }
    throw new ValidationError(
      "Invalid database file. The file is not a valid SQLite database.",
      "file"
    );
  }
}

/**
 * Get all backup files with their metadata
 */
function getBackupFiles(): Array<{
  filename: string;
  timestamp: string;
  mtime: number;
  filePath: string;
}> {
  const files = fs.readdirSync(DATA_DIR);
  const backupFiles: Array<{
    filename: string;
    timestamp: string;
    mtime: number;
    filePath: string;
  }> = [];

  for (const file of files) {
    const match = file.match(backupPattern);
    if (match) {
      const timestamp = match[1];
      const filePath = path.join(DATA_DIR, file);
      const stats = fs.statSync(filePath);
      backupFiles.push({
        filename: file,
        timestamp,
        mtime: stats.mtimeMs,
        filePath,
      });
    }
  }

  // Sort by modification time (most recent first)
  backupFiles.sort((a, b) => b.mtime - a.mtime);
  return backupFiles;
}

/**
 * Create a backup of the current database
 */
function createBackup(): string {
  const backupFilename = `mytube-backup-${generateTimestamp()}.db.backup`;
  const backupPath = path.join(DATA_DIR, backupFilename);

  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, backupPath);
    logger.info(`Created backup of current database at ${backupPath}`);
  }

  return backupPath;
}

/**
 * Close database connection and reinitialize it
 */
function reinitializeDatabase(): void {
  sqlite.close();
  logger.info("Closed current database connection");
  reinitDb();
  logger.info("Database connection reinitialized");
}

/**
 * Export database as backup file
 * Returns the path to the database file
 */
export function exportDatabase(): string {
  if (!fs.existsSync(dbPath)) {
    throw new NotFoundError("Database file", "mytube.db");
  }
  return dbPath;
}

/**
 * Import database from backup file
 * @param tempFilePath - Path to the temporary uploaded file
 */
export function importDatabase(tempFilePath: string): void {
  // Validate the uploaded file is a valid SQLite database
  validateDatabase(tempFilePath);

  // Create backup of current database before import
  const backupPath = createBackup();

  try {
    // Close the current database connection before replacing the file
    sqlite.close();
    logger.info("Closed current database connection for import");

    // Simply copy the uploaded file to replace the database
    fs.copyFileSync(tempFilePath, dbPath);
    logger.info(`Database file replaced successfully`);

    // Reinitialize the database connection with the new file
    reinitializeDatabase();

    // Clean up uploaded temp file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  } catch (error: any) {
    // Restore backup if import failed
    if (fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, dbPath);
        logger.info("Restored database from backup after failed import");
      } catch (restoreError) {
        logger.error("Failed to restore database from backup:", restoreError);
      }
    }

    // Clean up uploaded temp file if it exists
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        logger.error("Error cleaning up temp file:", e);
      }
    }

    // Log the actual error for debugging
    logger.error(
      "Database import failed:",
      error instanceof Error ? error : new Error(String(error))
    );

    throw error;
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
export function restoreFromLastBackup(): void {
  const backupFiles = getBackupFiles();

  if (backupFiles.length === 0) {
    throw new NotFoundError(
      "Backup database file",
      "mytube-backup-*.db.backup"
    );
  }

  const lastBackup = backupFiles[0];
  const backupPath = lastBackup.filePath;

  // Validate the backup file is a valid SQLite database
  validateDatabase(backupPath);

  // Create backup of current database before restore
  createBackup();

  // Close the current database connection before replacing the file
  sqlite.close();
  logger.info("Closed current database connection for restore");

  // Copy the backup file to replace the database
  fs.copyFileSync(backupPath, dbPath);
  logger.info(
    `Database file restored successfully from ${lastBackup.filename}`
  );

  // Reinitialize the database connection with the restored file
  reinitializeDatabase();
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
    const files = fs.readdirSync(DATA_DIR);

    for (const file of files) {
      if (backupPattern.test(file)) {
        const filePath = path.join(DATA_DIR, file);
        try {
          fs.unlinkSync(filePath);
          deletedCount++;
          logger.info(`Deleted backup database file: ${file}`);
        } catch (error: any) {
          failedCount++;
          const errorMsg = `Failed to delete ${file}: ${error.message}`;
          errors.push(errorMsg);
          logger.error(errorMsg);
        }
      }
    }
  } catch (error: any) {
    logger.error("Error cleaning up backup databases:", error);
    throw error;
  }

  return {
    deleted: deletedCount,
    failed: failedCount,
    errors,
  };
}
