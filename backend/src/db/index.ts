import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { DATA_DIR } from "../config/paths";
import * as schema from "./schema";

// Ensure data directory exists
fs.ensureDirSync(DATA_DIR);

const dbPath = path.join(DATA_DIR, "mytube.db");

// Create database connection with getters that auto-reopen if closed
let sqliteInstance: Database.Database = new Database(dbPath);
let dbInstance = drizzle(sqliteInstance, { schema });

// Helper to ensure connection is open
function ensureConnection(): void {
  if (!sqliteInstance.open) {
    sqliteInstance = new Database(dbPath);
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
  dbInstance = drizzle(sqliteInstance, { schema });
}
