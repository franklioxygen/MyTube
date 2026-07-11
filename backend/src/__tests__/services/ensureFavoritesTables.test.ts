import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real in-memory sqlite handed to the self-heal via the mocked db module.
const mocks = vi.hoisted(() => ({ sqlite: undefined as any }));

vi.mock("../../db", () => ({
  get sqlite() {
    return mocks.sqlite;
  },
  db: {},
}));

// ensureFavoritesTables never calls these siblings, but schemaMigrations
// imports them at module load — stub them so the test stays lightweight.
vi.mock("../../services/storageService/authorCollectionUtils", () => ({
  backfillLegacyCollectionOrigins: vi.fn(),
}));
vi.mock("../../services/storageService/migrations/legacyTwitchDownloads", () => ({
  deduplicateVideoDownloadsBySourceAndPlatform: vi.fn(),
  normalizeLegacyTwitchDownloads: vi.fn(),
}));
vi.mock("../../services/storageService/migrations/dataBackfill", () => ({
  backfillDownloadHistoryVideoIds: vi.fn(),
  populateVideoFileSizes: vi.fn(),
}));

const tableNames = (sqlite: Database.Database): string[] =>
  sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => (row as { name: string }).name);

describe("ensureFavoritesTables (migration 0021 self-heal)", () => {
  let sqlite: Database.Database;
  let ensureFavoritesTables: typeof import("../../services/storageService/migrations/schemaMigrations").ensureFavoritesTables;

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    // Simulate an out-of-sync install: collections exists, but drizzle aborted
    // its batch before 0021, so the favorites tables were never created.
    sqlite.exec(
      "CREATE TABLE collections (id text PRIMARY KEY, name text NOT NULL)"
    );
    mocks.sqlite = sqlite;
    ({ ensureFavoritesTables } = await import(
      "../../services/storageService/migrations/schemaMigrations"
    ));
  });

  afterAll(() => {
    sqlite.close();
  });

  it("creates the favorites tables when they are missing", () => {
    expect(tableNames(sqlite)).not.toContain("favorite_collections");

    ensureFavoritesTables();

    const names = tableNames(sqlite);
    expect(names).toContain("favorite_collections");
    expect(names).toContain("favorite_authors");

    // Queries that previously 500'd now work.
    expect(() =>
      sqlite.prepare("SELECT * FROM favorite_collections").all()
    ).not.toThrow();
    expect(() =>
      sqlite.prepare("SELECT * FROM favorite_authors").all()
    ).not.toThrow();
  });

  it("is idempotent and preserves existing rows on a second boot", () => {
    sqlite
      .prepare("INSERT INTO collections (id, name) VALUES (?, ?)")
      .run("c1", "Test");
    sqlite
      .prepare(
        "INSERT INTO favorite_collections (user_id, collection_id, created_at) VALUES (?, ?, ?)"
      )
      .run("__admin__", "c1", Date.now());

    // Second boot must not throw or wipe data.
    expect(() => ensureFavoritesTables()).not.toThrow();

    const rows = sqlite.prepare("SELECT * FROM favorite_collections").all();
    expect(rows).toHaveLength(1);
  });

  it("cascades favorite_collections rows when the collection is deleted", () => {
    sqlite.pragma("foreign_keys = ON");
    sqlite.prepare("DELETE FROM collections WHERE id = ?").run("c1");

    const remaining = sqlite
      .prepare("SELECT count(*) AS c FROM favorite_collections")
      .get() as { c: number };
    expect(remaining.c).toBe(0);
  });
});
