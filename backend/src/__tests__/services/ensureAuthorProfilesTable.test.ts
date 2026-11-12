import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sqlite: undefined as Database.Database | undefined }));
vi.mock("../../db", () => ({ get sqlite() { return state.sqlite; }, db: {} }));
vi.mock("../../services/storageService/authorCollectionUtils", () => ({ backfillLegacyCollectionOrigins: vi.fn() }));
vi.mock("../../services/storageService/migrations/legacyTwitchDownloads", () => ({ deduplicateVideoDownloadsBySourceAndPlatform: vi.fn(), normalizeLegacyTwitchDownloads: vi.fn() }));
vi.mock("../../services/storageService/migrations/dataBackfill", () => ({ backfillDownloadHistoryMediaTypes: vi.fn(), backfillDownloadHistoryVideoIds: vi.fn(), populateVideoFileSizes: vi.fn() }));
import { ensureAuthorProfilesTable } from "../../services/storageService/migrations/schemaMigrations";

let sqlite: Database.Database;
beforeEach(() => { sqlite = new Database(":memory:"); state.sqlite = sqlite; });
afterEach(() => { sqlite.close(); });

it("recovers a missing table after an old backup skips the author migrations", () => {
  ensureAuthorProfilesTable();
  sqlite.prepare("INSERT INTO author_profiles VALUES (?, NULL, ?)").run("legacy".repeat(40), 1);
  ensureAuthorProfilesTable();
  expect(sqlite.prepare("SELECT custom_avatar_path FROM author_profiles").all()).toEqual([{ custom_avatar_path: null }]);
});

it("upgrades the original non-null path schema transactionally and preserves exact identities", () => {
  sqlite.exec("CREATE TABLE author_profiles (author TEXT PRIMARY KEY NOT NULL, custom_avatar_path TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const author = ` ${"作".repeat(201)} `;
  sqlite.prepare("INSERT INTO author_profiles VALUES (?, ?, ?)").run(author, "/avatars/custom-aaaa.jpg", 123);
  ensureAuthorProfilesTable();
  expect(sqlite.prepare("SELECT * FROM author_profiles").all()).toEqual([{ author, custom_avatar_path: "/avatars/custom-aaaa.jpg", updated_at: 123 }]);
  sqlite.prepare("UPDATE author_profiles SET custom_avatar_path = NULL WHERE author = ?").run(author);
  ensureAuthorProfilesTable();
  expect(sqlite.prepare("SELECT author, custom_avatar_path FROM author_profiles").all()).toEqual([{ author, custom_avatar_path: null }]);
});
