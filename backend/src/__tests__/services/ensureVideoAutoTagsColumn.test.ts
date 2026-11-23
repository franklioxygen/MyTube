import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sqlite: undefined as Database.Database | undefined }));
vi.mock("../../db", () => ({ get sqlite() { return state.sqlite; }, db: {} }));
vi.mock("../../services/storageService/authorCollectionUtils", () => ({ backfillLegacyCollectionOrigins: vi.fn() }));
vi.mock("../../services/storageService/migrations/legacyTwitchDownloads", () => ({ deduplicateVideoDownloadsBySourceAndPlatform: vi.fn(), normalizeLegacyTwitchDownloads: vi.fn() }));
vi.mock("../../services/storageService/migrations/dataBackfill", () => ({ backfillDownloadHistoryMediaTypes: vi.fn(), backfillDownloadHistoryVideoIds: vi.fn(), populateVideoFileSizes: vi.fn() }));
import { ensureVideoAutoTagsColumn } from "../../services/storageService/migrations/schemaMigrations";

let sqlite: Database.Database;
beforeEach(() => { sqlite = new Database(":memory:"); state.sqlite = sqlite; });
afterEach(() => { sqlite.close(); });

const columns = () => (sqlite.prepare("PRAGMA table_info(videos)").all() as { name: string }[]).map((c) => c.name);

it("adds auto_tags to a restored videos table that skipped migration 0034, once", () => {
  sqlite.exec("CREATE TABLE videos (id TEXT PRIMARY KEY NOT NULL, tags TEXT)");
  ensureVideoAutoTagsColumn();
  ensureVideoAutoTagsColumn();
  expect(columns()).toEqual(["id", "tags", "auto_tags"]);
});

it("leaves a database without a videos table alone", () => {
  ensureVideoAutoTagsColumn();
  expect(columns()).toEqual([]);
});
