import { constants as fsConstants } from "fs";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { DATA_DIR, ROOT_DIR } from "../config/paths";
import { MigrationError } from "../errors/DownloadErrors";
import {
  accessTrustedSync,
  pathExistsSafeSync,
  pathExistsTrustedSync,
  statTrustedSync,
  unlinkTrustedSync,
  writeFileSafeSync,
} from "../utils/security";
import { configureDatabase, db, sqlite } from "./index";
import { logger } from "../utils/logger";

const DB_FILENAME = "mytube.db";

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getCurrentIdentity(): { uid?: number; gid?: number } {
  return {
    uid: typeof process.getuid === "function" ? process.getuid() : undefined,
    gid: typeof process.getgid === "function" ? process.getgid() : undefined,
  };
}

function getTargetOwnershipSummary(targetPath: string): string | null {
  try {
    const stats = statTrustedSync(targetPath);
    const mode = (stats.mode & 0o777).toString(8).padStart(3, "0");
    return `owner uid/gid ${stats.uid}/${stats.gid}, mode ${mode}`;
  } catch {
    return null;
  }
}

function buildPermissionFixHint(): string {
  const { uid, gid } = getCurrentIdentity();

  if (typeof uid === "number" && typeof gid === "number") {
    return `If this is a Docker bind mount, fix the host-side permissions, for example: chown -R ${uid}:${gid} /path/to/mytube/data /path/to/mytube/uploads.`;
  }

  return "Ensure the data directory and database file are writable by the user running MyTube.";
}

function getCauseMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const msg = (cause as { message?: unknown }).message;
    return typeof msg === "string" && msg.length > 0 ? msg : undefined;
  }
  return undefined;
}

function buildReadonlyDatabaseMessage(
  targetPath: string,
  description: string,
  originalError?: Error
): string {
  const { uid, gid } = getCurrentIdentity();
  const identity =
    typeof uid === "number" && typeof gid === "number"
      ? `uid/gid ${uid}/${gid}`
      : "the current process user";
  const ownership = getTargetOwnershipSummary(targetPath);
  const ownershipText = ownership ? ` Current ${description} ${ownership}.` : "";
  const causeMessage = getCauseMessage(originalError);
  const errorMessages = [originalError?.message, causeMessage].filter(
    (value, index, array): value is string =>
      typeof value === "string" && value.length > 0 && array.indexOf(value) === index
  );
  const errorText =
    errorMessages.length > 0
      ? ` Underlying error: ${errorMessages.join(" | ")}.`
      : "";

  return `${description} is not writable: ${targetPath}. MyTube is running as ${identity} and cannot update the SQLite database.${ownershipText} ${buildPermissionFixHint()}${errorText}`.trim();
}

function ensureDatabaseWritable(dbPath: string): void {
  const probePath = path.join(DATA_DIR, `.mytube-write-probe-${process.pid}`);

  try {
    writeFileSafeSync(probePath, DATA_DIR, "");
  } catch (error) {
    throw new MigrationError(
      buildReadonlyDatabaseMessage(
        DATA_DIR,
        "Data directory",
        normalizeError(error)
      ),
      "database_write_preflight",
      normalizeError(error)
    );
  } finally {
    try {
      if (pathExistsSafeSync(probePath, DATA_DIR)) {
        unlinkTrustedSync(probePath);
      }
    } catch {
      // Best effort cleanup for the write probe.
    }
  }

  if (!pathExistsSafeSync(dbPath, DATA_DIR)) {
    return;
  }

  try {
    accessTrustedSync(dbPath, fsConstants.R_OK | fsConstants.W_OK);
  } catch (error) {
    throw new MigrationError(
      buildReadonlyDatabaseMessage(
        dbPath,
        "Database file",
        normalizeError(error)
      ),
      "database_write_preflight",
      normalizeError(error)
    );
  }
}

const DEFAULT_DATA_DIR = path.join(ROOT_DIR, "data");
const DATA_DIR_ENV_VAR = "MYTUBE_BACKEND_DATA_DIR";
const LEGACY_DATA_DIR_ENV_VAR = "MYTUBE_DATA_DIR";

/**
 * True when the database this process opened has no tables of its own, which
 * is what an install looks like the instant before its first migration - and
 * also what a database opened at the wrong path looks like, because
 * db/index.ts creates the file as soon as it is imported.
 *
 * An unreadable answer is not an empty one: say "not empty" so a database that
 * cannot be inspected is never mistaken for a misdirected one and blocked.
 */
