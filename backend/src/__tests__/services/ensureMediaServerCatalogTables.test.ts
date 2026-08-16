import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the production failure reported on a long-lived NAS
 * database (issue #411):
 *
 *   [WARN]  Migration encountered duplicate column (may have been applied manually)
 *   [ERROR] Error getting collections: no such column: collections.description
 *
 * drizzle runs each migration file in ONE transaction. On an old database an
 * earlier migration can still fail with a duplicate column that the runtime
 * self-heal had already added; migrate.ts swallows that error, so every LATER
 * migration — including 0028, which creates the media-server catalog — silently
 * never runs. The self-heal below has to be able to repair that state.
 */

const testDb = vi.hoisted(() => {
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  return { sqlite: new Database(":memory:") };
});

vi.mock("../../db", () => ({ sqlite: testDb.sqlite }));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { ensureMediaServerCatalogTables } from "../../services/storageService/migrations/schemaMigrations";

function columnNames(table: string): string[] {
  return (
    testDb.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>
  ).map((column) => column.name);
}

function tableExists(name: string): boolean {
  return Boolean(
    testDb.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(name)
  );
}

/** A pre-0028 database: collections exists, the catalog tables do not. */
function seedLegacySchema(): void {
  testDb.sqlite.exec(`
    DROP TABLE IF EXISTS media_server_export_artifacts;
    DROP TABLE IF EXISTS media_server_episode_assignments;
    DROP TABLE IF EXISTS media_server_shows;
    DROP TABLE IF EXISTS collection_videos;
    DROP TABLE IF EXISTS collections;
    DROP TABLE IF EXISTS videos;

    CREATE TABLE videos (id TEXT PRIMARY KEY, title TEXT, created_at TEXT);
    CREATE TABLE collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL,
      origin TEXT,
      source_platform TEXT,
      source_type TEXT,
      source_mid TEXT,
      source_id TEXT
    );
  `);
}

const MEDIA_SERVER_COLLECTION_COLUMNS = [
  "description",
  "source_url",
  "source_channel_id",
  "source_channel_url",
  "source_channel_name",
  "media_server_show_id",
  "media_server_season_number",
];

describe("ensureMediaServerCatalogTables", () => {
  beforeEach(() => {
    seedLegacySchema();
  });

  it("repairs a database where migration 0028 never ran", () => {
    // Exactly the reported state.
    expect(tableExists("media_server_shows")).toBe(false);
    expect(columnNames("collections")).not.toContain("description");

    ensureMediaServerCatalogTables();

    for (const table of [
      "media_server_shows",
      "media_server_episode_assignments",
      "media_server_export_artifacts",
    ]) {
      expect(tableExists(table)).toBe(true);
    }
    for (const column of MEDIA_SERVER_COLLECTION_COLUMNS) {
      expect(columnNames("collections")).toContain(column);
    }

    // The read that was failing in production now works.
    expect(() =>
      testDb.sqlite.prepare("SELECT description FROM collections").all()
    ).not.toThrow();
  });

  it("is idempotent across repeated startups", () => {
    ensureMediaServerCatalogTables();
    const columnsAfterFirst = columnNames("collections");

    expect(() => ensureMediaServerCatalogTables()).not.toThrow();
    expect(() => ensureMediaServerCatalogTables()).not.toThrow();

    expect(columnNames("collections")).toEqual(columnsAfterFirst);
  });

  it("is a no-op when the drizzle migration already applied cleanly", () => {
    ensureMediaServerCatalogTables();
    testDb.sqlite
      .prepare(
        `INSERT INTO media_server_shows
           (id, identity_key, source_platform, title, description, directory_name,
            next_season_number, created_at, updated_at)
         VALUES ('s1', 'k', 'youtube', 'Show', '', 'Show', 1, 1, 1)`
      )
      .run();

    ensureMediaServerCatalogTables();

    // Existing catalog rows must survive a second self-heal pass.
    const { count } = testDb.sqlite
      .prepare("SELECT COUNT(*) AS count FROM media_server_shows")
      .get() as { count: number };
    expect(count).toBe(1);
  });

  it("preserves existing collection data while adding the columns", () => {
    testDb.sqlite
      .prepare(
        "INSERT INTO collections (id, name, title, created_at, source_type) VALUES ('c1', 'Mine', 'Mine', '2026-01-01', 'playlist')"
      )
      .run();

    ensureMediaServerCatalogTables();

    const row = testDb.sqlite
      .prepare("SELECT * FROM collections WHERE id = 'c1'")
      .get() as Record<string, unknown>;
    expect(row.name).toBe("Mine");
    expect(row.source_type).toBe("playlist");
    expect(row.description).toBeNull();
    expect(row.media_server_season_number).toBeNull();
  });

  it("creates the unique indexes the allocators rely on", () => {
    ensureMediaServerCatalogTables();

    testDb.sqlite
      .prepare(
        `INSERT INTO media_server_shows
           (id, identity_key, source_platform, title, description, directory_name,
            next_season_number, created_at, updated_at)
         VALUES ('s1', 'dup-key', 'youtube', 'Show', '', 'Show', 1, 1, 1)`
      )
      .run();

    expect(() =>
      testDb.sqlite
        .prepare(
          `INSERT INTO media_server_shows
             (id, identity_key, source_platform, title, description, directory_name,
              next_season_number, created_at, updated_at)
           VALUES ('s2', 'dup-key', 'youtube', 'Other', '', 'Other', 1, 1, 1)`
        )
        .run()
    ).toThrowError(/UNIQUE constraint failed/);

    // The partial index must still allow many unattached collections.
    for (const id of ["c1", "c2", "c3"]) {
      testDb.sqlite
        .prepare(
          "INSERT INTO collections (id, name, created_at) VALUES (?, ?, '')"
        )
        .run(id, id);
    }
    testDb.sqlite
      .prepare(
        "UPDATE collections SET media_server_show_id='s1', media_server_season_number=1 WHERE id='c1'"
      )
      .run();
    expect(() =>
      testDb.sqlite
        .prepare(
          "UPDATE collections SET media_server_show_id='s1', media_server_season_number=1 WHERE id='c2'"
        )
        .run()
    ).toThrowError(/UNIQUE constraint failed/);
  });
});
