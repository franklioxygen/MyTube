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

const hasTable = (sqlite: Database.Database): boolean =>
  !!sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_gesture_credential'"
    )
    .get();

/**
 * drizzle's migrate() aborts its remaining batch at the first failing
 * statement, and migrate.ts swallows "duplicate column name" so an install
 * whose columns were already self-healed can still boot. Migration 0028 then
 * never runs, and because the other self-heals only add columns, nothing
 * recreates a missing table - the server starts clean and every Gesture Login
 * request fails with "no such table".
 */
describe("ensureGestureCredentialTable (migration 0028 self-heal)", () => {
  let sqlite: Database.Database;
  let ensureGestureCredentialTable: typeof import("../../services/storageService/migrations/schemaMigrations").ensureGestureCredentialTable;

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    mocks.sqlite = sqlite;
    ({ ensureGestureCredentialTable } = await import(
      "../../services/storageService/migrations/schemaMigrations"
    ));
  });

  afterAll(() => {
    sqlite.close();
  });

  it("creates the table when the migration batch skipped it", () => {
    expect(hasTable(sqlite)).toBe(false);

    ensureGestureCredentialTable();

    expect(hasTable(sqlite)).toBe(true);
  });

  it("is idempotent, so a healthy install is untouched", () => {
    ensureGestureCredentialTable();
    ensureGestureCredentialTable();

    expect(hasTable(sqlite)).toBe(true);
  });

  it("reproduces the migration's constraints, so a healed table behaves the same", () => {
    ensureGestureCredentialTable();

    const insert = (
      id: number,
      attempts: number,
      lastFailed: number | null,
      lockedAt: number | null
    ) =>
      sqlite
        .prepare(
          `INSERT INTO admin_gesture_credential
             (id, pattern_hash, pepper_key_id, credential_version,
              failed_attempts, last_failed_at, locked_at, created_at, updated_at)
           VALUES (?, 'h', 'k', 'v', ?, ?, ?, 1, 1)`
        )
        .run(id, attempts, lastFailed, lockedAt);

    // Singleton, bounded counter, and the three legal failure shapes.
    expect(() => insert(2, 0, null, null)).toThrow();
    expect(() => insert(1, 4, 1000, 1000)).toThrow();
    expect(() => insert(1, 0, 1000, null)).toThrow();
    expect(() => insert(1, 3, 1000, null)).toThrow();

    expect(() => insert(1, 0, null, null)).not.toThrow();
    sqlite.exec("DELETE FROM admin_gesture_credential");
    expect(() => insert(1, 2, 1000, null)).not.toThrow();
    sqlite.exec("DELETE FROM admin_gesture_credential");
    expect(() => insert(1, 3, 1000, 1000)).not.toThrow();
  });
});
