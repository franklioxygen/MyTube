import { readFileSync } from "fs";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

/**
 * Issue #411 migration 0028.
 *
 * The migration must create schema only — no shows, seasons, episodes, or
 * artifact rows — and it must apply cleanly both to a fresh database and to a
 * database that already carries every pre-0028 migration.
 */

const migrationsDir = [
  path.resolve(process.cwd(), "drizzle"),
  path.resolve(process.cwd(), "backend", "drizzle"),
].find((candidate) =>
  fs.existsSync(path.join(candidate, "meta", "_journal.json"))
) as string;

const journal = JSON.parse(
  readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")
) as { entries: Array<{ tag: string }> };

const MEDIA_SERVER_MIGRATION_TAG = journal.entries.find((entry) =>
  entry.tag.startsWith("0028_")
)?.tag as string;

function statementsFor(tag: string): string[] {
  return readFileSync(path.join(migrationsDir, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function applyThroughPrevious(sqlite: Database.Database): void {
  for (const entry of journal.entries) {
    if (entry.tag === MEDIA_SERVER_MIGRATION_TAG) {
      return;
    }
    for (const statement of statementsFor(entry.tag)) {
      try {
        sqlite.exec(statement);
      } catch {
        // Several older migrations overlap with the runtime self-heal in
        // storageService/migrations/schemaMigrations.ts. Pre-existing drift is
        // not what this test covers.
      }
    }
  }
}

function applyMediaServerMigration(sqlite: Database.Database): void {
  for (const statement of statementsFor(MEDIA_SERVER_MIGRATION_TAG)) {
    sqlite.exec(statement);
  }
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (
    sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((column) => column.name);
}

describe("media server catalog migration (issue #411)", () => {
  it("exists as migration 0028", () => {
    expect(MEDIA_SERVER_MIGRATION_TAG).toBeTruthy();
  });

  it("applies cleanly to a pre-0028 database without any error", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    applyThroughPrevious(sqlite);

    // Every statement must succeed. A statement that raises here would roll the
    // whole migration back on a real deployment and leave the mirror unusable.
    expect(() => applyMediaServerMigration(sqlite)).not.toThrow();

    const tables = (
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'media_server%' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(tables).toEqual([
      "media_server_episode_assignments",
      "media_server_export_artifacts",
      "media_server_shows",
    ]);

    const collectionColumns = columnNames(sqlite, "collections");
    for (const column of [
      "description",
      "source_url",
      "source_channel_id",
      "source_channel_url",
      "source_channel_name",
      "media_server_show_id",
      "media_server_season_number",
    ]) {
      expect(collectionColumns).toContain(column);
    }

    sqlite.close();
  });

  it("creates schema only and writes no catalog rows", () => {
    const sqlite = new Database(":memory:");
    applyThroughPrevious(sqlite);
    applyMediaServerMigration(sqlite);

    for (const table of [
      "media_server_shows",
      "media_server_episode_assignments",
      "media_server_export_artifacts",
    ]) {
      const { count } = sqlite
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count: number };
      expect(count).toBe(0);
    }

    sqlite.close();
  });

  it("enforces immutable season and episode identity through unique indexes", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    applyThroughPrevious(sqlite);
    applyMediaServerMigration(sqlite);

    sqlite
      .prepare(
        `INSERT INTO media_server_shows
           (id, identity_key, source_platform, title, description, directory_name,
            next_season_number, created_at, updated_at)
         VALUES ('s1', 'youtube:channel-id:UC1', 'youtube', 'Show', '', 'Show', 1, 1, 1)`
      )
      .run();

    // Identity key and directory name are both unique per show.
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO media_server_shows
             (id, identity_key, source_platform, title, description, directory_name,
              next_season_number, created_at, updated_at)
           VALUES ('s2', 'youtube:channel-id:UC1', 'youtube', 'Other', '', 'Other', 1, 1, 1)`
        )
        .run()
    ).toThrowError(/UNIQUE constraint failed/);

    sqlite
      .prepare("INSERT INTO videos (id, title, created_at) VALUES ('v1', 'V', '')")
      .run();
    sqlite
      .prepare(
        "INSERT INTO collections (id, name, created_at) VALUES ('c1', 'C', '')"
      )
      .run();

    const insertAssignment = (
      id: string,
      season: number,
      episode: number,
      videoId: string
    ): void => {
      sqlite
        .prepare(
          `INSERT INTO media_server_episode_assignments
             (id, show_id, collection_id, video_id, season_number, episode_number,
              export_stem, created_at, updated_at)
           VALUES (?, 's1', 'c1', ?, ?, ?, 'stem', 1, 1)`
        )
        .run(id, videoId, season, episode);
    };

    insertAssignment("a1", 1, 1, "v1");

    // Same video twice in one season is rejected...
    expect(() => insertAssignment("a2", 1, 2, "v1")).toThrowError(
      /UNIQUE constraint failed/
    );

    // ...but the same video in a second season is the duplicate-playlist case
    // and must be allowed.
    expect(() => insertAssignment("a3", 2, 1, "v1")).not.toThrow();

    sqlite
      .prepare("INSERT INTO videos (id, title, created_at) VALUES ('v2', 'V2', '')")
      .run();
    expect(() => insertAssignment("a4", 1, 1, "v2")).toThrowError(
      /UNIQUE constraint failed/
    );

    sqlite.close();
  });

  it("keeps one season number per show while leaving unattached collections free", () => {
    const sqlite = new Database(":memory:");
    applyThroughPrevious(sqlite);
    applyMediaServerMigration(sqlite);

    sqlite
      .prepare(
        `INSERT INTO media_server_shows
           (id, identity_key, source_platform, title, description, directory_name,
            next_season_number, created_at, updated_at)
         VALUES ('s1', 'k', 'youtube', 'Show', '', 'Show', 1, 1, 1)`
      )
      .run();

    const insertCollection = (
      id: string,
      showId: string | null,
      season: number | null
    ): void => {
      sqlite
        .prepare(
          `INSERT INTO collections (id, name, created_at, media_server_show_id, media_server_season_number)
           VALUES (?, ?, '', ?, ?)`
        )
        .run(id, id, showId, season);
    };

    insertCollection("c1", "s1", 1);
    expect(() => insertCollection("c2", "s1", 1)).toThrowError(
      /UNIQUE constraint failed/
    );
    expect(() => insertCollection("c3", "s1", 2)).not.toThrow();

    // The partial index must not collapse unattached collections.
    expect(() => insertCollection("c4", null, null)).not.toThrow();
    expect(() => insertCollection("c5", null, null)).not.toThrow();

    sqlite.close();
  });

  it("keeps artifact ownership after the referenced catalog rows disappear", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    applyThroughPrevious(sqlite);
    applyMediaServerMigration(sqlite);

    sqlite
      .prepare(
        `INSERT INTO media_server_shows
           (id, identity_key, source_platform, title, description, directory_name,
            next_season_number, created_at, updated_at)
         VALUES ('s1', 'k', 'youtube', 'Show', '', 'Show', 1, 1, 1)`
      )
      .run();
    sqlite
      .prepare("INSERT INTO videos (id, title, created_at) VALUES ('v1', 'V', '')")
      .run();
    sqlite
      .prepare(
        `INSERT INTO media_server_episode_assignments
           (id, show_id, video_id, season_number, episode_number, export_stem, created_at, updated_at)
         VALUES ('a1', 's1', 'v1', 0, 1, 'S00E001 - V', 1, 1)`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO media_server_export_artifacts
           (relative_path, artifact_type, show_id, assignment_id, materialization, created_at, updated_at)
         VALUES ('Show/Season 00/S00E001 - V.mp4', 'episode_media', 's1', 'a1', 'hard_link', 1, 1)`
      )
      .run();

    // Deleting the video cascades the assignment away, but the artifact row —
    // the only proof MyTube owns that media file — must survive so cleanup can
    // still remove it from disk.
    sqlite.prepare("DELETE FROM videos WHERE id = 'v1'").run();

    const assignments = sqlite
      .prepare("SELECT COUNT(*) AS count FROM media_server_episode_assignments")
      .get() as { count: number };
    expect(assignments.count).toBe(0);

    const artifact = sqlite
      .prepare("SELECT * FROM media_server_export_artifacts")
      .get() as { assignment_id: string | null; show_id: string | null };
    expect(artifact).toBeTruthy();
    expect(artifact.assignment_id).toBeNull();
    expect(artifact.show_id).toBe("s1");

    sqlite.close();
  });
});
