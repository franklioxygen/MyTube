import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
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

it.each([
  { appliedAt: 1794438115661, pathConstraint: "NOT NULL" },
  { appliedAt: 1794459650631, pathConstraint: "" },
])("keeps a database that already applied an earlier feature revision ($appliedAt) compatible", ({ appliedAt, pathConstraint }) => {
  sqlite.exec(`CREATE TABLE author_profiles (author TEXT PRIMARY KEY NOT NULL, custom_avatar_path TEXT ${pathConstraint}, updated_at INTEGER NOT NULL);
    CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC);`);
  sqlite.prepare("INSERT INTO author_profiles VALUES (?, ?, ?)").run("legacy".repeat(40), "/avatars/custom-aaaa.jpg", 123);
  sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run("previous-feature-revision", appliedAt);
  // Consolidating the unmerged SQL must not recreate an already-applied table.
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  ensureAuthorProfilesTable();
  sqlite.prepare("UPDATE author_profiles SET custom_avatar_path = NULL").run();
  expect(sqlite.prepare("SELECT * FROM author_profiles").all()).toEqual([
    { author: "legacy".repeat(40), custom_avatar_path: null, updated_at: 123 },
  ]);
});
