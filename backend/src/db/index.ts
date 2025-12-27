import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { DATA_DIR } from "../config/paths";
import * as schema from "./schema";

// Ensure data directory exists
fs.ensureDirSync(DATA_DIR);

const dbPath = path.join(DATA_DIR, "mytube.db");

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
  db.pragma("busy_timeout = 5000");

  // Enable foreign keys
  db.pragma("foreign_keys = ON");
}

// Create database connection with getters that auto-reopen if closed
let sqliteInstance: Database.Database = new Database(dbPath);
configureDatabase(sqliteInstance);
let dbInstance = drizzle(sqliteInstance, { schema });

// Helper to ensure connection is open
function ensureConnection(): void {
  if (!sqliteInstance.open) {
    sqliteInstance = new Database(dbPath);
    configureDatabase(sqliteInstance);
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
  sqliteInstance = new Database(dbPath);
  configureDatabase(sqliteInstance);
  dbInstance = drizzle(sqliteInstance, { schema });
}
