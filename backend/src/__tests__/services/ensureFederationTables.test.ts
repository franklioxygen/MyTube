import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real in-memory sqlite handed to the self-heal via the mocked db module.
const mocks = vi.hoisted(() => ({ sqlite: undefined as any }));

vi.mock("../../db", () => ({
  get sqlite() {
    return mocks.sqlite;
  },
  db: {},
}));

vi.mock("../../services/storageService/authorCollectionUtils", () => ({
  backfillLegacyCollectionOrigins: vi.fn(),
}));
vi.mock("../../services/storageService/migrations/legacyTwitchDownloads", () => ({
  deduplicateVideoDownloadsBySourceAndPlatform: vi.fn(),
  normalizeLegacyTwitchDownloads: vi.fn(),
}));
vi.mock("../../services/storageService/migrations/dataBackfill", () => ({
  backfillDownloadHistoryMediaTypes: vi.fn(),
  backfillDownloadHistoryVideoIds: vi.fn(),
  populateVideoFileSizes: vi.fn(),
}));

const MIGRATIONS = [
  "0032_federation_identity_tokens.sql",
  "0033_federation_peers.sql",
].map((name) => path.resolve(__dirname, "../../../drizzle", name));
const TABLES = [
  "federation_instance",
  "federation_tokens",
  "federation_peers",
  "federation_remote_videos",
] as const;

const describeTable = (sqlite: Database.Database, table: string) =>
  sqlite.prepare(`PRAGMA table_info(${table})`).all();

const tableSql = (sqlite: Database.Database, table: string): string =>
  (
    sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string } | undefined
  )?.sql ?? "";

const describeIndexes = (sqlite: Database.Database, table: string) =>
  (sqlite.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number }>)
    .filter((index) => !index.name.startsWith("sqlite_autoindex"))
    .map((index) => ({
      name: index.name,
      unique: index.unique,
      columns: sqlite.prepare(`PRAGMA index_info(${index.name})`).all(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

const describeForeignKeys = (sqlite: Database.Database, table: string) =>
  sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all();

const checkNames = (sql: string): string[] =>
  [...sql.matchAll(/CONSTRAINT\s+"([^"]+)"\s+CHECK/g)].map((match) => match[1]).sort();

/**
 * drizzle's migrate() aborts the rest of its batch at the first failing
 * statement, so migration 0032 can be skipped on an install whose earlier
 * columns were self-healed. The self-heal must then build the same tables.
 */
describe("ensureFederationTables (migrations 0032-0033 self-heal)", () => {
  let migrated: Database.Database;
  let healed: Database.Database;
  let ensureFederationTables: typeof import("../../services/storageService/migrations/schemaMigrations").ensureFederationTables;

  beforeAll(async () => {
    migrated = new Database(":memory:");
    for (const migration of MIGRATIONS) {
      for (const statement of fs.readFileSync(migration, "utf8").split("--> statement-breakpoint")) {
        migrated.exec(statement);
      }
    }

    healed = new Database(":memory:");
    mocks.sqlite = healed;
    ({ ensureFederationTables } = await import(
      "../../services/storageService/migrations/schemaMigrations"
    ));
  });

  afterAll(() => {
    migrated.close();
    healed.close();
  });

  it("creates both tables and is idempotent", () => {
    ensureFederationTables();
    ensureFederationTables();

    for (const table of TABLES) {
      expect(tableSql(healed, table), table).not.toBe("");
    }
  });

  it.each(TABLES)("matches the migrations' columns, checks, indexes and keys for %s", (table) => {
    ensureFederationTables();

    expect(describeTable(healed, table)).toEqual(describeTable(migrated, table));
    expect(checkNames(tableSql(healed, table))).toEqual(checkNames(tableSql(migrated, table)));
    expect(describeIndexes(healed, table)).toEqual(describeIndexes(migrated, table));
    expect(describeForeignKeys(healed, table)).toEqual(describeForeignKeys(migrated, table));
  });

  it("enforces the migration's constraints", () => {
    ensureFederationTables();

    expect(() =>
      healed
        .prepare("INSERT INTO federation_instance (id, instance_id, created_at) VALUES (2, 'x', 0)")
        .run()
    ).toThrow(/CHECK constraint/);
    expect(() =>
      healed
        .prepare(
          `INSERT INTO federation_tokens
             (id, secret_hash, scopes, visibility_ceiling, policy_revision, created_at, updated_at)
           VALUES ('t', 'h', '[]', 'everyone', 'r', 0, 0)`
        )
        .run()
    ).toThrow(/CHECK constraint/);
  });
});
