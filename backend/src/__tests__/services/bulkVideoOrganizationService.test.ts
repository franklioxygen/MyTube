import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";

const state = vi.hoisted(() => ({ connection: null as unknown as ReturnType<typeof drizzle> }));
vi.mock("../../db", () => ({ db: new Proxy({}, {
  get: (_target, key) => {
    const value = state.connection[key as keyof typeof state.connection];
    return typeof value === "function" ? value.bind(state.connection) : value;
  },
}) }));
vi.mock("../../services/storageService/settings", () => ({ invalidateSettingsCache: vi.fn() }));
vi.mock("../../services/recommendationSignalsService", () => ({ invalidateRecommendationSignalsCache: vi.fn() }));

import { addVideosToCollection, appendTagsToVideos, BulkOrganizationError } from "../../services/bulkVideoOrganizationService";
import { invalidateSettingsCache } from "../../services/storageService/settings";
import { getVideosListETag } from "../../services/storageService/videoListRevision";

let sqlite: Database.Database;
let folder: string;
let filename: string;
const candidate = { id: "82b67b4e-b490-48ef-8ac7-577310286cf1", name: "Study" };
const getTags = (id: string) => JSON.parse((sqlite.prepare("SELECT tags FROM videos WHERE id=?").get(id) as { tags: string }).tags);
const links = (id = "c1") => sqlite.prepare('SELECT video_id AS id, "order" FROM collection_videos WHERE collection_id=? ORDER BY "order"').all(id);
const expectBulkError = (callback: () => unknown, status: number) => {
  try { callback(); throw new Error("Expected request to fail"); }
  catch (error) { expect(error).toBeInstanceOf(BulkOrganizationError); expect((error as BulkOrganizationError).status).toBe(status); }
};

