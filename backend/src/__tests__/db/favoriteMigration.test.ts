import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";

const migrationSource = path.resolve(process.cwd(), "drizzle");
const temporaryFolders: string[] = [];

const createMigrationFolder = (): string => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "mytube-favorite-migration-"));
  temporaryFolders.push(folder);
  mkdirSync(path.join(folder, "meta"));

  for (const tag of ["0021_audio_media_type", "0022_download_media_type", "0023_striped_ender_wiggin"]) {
    writeFileSync(
      path.join(folder, `${tag}.sql`),
      readFileSync(path.join(migrationSource, `${tag}.sql`)),
    );
  }

  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        { idx: 0, version: "6", when: 1, tag: "0021_audio_media_type", breakpoints: true },
        { idx: 1, version: "6", when: 2, tag: "0022_download_media_type", breakpoints: true },
        { idx: 2, version: "6", when: 3, tag: "0023_striped_ender_wiggin", breakpoints: true },
      ],
    }),
  );

  return folder;
};

afterEach(() => {
  temporaryFolders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});

describe("favorites migration", () => {
  it("completes when the favorites self-heal has already created its tables", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);

    sqlite.exec(`
      CREATE TABLE videos (id TEXT PRIMARY KEY);
      CREATE TABLE collections (id TEXT PRIMARY KEY);
      CREATE TABLE video_downloads (
        source_video_id TEXT NOT NULL,
        platform TEXT NOT NULL
      );
      CREATE UNIQUE INDEX video_downloads_source_video_id_platform_uidx
        ON video_downloads (source_video_id, platform);
      CREATE TABLE favorite_collections (
        user_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, collection_id),
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_favorite_collections_user ON favorite_collections (user_id);
      CREATE TABLE favorite_authors (
        user_id TEXT NOT NULL,
        author TEXT NOT NULL,
        display_name TEXT,
        avatar_path TEXT,
        channel_url TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, author)
      );
      CREATE INDEX idx_favorite_authors_user ON favorite_authors (user_id);
      CREATE INDEX idx_favorite_authors_author ON favorite_authors (author);
    `);

    expect(() => migrate(db, { migrationsFolder: createMigrationFolder() })).not.toThrow();
    expect(sqlite.prepare("PRAGMA table_info(videos)").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "media_type" })]),
    );
    expect(sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 3 });

    sqlite.close();
  });
});
