import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sqlite: undefined as any }));

vi.mock("../../db", () => ({
  get sqlite() {
    return mocks.sqlite;
  },
  get db() {
    return mocks.sqlite;
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { ensureMediaServerExportTables } from "../../services/storageService/migrations/schemaMigrations";

const sqlite = new Database(":memory:");
mocks.sqlite = sqlite;

function columnNames(table: string): string[] {
  return (
    sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((column) => column.name);
}

/** A database that predates migration 0028. */
function createPre0028Schema(): void {
  sqlite.exec(`
    DROP TABLE IF EXISTS media_server_export_artifacts;
    DROP TABLE IF EXISTS media_server_episode_assignments;
    DROP TABLE IF EXISTS media_server_shows;
    DROP TABLE IF EXISTS collections;
    DROP TABLE IF EXISTS videos;
    CREATE TABLE videos (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
}

describe("media server export catalog migration", () => {
  beforeEach(() => {
    sqlite.pragma("foreign_keys = ON");
    createPre0028Schema();
  });

  afterAll(() => {
    sqlite.close();
  });

  it("applies the real migrations to a database that already has the catalog tables", () => {
    // Reproduces the crash seen when a database carried these tables from an
    // earlier build of this feature: every statement in 0028 must be idempotent,
    // because one failure rolls the migration back and leaves it unrecorded.
    const target = new Database(":memory:");
    const migrationsFolder = path.join(process.cwd(), "drizzle");
    migrate(drizzle(target), { migrationsFolder });
    target.exec(`
      ALTER TABLE media_server_shows ADD COLUMN poster_source_path TEXT;
      ALTER TABLE media_server_export_artifacts ADD COLUMN content_digest TEXT;
      CREATE UNIQUE INDEX media_server_shows_source_collection_uidx
        ON media_server_shows (source_channel_id);
    `);
    target.prepare("DELETE FROM __drizzle_migrations WHERE id = (SELECT MAX(id) FROM __drizzle_migrations)").run();

    expect(() =>
      migrate(drizzle(target), { migrationsFolder })
    ).not.toThrow();
    target.close();
  });

  it("creates the catalog tables and collection columns on a pre-0028 database", () => {
    ensureMediaServerExportTables();

    expect(columnNames("media_server_shows")).toContain("identity_key");
    expect(columnNames("media_server_episode_assignments")).toContain(
      "export_stem"
    );
    expect(columnNames("media_server_export_artifacts")).toContain(
      "materialization"
    );
    expect(columnNames("media_server_retired_episodes")).toContain(
      "episode_number"
    );
    expect(columnNames("collections")).toEqual(
      expect.arrayContaining([
        "description",
        "source_url",
        "source_channel_id",
        "source_channel_url",
        "source_channel_name",
        "source_channel_description",
        "media_server_show_id",
        "media_server_season_number",
      ])
    );
  });

  it("is idempotent on an already-migrated database", () => {
    ensureMediaServerExportTables();
    expect(() => ensureMediaServerExportTables()).not.toThrow();
    expect(columnNames("collections").filter((c) => c === "description")).toHaveLength(
      1
    );
  });

  it("enforces one show per identity and one episode number per season", () => {
    ensureMediaServerExportTables();
    const insertShow = sqlite.prepare(
      `INSERT INTO media_server_shows (id, identity_key, source_platform, title, description, directory_name, next_season_number, created_at, updated_at)
       VALUES (?, ?, 'youtube', ?, '', ?, 1, 0, 0)`
    );
    insertShow.run("show-1", "youtube:channel-id:UC1", "A", "A");
    expect(() =>
      insertShow.run("show-2", "youtube:channel-id:UC1", "B", "B")
    ).toThrow(/UNIQUE/i);
    expect(() => insertShow.run("show-3", "youtube:author:c", "C", "A")).toThrow(
      /UNIQUE/i
    );

    sqlite
      .prepare("INSERT INTO videos (id, title, created_at) VALUES ('v1', 'V1', '')")
      .run();
    sqlite
      .prepare("INSERT INTO videos (id, title, created_at) VALUES ('v2', 'V2', '')")
      .run();
    const insertAssignment = sqlite.prepare(
      `INSERT INTO media_server_episode_assignments (id, show_id, collection_id, video_id, season_number, episode_number, export_stem, created_at, updated_at)
       VALUES (?, 'show-1', NULL, ?, 0, ?, 'stem', 0, 0)`
    );
    insertAssignment.run("a1", "v1", 1);
    expect(() => insertAssignment.run("a2", "v2", 1)).toThrow(/UNIQUE/i);
  });

  it("keeps artifact ownership after the catalog row cascades away", () => {
    ensureMediaServerExportTables();
    sqlite
      .prepare(
        `INSERT INTO media_server_shows (id, identity_key, source_platform, title, description, directory_name, next_season_number, created_at, updated_at)
         VALUES ('show-1', 'k', 'youtube', 'A', '', 'A', 1, 0, 0)`
      )
      .run();
    sqlite
      .prepare("INSERT INTO videos (id, title, created_at) VALUES ('v1', 'V1', '')")
      .run();
    sqlite
      .prepare(
        `INSERT INTO media_server_episode_assignments (id, show_id, collection_id, video_id, season_number, episode_number, export_stem, created_at, updated_at)
         VALUES ('a1', 'show-1', NULL, 'v1', 0, 1, 'stem', 0, 0)`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO media_server_export_artifacts (relative_path, artifact_type, show_id, assignment_id, materialization, created_at, updated_at)
         VALUES ('A/Season 00/stem.mp4', 'episode_media', 'show-1', 'a1', 'hard_link', 0, 0)`
      )
      .run();

    sqlite.prepare("DELETE FROM videos WHERE id = 'v1'").run();

    const artifact = sqlite
      .prepare("SELECT assignment_id, show_id FROM media_server_export_artifacts")
      .get() as { assignment_id: string | null; show_id: string | null };
    expect(artifact.assignment_id).toBeNull();
    expect(artifact.show_id).toBe("show-1");
  });
});