beforeEach(() => {
  vi.clearAllMocks();
  folder = mkdtempSync(path.join(tmpdir(), "mytube-bulk-"));
  filename = path.join(folder, "test.sqlite");
  sqlite = new Database(filename);
  sqlite.pragma("foreign_keys=ON");
  sqlite.pragma("busy_timeout=0");
  state.connection = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE videos(id TEXT PRIMARY KEY, title TEXT NOT NULL, tags TEXT, video_path TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE collections(id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT, origin TEXT,
      created_at TEXT NOT NULL, updated_at TEXT, source_platform TEXT, source_type TEXT, source_mid TEXT, source_id TEXT);
    CREATE TABLE collection_videos(collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, "order" INTEGER,
      PRIMARY KEY(collection_id,video_id));
    INSERT INTO videos VALUES ('v1','One','["original"]','/videos/one.mp4'),
      ('v2','Two','["music"]','/videos/two.mp4'), ('v3','Three',NULL,'cloud:three');
    INSERT INTO settings VALUES ('tags','["Music"]'),('language','"zh"');
    INSERT INTO collections(id,name,title,origin,created_at) VALUES
      ('c1','First','First','manual','2026-01-01'),('c2','Other','Other','author_auto','2026-01-01');
    INSERT INTO collection_videos VALUES ('c1','v2',7),('c2','v1',1);
  `);
});
afterEach(() => { sqlite.close(); rmSync(folder, { recursive: true, force: true }); });

describe("bulk tags with real SQLite", () => {
  it("appends canonical tags without replacing old tags, deduplicates IDs and is idempotent", () => {
    const etag = getVideosListETag("all");
    const first = appendTagsToVideos({ videoIds: ["v1", "v2", "v1"], tags: [" MUSIC ", "学习", "学习"] });
    expect(first.requestedCount).toBe(2);
    expect(getTags("v1")).toEqual(["original", "Music", "学习"]);
    expect(getTags("v2")).toEqual(["music", "学习"]);
    expect(first.catalogChanged).toBe(true);
    expect(invalidateSettingsCache).toHaveBeenCalledOnce();
    expect(getVideosListETag("all")).not.toBe(etag);
    const after = getVideosListETag("all");
    const second = appendTagsToVideos({ videoIds: ["v1", "v2"], tags: ["music", "学习"] });
    expect(second.changedVideoIds).toEqual([]);
    expect(second.unchangedVideoIds).toEqual(["v1", "v2"]);
    expect(second.videos[0].tags).toEqual(["original", "Music", "学习"]);
    expect(getVideosListETag("all")).toBe(after);
    expect(sqlite.prepare("SELECT value FROM settings WHERE key='language'").get()).toEqual({ value: '"zh"' });
  });

  it("repairs only the catalog when all videos already have the requested tag", () => {
    sqlite.exec("DELETE FROM settings WHERE key='tags'");
    const before = getVideosListETag("all");
    expect(appendTagsToVideos({ videoIds: ["v2"], tags: ["music"] }).catalogChanged).toBe(true);
    expect(getVideosListETag("all")).toBe(before);
    expect(invalidateSettingsCache).toHaveBeenCalledOnce();
  });

  it.each(["second video", "catalog", "commit"])("rolls back every write on %s failure without advancing revision", (failure) => {
    if (failure === "second video") sqlite.exec("CREATE TRIGGER fail BEFORE UPDATE ON videos WHEN NEW.id='v2' BEGIN SELECT RAISE(ABORT,'forced failure'); END");
    if (failure === "catalog") sqlite.exec("CREATE TRIGGER fail BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT,'forced failure'); END");
    if (failure === "commit") sqlite.exec(`CREATE TABLE guard(video_id TEXT REFERENCES videos(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER fail AFTER UPDATE ON videos BEGIN INSERT INTO guard VALUES('missing'); END`);
    const before = getVideosListETag("all");
    expect(() => appendTagsToVideos({ videoIds: ["v1", "v2"], tags: ["new"] })).toThrow();
    expect(getTags("v1")).toEqual(["original"]);
    expect(getTags("v2")).toEqual(["music"]);
    expect(sqlite.prepare("SELECT value FROM settings WHERE key='tags'").get()).toEqual({ value: '["Music"]' });
    expect(getVideosListETag("all")).toBe(before);
    expect(invalidateSettingsCache).not.toHaveBeenCalled();
  });

  it.each(['bad json', 'null', '[3]', '{}'])("rejects corrupt video tags %s without changing earlier videos", (tags) => {
    sqlite.prepare("UPDATE videos SET tags=? WHERE id='v2'").run(tags);
    expectBulkError(() => appendTagsToVideos({ videoIds: ["v1", "v2"], tags: ["new"] }), 409);
    expect(getTags("v1")).toEqual(["original"]);
  });

  it("rejects a corrupt catalog and accepts legacy empty/null video tags", () => {
    sqlite.exec("UPDATE settings SET value='null' WHERE key='tags'");
    expectBulkError(() => appendTagsToVideos({ videoIds: ["v1"], tags: ["new"] }), 409);
    sqlite.exec("DELETE FROM settings WHERE key='tags'; UPDATE videos SET tags='' WHERE id='v1'");
    appendTagsToVideos({ videoIds: ["v1", "v3"], tags: ["new"] });
    expect(getTags("v1")).toEqual(["new"]);
    expect(getTags("v3")).toEqual(["new"]);
  });

  it.each([[], Array(501).fill("v1"), [1], [" v1"], [""], ["a".repeat(201)]])("rejects invalid ID arrays %#", (videoIds) => {
    expectBulkError(() => appendTagsToVideos({ videoIds, tags: ["new"] }), 400);
  });
  it.each([[], Array(21).fill("a"), [2], [" "], ["a\u0000"], ["😀".repeat(81)]])("rejects invalid tag arrays %#", (tags) => {
    expectBulkError(() => appendTagsToVideos({ videoIds: ["v1"], tags }), 400);
  });
  it("accepts 20 tags and 80 Unicode code points, rejects extra fields", () => {
    const tags = ["😀".repeat(80), ...Array.from({ length: 19 }, (_, i) => `tag${i}`)];
    expect(appendTagsToVideos({ videoIds: ["v1"], tags }).changedVideoIds).toEqual(["v1"]);
    expectBulkError(() => appendTagsToVideos({ videoIds: ["v1"], tags: ["ok"], visibility: 0 }), 400);
  });
  it("returns all missing IDs atomically", () => {
    expect(() => appendTagsToVideos({ videoIds: ["v1", "missing"], tags: ["new"] })).toThrowError(
      expect.objectContaining({ status: 404, details: { missingVideoIds: ["missing"] } }),
    );
    expect(getTags("v1")).toEqual(["original"]);
  });

  it("does not overwrite an external writer; retry reads its committed tags", () => {
    const external = new Database(filename);
    try {
      external.exec(`BEGIN IMMEDIATE; UPDATE videos SET tags='["external"]' WHERE id='v1'`);
      expect(() => appendTagsToVideos({ videoIds: ["v1"], tags: ["new"] })).toThrow(/locked/);
      external.exec("COMMIT");
      appendTagsToVideos({ videoIds: ["v1"], tags: ["new"] });
      expect(getTags("v1")).toEqual(["external", "new"]);
    } finally { external.close(); }
  });
});

describe("bulk collection membership with real SQLite", () => {
  it("appends in request order, preserves old order, other memberships and paths; retry is a no-op", () => {
    const before = getVideosListETag("all");
    const result = addVideosToCollection({ videoIds: ["v3", "v2", "v1"], collectionId: "c1" });
    expect(result.changedVideoIds).toEqual(["v3", "v1"]);
    expect(links()).toEqual([{ id: "v2", order: 7 }, { id: "v3", order: 8 }, { id: "v1", order: 9 }]);
    expect(links("c2")).toEqual([{ id: "v1", order: 1 }]);
    expect(sqlite.prepare("SELECT video_path FROM videos WHERE id='v1'").get()).toEqual({ video_path: "/videos/one.mp4" });
    expect(addVideosToCollection({ videoIds: ["v3", "v2", "v1"], collectionId: "c1" }).changedVideoIds).toEqual([]);
    expect(getVideosListETag("all")).toBe(before);
  });
  it("creates and populates atomically, reusing the UUID on retry", () => {
    const body = { videoIds: ["v1", "v2"], newCollection: candidate };
    expect(addVideosToCollection(body).collection.created).toBe(true);
    expect(addVideosToCollection(body).collection.created).toBe(false);
    expect(links(candidate.id)).toEqual([{ id: "v1", order: 1 }, { id: "v2", order: 2 }]);
  });
  it("rolls back collection creation and every membership if insertion fails", () => {
    sqlite.exec("CREATE TRIGGER fail BEFORE INSERT ON collection_videos WHEN NEW.video_id='v2' BEGIN SELECT RAISE(ABORT,'forced'); END");
    expect(() => addVideosToCollection({ videoIds: ["v1", "v2"], newCollection: candidate })).toThrow();
    expect(sqlite.prepare("SELECT id FROM collections WHERE id=?").get(candidate.id)).toBeUndefined();
    expect(links(candidate.id)).toEqual([]);
  });
  it("does not create an empty collection when a video is missing", () => {
    expectBulkError(() => addVideosToCollection({ videoIds: ["missing"], newCollection: candidate }), 404);
    expect(sqlite.prepare("SELECT id FROM collections WHERE id=?").get(candidate.id)).toBeUndefined();
  });
  it("rejects missing targets, name/title collisions and reused IDs without overwriting", () => {
    expectBulkError(() => addVideosToCollection({ videoIds: ["v1"], collectionId: "missing" }), 404);
    expect(() => addVideosToCollection({ videoIds: ["v1"], newCollection: { ...candidate, name: "First" } }))
      .toThrowError(expect.objectContaining({ status: 409, details: { existingCollectionId: "c1" } }));
    addVideosToCollection({ videoIds: ["v1"], newCollection: candidate });
    expectBulkError(() => addVideosToCollection({ videoIds: ["v1"], newCollection: { ...candidate, name: "Different" } }), 409);
    expectBulkError(() => addVideosToCollection({ videoIds: ["v1"], collectionId: "c1", newCollection: candidate }), 400);
  });
  it.each(["", "..", "x/y", "a\nname", "a".repeat(201)])("rejects unsafe new names %#", (name) => {
    expectBulkError(() => addVideosToCollection({ videoIds: ["v1"], newCollection: { ...candidate, name } }), 400);
  });
  it("processes 500 selected videos in a library of 10,000 with a 5,000-member collection", () => {
    const insert = sqlite.prepare("INSERT INTO videos(id,title) VALUES(?,?)");
    const link = sqlite.prepare('INSERT INTO collection_videos VALUES(?,?,?)');
    sqlite.transaction(() => {
      for (let i = 0; i < 10_000; i++) {
        insert.run(`large${i}`, `Video ${i}`);
        if (i < 5_000) link.run("c1", `large${i}`, i + 10);
      }
    })();
    const ids = Array.from({ length: 500 }, (_, i) => `large${5_000 + i}`);
    const start = performance.now();
    expect(appendTagsToVideos({ videoIds: ids, tags: ["new"] }).changedVideoIds).toHaveLength(500);
    expect(addVideosToCollection({ videoIds: ids, collectionId: "c1" }).changedVideoIds).toHaveLength(500);
    expect(links()).toHaveLength(5_501);
    console.info(`Bulk benchmark: two 500-video transactions in a 10,000-video library: ${Math.round(performance.now() - start)}ms`);
  });
});
