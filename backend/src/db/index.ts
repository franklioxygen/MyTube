import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { DATA_DIR } from "../config/paths";
import * as schema from "./schema";

// Ensure data directory exists
fs.ensureDirSync(DATA_DIR);

const dbPath = path.join(DATA_DIR, "mytube.db");
const DB_RETRY_BASE_DELAY_MS = 250;
const DB_RETRY_BACKOFF_MULTIPLIER = 2;

function sleepWithoutBusySpin(delayMs: number): void {
  if (delayMs <= 0) {
    return;
  }

  // better-sqlite3 connection opening is synchronous; use Atomics.wait to avoid CPU busy-spin.
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, delayMs);
}

/**
 * Configure SQLite database for compatibility with NTFS and other FUSE-based filesystems
 * This is critical for environments like iStoreOS/OpenWrt where data may be on NTFS partitions
 *
 * @param db - The SQLite database instance to configure
 */
export function configureDatabase(db: Database.Database): void {
  // Disable WAL mode - NTFS/FUSE doesn't support atomic operations required by WAL
  // Use DELETE journal mode instead, which is more compatible with FUSE filesystems
  db.pragma("journal_mode = DELETE");

  // Set synchronous mode to NORMAL for better performance while maintaining data integrity
  // FULL is safer but slower, NORMAL is a good balance for most use cases
  db.pragma("synchronous = NORMAL");

  // Set busy timeout to handle concurrent access better
  // Increased to 30 seconds for network filesystems (NFS/SMB) which may have higher latency
  db.pragma("busy_timeout = 30000");

  // Enable foreign keys
  db.pragma("foreign_keys = ON");
}

/**
 * Create database connection with retry logic for network filesystems
 * This helps handle cases where the database file is on NFS/SMB mounts
 */
function createDatabaseConnection(
  retries = 3
): Database.Database {
  let lastError: unknown;
  let delayMs = DB_RETRY_BASE_DELAY_MS;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Ensure the database file exists (better-sqlite3 will create it if it doesn't exist)
      // But we need to ensure the directory is accessible first
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (!fs.existsSync(dbPath)) {
        // Touch the file to ensure it exists before opening
        fs.ensureFileSync(dbPath);
      }

      const db = new Database(dbPath);
      configureDatabase(db);
      return db;
    } catch (error: any) {
      if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED") {
        if (attempt < retries) {
          console.warn(
            `Database connection attempt ${attempt} failed (${error.code}), retrying in ${delayMs}ms...`
          );
          lastError = error;
          sleepWithoutBusySpin(delayMs);
          delayMs *= DB_RETRY_BACKOFF_MULTIPLIER;
          continue;
        }
      }
      // If it's not a busy/locked error, or we've exhausted retries, throw
      throw error;
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Failed to create database connection after retries");
}

// Create database connection with getters that auto-reopen if closed
let sqliteInstance: Database.Database = createDatabaseConnection();
let dbInstance = drizzle(sqliteInstance, { schema });

// Helper to ensure connection is open
function ensureConnection(): void {
  if (!sqliteInstance.open) {
    sqliteInstance = createDatabaseConnection();
    dbInstance = drizzle(sqliteInstance, { schema });
  }
}

// Export sqlite with auto-reconnect
// Using an empty object as target so we always use the current sqliteInstance
export const sqlite = new Proxy({} as Database.Database, {
  get(_target, prop) {
    ensureConnection();
    return (sqliteInstance as any)[prop];
  },
  set(_target, prop, value) {
    ensureConnection();
    (sqliteInstance as any)[prop] = value;
    return true;
  },
});

// Export db with auto-reconnect
// Using an empty object as target so we always use the current dbInstance
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    ensureConnection();
    return (dbInstance as any)[prop];
  },
});

// Function to reinitialize the database connection
export function reinitializeDatabase(): void {
  if (sqliteInstance.open) {
    sqliteInstance.close();
  }
  sqliteInstance = createDatabaseConnection();
  dbInstance = drizzle(sqliteInstance, { schema });
}
