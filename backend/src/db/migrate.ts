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

export async function runMigrations() {
  try {
    console.log("Running database migrations...");

    // For network filesystems (NFS/SMB), add a small delay to ensure
    // the database file is fully accessible before attempting migration
    // This helps prevent "database is locked" errors on first deployment
    const dbPath = path.join(ROOT_DIR, "data", DB_FILENAME);
    if (!pathExistsSafeSync(dbPath, DATA_DIR)) {
      console.log(
        "Database file does not exist yet, waiting for file system sync..."
      );
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay
    }

    ensureDatabaseWritable(dbPath);

    // In production/docker, the drizzle folder is copied to the root or src/drizzle
    // We need to find where it is.
    // Based on Dockerfile: COPY . . -> it should be at /app/drizzle

    const migrationsFolder = path.join(ROOT_DIR, "drizzle");

    try {
      migrate(db, { migrationsFolder });
      console.log("Database migrations completed successfully.");
    } catch (migrationError: any) {
      // Handle duplicate column errors gracefully
      // This can happen if migrations were manually applied or if columns already exist
      if (
        migrationError?.cause?.code === "SQLITE_ERROR" &&
        migrationError?.cause?.message?.includes("duplicate column name")
      ) {
        console.warn(
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
      pathExistsSafeSync(VIDEOS_DATA_PATH, DATA_DIR) ||
      pathExistsSafeSync(COLLECTIONS_DATA_PATH, DATA_DIR) ||
      pathExistsSafeSync(STATUS_DATA_PATH, DATA_DIR) ||
      pathExistsSafeSync(SETTINGS_DATA_PATH, DATA_DIR);

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
