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
  const folder = mkdtempSync(path.join(os.tmpdir(), "mytube-source-id-migration-"));
  temporaryFolders.push(folder);
  mkdirSync(path.join(folder, "meta"));

  writeFileSync(
    path.join(folder, "0026_confused_justice.sql"),
    readFileSync(path.join(migrationSource, "0026_confused_justice.sql")),
  );
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        {
          idx: 0,
          version: "6",
          when: 1,
          tag: "0026_confused_justice",
          breakpoints: true,
        },
      ],
    }),
  );

  return folder;
};

afterEach(() => {
  temporaryFolders
    .splice(0)
    .forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});

describe("videos source ID migration", () => {
  it("backfills only videos referenced by exactly one download row", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);

    sqlite.exec(`
      CREATE TABLE videos (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE video_downloads (
        id TEXT PRIMARY KEY NOT NULL,
        source_video_id TEXT NOT NULL,
        video_id TEXT
      );

      INSERT INTO videos (id) VALUES ('unique'), ('ambiguous'), ('unlinked');
      INSERT INTO video_downloads (id, source_video_id, video_id) VALUES
        ('download-unique', 'source-unique', 'unique'),
        ('download-ambiguous-a', 'source-a', 'ambiguous'),
        ('download-ambiguous-b', 'source-b', 'ambiguous');
    `);

    migrate(db, { migrationsFolder: createMigrationFolder() });

    expect(
      sqlite
        .prepare("SELECT id, source_video_id AS sourceVideoId FROM videos ORDER BY id")
        .all(),
    ).toEqual([
      { id: "ambiguous", sourceVideoId: null },
      { id: "unique", sourceVideoId: "source-unique" },
      { id: "unlinked", sourceVideoId: null },
    ]);

    sqlite.close();
  });
});
