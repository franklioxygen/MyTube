import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import { DATA_DIR } from "../../config/paths";
import { reinitializeDatabase as reinitDb, sqlite } from "../../db";
import { ValidationError } from "../../errors/DownloadErrors";
import {
  ensureFavoritesTables,
  ensureVisitorUsersTable,
} from "../storageService/migrations/schemaMigrations";
import { invalidateUserCache } from "../userService";
import { generateTimestamp } from "../../utils/helpers";
import { logger } from "../../utils/logger";
import {
  copyFileSafeSync,
  isPathWithinDirectory,
  pathExistsSafeSync,
  readdirSafeSync,
  resolveSafePath,
  statSafeSync,
  unlinkSafeSync,
  writeFileSafeSync,
} from "../../utils/security";
import {
  backupPattern,
  dbPath,
  RESOLVED_DATA_DIR,
  RESOLVED_DB_PATH,
} from "./constants";

/**
 * Validate that a file is a valid SQLite database
 */
export function validateDatabase(filePath: string): void {
  let sourceDb: Database.Database | null = null;
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

export function prepareTempImportFile(fileBuffer: Buffer): string {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new ValidationError("Invalid uploaded database file", "file");
  }

  const tempFilename = `import-${Date.now()}-${crypto
    .randomBytes(8)
    .toString("hex")}.db.tmp`;
  const tempImportPath = resolveSafePath(
    path.join(DATA_DIR, tempFilename),
    DATA_DIR
  );
  const isSafeDbPath = isPathWithinDirectory(RESOLVED_DB_PATH, RESOLVED_DATA_DIR);
  if (!isSafeDbPath) {
    throw new ValidationError("Invalid database path", "file");
  }

  writeFileSafeSync(tempImportPath, DATA_DIR, fileBuffer);
  validateDatabase(tempImportPath);
  return tempImportPath;
}

export function cleanupTempImportFile(tempImportPath: string): void {
  if (pathExistsSafeSync(tempImportPath, DATA_DIR)) {
    try {
      unlinkSafeSync(tempImportPath, DATA_DIR);
    } catch (error) {
      logger.error("Error cleaning up temp file:", error);
    }
  }
}

/**
 * Get all backup files with their metadata
 */
export function getBackupFiles(): Array<{
  filename: string;
  timestamp: string;
  mtime: number;
  filePath: string;
}> {
  const files = readdirSafeSync(DATA_DIR, DATA_DIR);
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
      const filePath = resolveSafePath(path.join(DATA_DIR, file), DATA_DIR);
      const stats = statSafeSync(filePath, DATA_DIR);
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
export function createBackup(): string {
  const backupFilename = `mytube-backup-${generateTimestamp()}.db.backup`;
  const backupPath = resolveSafePath(path.join(DATA_DIR, backupFilename), DATA_DIR);
  const resolvedBackupPath = path.resolve(backupPath);
  const isSafeBackupPath = isPathWithinDirectory(
    resolvedBackupPath,
    RESOLVED_DATA_DIR,
  );
  if (!isSafeBackupPath) {
    throw new ValidationError("Invalid backup file path", "file");
  }

  if (pathExistsSafeSync(dbPath, DATA_DIR)) {
    copyFileSafeSync(
      RESOLVED_DB_PATH,
      DATA_DIR,
      resolvedBackupPath,
      DATA_DIR,
    );
    logger.info(`Created backup of current database at ${resolvedBackupPath}`);
  }

  return resolvedBackupPath;
}

/**
 * Close database connection and reinitialize it
 */
export function reinitializeDatabase(): void {
  sqlite.close();
  logger.info("Closed current database connection");
  reinitDb();
  invalidateUserCache();
  // A replaced/restored database may predate later migrations (e.g. a backup
  // taken before the visitor users or favorites tables existed). Import/restore
  // does not run runMigrations(), so apply the same idempotent self-heals here
  // to keep those endpoints from 500-ing until the next server restart.
  ensureVisitorUsersTable();
  ensureFavoritesTables();
  logger.info("Database connection reinitialized");
}