function databaseHasNoTables(): boolean {
  try {
    const row = sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      )
      .get() as { count?: number } | undefined;

    return row?.count === 0;
  } catch {
    return false;
  }
}

function holdsADatabase(directory: string): boolean {
  try {
    const candidate = path.join(directory, DB_FILENAME);
    // Size, not mere existence: db/index.ts touches the file before opening it,
    // so an abandoned data directory keeps a zero-byte mytube.db forever.
    return pathExistsTrustedSync(candidate) && statTrustedSync(candidate).size > 0;
  } catch {
    return false;
  }
}

/**
 * Refuse to start on an empty data directory when a populated database sits at
 * a directory this deployment plausibly meant instead.
 *
 * Opening a new database is right for a first install and looks right
 * everywhere else: the migrations run cleanly and the server reports a healthy
 * start. But a fresh database carries default settings, `loginEnabled` defaults
 * to false, and isLoginRequired() is the first thing every route guard asks -
 * so the instance comes up unauthenticated on an empty library while the real
 * database sits untouched one directory away. Silence is the whole danger, so
 * name the directory that does hold a database and stop.
 */
function ensureDataDirIsNotMisdirected(): void {
  if (!databaseHasNoTables()) {
    return;
  }

  const legacyValue = process.env[LEGACY_DATA_DIR_ENV_VAR];
  const candidates: Array<{ directory: string; explanation: string }> = [];

  if (typeof legacyValue === "string" && legacyValue.length > 0) {
    candidates.push({
      directory: path.resolve(legacyValue),
      explanation: `${LEGACY_DATA_DIR_ENV_VAR} is set to "${legacyValue}". That name is the host side of the Docker bind mount and is no longer read here; the backend override is ${DATA_DIR_ENV_VAR}.`,
    });
  }

  candidates.push({
    directory: DEFAULT_DATA_DIR,
    explanation: `${DATA_DIR_ENV_VAR} moved the data directory away from the default.`,
  });

  for (const candidate of candidates) {
    if (candidate.directory === DATA_DIR || !holdsADatabase(candidate.directory)) {
      continue;
    }

    throw new MigrationError(
      `Refusing to start: ${DATA_DIR} holds no database, but ${path.join(candidate.directory, DB_FILENAME)} does. ${candidate.explanation} Starting here would create an empty database, and a new database has login protection off - this instance would come up unauthenticated with an empty library. Point ${DATA_DIR_ENV_VAR} at the directory holding your database, or move that database aside if starting empty here is what you intended.`,
      "data_dir_misdirected"
    );
  }
}

function isReadonlySqliteError(error: unknown): boolean {
  const candidate = error as
    | {
        code?: string;
        message?: string;
        cause?: { code?: string; message?: string };
      }
    | undefined;

  return (
    candidate?.code === "SQLITE_READONLY" ||
    candidate?.cause?.code === "SQLITE_READONLY" ||
    candidate?.message?.includes("readonly database") === true ||
    candidate?.cause?.message?.includes("readonly database") === true
  );
}

export interface RunMigrationsOptions {
  /**
   * Skip the legacy JSON → SQLite data migration (videos.json, collections.json,
   * settings.json, status.json). Used when replacing the database via
   * import/restore: those flows must migrate the uploaded database's schema
   * without re-inserting stale on-disk JSON data over the imported contents.
   */
  skipLegacyDataMigration?: boolean;
}

