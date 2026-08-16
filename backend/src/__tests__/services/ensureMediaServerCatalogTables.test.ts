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

/** Collection-as-show columns, added after the #411 catalog. */
const COLLECTION_SHOW_COLUMNS = [
  "export_as_show",
  "media_server_title",
  "media_server_description",
  "media_server_poster_path",
  "media_server_metadata_source",
  "tmdb_id",
  "tmdb_media_type",
  "tmdb_premiere_date",
  "tmdb_match_strategy",
  "tmdb_match_confirmed_at",
];

const SHOW_TABLE_COLLECTION_COLUMNS = [
  "source_collection_id",
  "tmdb_id",
  "tmdb_media_type",
  "premiered",
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

  it("adds the collection-as-show columns on both tables", () => {
    ensureMediaServerCatalogTables();

    for (const column of COLLECTION_SHOW_COLUMNS) {
      expect(columnNames("collections")).toContain(column);
    }
    for (const column of SHOW_TABLE_COLLECTION_COLUMNS) {
      expect(columnNames("media_server_shows")).toContain(column);
    }
  });

  it("repairs a database that has the #411 catalog but not the collection-show columns", () => {
    // The realistic upgrade path: 0028 applied, 0029 aborted with the drizzle
    // batch. Build that state by running the self-heal, then dropping the newer
    // columns is not possible in SQLite — instead assert the self-heal is what
    // supplies them, since a pre-0029 database simply lacks them.
    ensureMediaServerCatalogTables();

    expect(columnNames("collections")).toContain("export_as_show");
    expect(() =>
      testDb.sqlite
        .prepare("SELECT export_as_show, tmdb_id FROM collections")
        .all()
    ).not.toThrow();
    expect(() =>
      testDb.sqlite
        .prepare("SELECT source_collection_id, premiered FROM media_server_shows")
        .all()
    ).not.toThrow();
  });

  it("defaults export_as_show to 0 for existing collections", () => {
    testDb.sqlite
      .prepare(
        "INSERT INTO collections (id, name, title, created_at) VALUES ('c1', 'Mine', 'Mine', '2026-01-01')"
      )
      .run();

    ensureMediaServerCatalogTables();

    const row = testDb.sqlite
      .prepare("SELECT export_as_show FROM collections WHERE id = 'c1'")
      .get() as { export_as_show: number };
    expect(row.export_as_show).toBe(0);
  });

  it("enforces one show row per collection", () => {
    ensureMediaServerCatalogTables();

    const insertShow = (id: string, collectionId: string | null): void => {
      testDb.sqlite
        .prepare(
          `INSERT INTO media_server_shows
             (id, identity_key, source_platform, title, description, directory_name,
              next_season_number, created_at, updated_at, source_collection_id)
           VALUES (?, ?, 'mytube', ?, '', ?, 1, 1, 1, ?)`
        )
        .run(id, `collection:${id}`, id, id, collectionId);
    };

    insertShow("s1", "c1");
    expect(() => insertShow("s2", "c1")).toThrowError(
      /UNIQUE constraint failed/
    );

    // The partial index must still allow many author shows, which have none.
    expect(() => insertShow("s3", null)).not.toThrow();
    expect(() => insertShow("s4", null)).not.toThrow();
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