export async function runMigrations(options: RunMigrationsOptions = {}) {
  try {
    logger.info("Running database migrations...");

    // For network filesystems (NFS/SMB), add a small delay to ensure
    // the database file is fully accessible before attempting migration
    // This helps prevent "database is locked" errors on first deployment
    // Must come from DATA_DIR, not a second guess at it. Every check below
    // validates against DATA_DIR, so rebuilding the path from ROOT_DIR made the
    // two disagree the moment MYTUBE_BACKEND_DATA_DIR moved the data directory
    // - the traversal guard then aborted migrations and left a database with no
    // tables at all.
    const dbPath = path.join(DATA_DIR, DB_FILENAME);
    if (!pathExistsSafeSync(dbPath, DATA_DIR)) {
      logger.info(
        "Database file does not exist yet, waiting for file system sync..."
      );
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay
    }

    ensureDatabaseWritable(dbPath);

    // Before migrate(), which would fill the database in and make an empty one
    // indistinguishable from a healthy one.
    ensureDataDirIsNotMisdirected();

    // In production/docker, the drizzle folder is copied to the root or src/drizzle
    // We need to find where it is.
    // Based on Dockerfile: COPY . . -> it should be at /app/drizzle

    const migrationsFolder = path.join(ROOT_DIR, "drizzle");

    try {
      migrate(db, { migrationsFolder });
      logger.info("Database migrations completed successfully.");
    } catch (migrationError: unknown) {
      const cause = (migrationError as { cause?: { code?: string; message?: string } })
        ?.cause;
      // Handle duplicate column errors gracefully
      // This can happen if migrations were manually applied or if columns already exist
      if (
        cause?.code === "SQLITE_ERROR" &&
        cause?.message?.includes("duplicate column name")
      ) {
        logger.warn(
          "Migration encountered duplicate column (may have been applied manually).",
          "Columns will be verified by initialization.ts"
        );
        // Don't throw - let initialization.ts handle missing columns
      } else if (isReadonlySqliteError(migrationError)) {
        throw new MigrationError(
          buildReadonlyDatabaseMessage(
            dbPath,
            "SQLite database",
            normalizeError(migrationError)
          ),
          "drizzle_migrate",
          normalizeError(migrationError)
        );
      } else {
        // Re-throw other migration errors
        throw migrationError;
      }
    }

    // Re-apply database configuration after migration
    // This ensures journal_mode is set to DELETE even if migration changed it
    // or if the database file already existed with WAL mode
    // This is critical for NTFS/FUSE filesystem compatibility
    configureDatabase(sqlite);
    logger.info("Database configuration applied (NTFS/FUSE compatible mode).");

    // Check for legacy data files and run data migration if found. Skipped for
    // database import/restore: re-inserting on-disk JSON there would overwrite
    // the just-uploaded backup with stale data.
    if (options.skipLegacyDataMigration) {
      logger.info(
        "Skipping legacy JSON data migration (database replacement)."
      );
    } else {
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
        pathExistsSafeSync(VIDEOS_DATA_PATH, DATA_DIR) ||
        pathExistsSafeSync(COLLECTIONS_DATA_PATH, DATA_DIR) ||
        pathExistsSafeSync(STATUS_DATA_PATH, DATA_DIR) ||
        pathExistsSafeSync(SETTINGS_DATA_PATH, DATA_DIR);

      if (hasLegacyData) {
        logger.info("Legacy data files found. Running data migration...");
        await runDataMigration();
      } else {
        logger.info("No legacy data files found. Skipping data migration.");
      }
    }

    // Guarantee the visitor `users` table exists before the legacy-password
    // migration (and every subsequent request) touches it. Drizzle may have
    // aborted its batch on a swallowed duplicate-column error above, never
    // reaching the 0019 CREATE TABLE users; this idempotent self-heal covers
    // that case so migrateLegacySharedVisitorPassword succeeds on first boot
    // instead of failing with "no such table: users".
    const {
      ensureVisitorUsersTable,
      ensureFavoritesTables,
      ensureGestureCredentialTable,
    } = await import(
      "../services/storageService/migrations/schemaMigrations"
    );
    ensureVisitorUsersTable();

    // Same self-heal for the favorites tables (migration 0021): if drizzle
    // aborted its batch above, favorite_collections / favorite_authors were
    // never created, and every /favorites request would 500 with
    // "no such table". Idempotent CREATE TABLE IF NOT EXISTS covers that.
    ensureFavoritesTables();

    // Same self-heal for migration 0028's admin_gesture_credential: a new
    // table cannot be recovered by the column checks above, so without this a
    // skipped batch leaves every Gesture Login endpoint failing with
    // "no such table" on a server that reported a clean start.
    ensureGestureCredentialTable();

    const { migrateLegacySharedVisitorPassword } = await import(
      "../services/userService"
    );
    await migrateLegacySharedVisitorPassword();
  } catch (error) {
    logger.error("Error running database migrations:", error);
    // Don't throw, as we might want the app to start even if migration fails (though it might be broken)
    // But for initial setup, it's critical.
    throw error;
    // logger.warn("Migration failed but continuing server startup...");
  }
}
