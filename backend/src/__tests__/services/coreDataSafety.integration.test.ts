import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";
import fs from "fs-extra";
import nodeFs from "node:fs";
import http from "node:http";
import path from "path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// setupDataDir gives each file a scratch DB. Redirect every media path as well:
// these regressions exercise actual destructive operations, not mocked unlink.
vi.mock("../../config/paths", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/paths")>();
  const uploads = path.join(original.DATA_DIR, "uploads");
  return {
    ...original,
    UPLOADS_DIR: uploads,
    VIDEOS_DIR: path.join(uploads, "videos"),
    IMAGES_DIR: path.join(uploads, "images"),
    IMAGES_SMALL_DIR: path.join(uploads, "images-small"),
    SUBTITLES_DIR: path.join(uploads, "subtitles"),
    AVATARS_DIR: path.join(uploads, "avatars"),
    CLOUD_THUMBNAIL_CACHE_DIR: path.join(uploads, "cloud-thumbnail-cache"),
  };
});
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createTempDir } from "../../services/downloaders/bilibili/bilibiliFileManager";
import { releaseDownloadTempDir } from "../../services/downloadTempDirectories";
import { getVideoById as getVideoDetails, updateVideoDetails } from "../../controllers/videoController";
import { errorHandler } from "../../middleware/errorHandler";
import * as paths from "../../config/paths";
import { cleanupTempFiles } from "../../controllers/cleanupController";
import { exportDatabase as exportController } from "../../controllers/databaseBackupController";
import { scanFiles } from "../../controllers/scanController";
import { db, sqlite } from "../../db";
import { runAutoDeleteSweep } from "../../services/autoDeleteService";
import * as backupService from "../../services/databaseBackupService";
import { validateDatabase } from "../../services/databaseBackup/backupFiles";
import { syncMediaServerArtifactsForVideo, removeMediaServerArtifactsForVideo } from "../../services/mediaServerExport";
import { planMediaServerExportPaths } from "../../services/mediaServerExport/pathPlanner";
import * as storage from "../../services/storageService";
import type { Video } from "../../services/storageService";

function writeMedia(relative: string, content = "completed media"): string {
  const file = path.join(paths.UPLOADS_DIR, relative);
  fs.outputFileSync(file, content);
  return file;
}

function saveVideo(id: string, videoPath: string, extra: Partial<Video> = {}): Video {
  return storage.saveVideo({
    id, title: id, sourceUrl: `https://example.com/${id}`,
    videoPath, videoFilename: path.basename(videoPath),
    createdAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    ...extra,
  }, { suppressStatistics: true });
}

function responseStub() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

beforeAll(() => {
  migrate(db, { migrationsFolder: path.resolve("drizzle") });
  storage.initializeStorage();
});

beforeEach(() => {
  sqlite.exec("DELETE FROM videos; DELETE FROM downloads; DELETE FROM settings; DELETE FROM download_history; DELETE FROM video_downloads; DELETE FROM collections;");
  storage.invalidateSettingsCache();
  fs.emptyDirSync(paths.UPLOADS_DIR);
  for (const dir of [paths.VIDEOS_DIR, paths.IMAGES_DIR, paths.SUBTITLES_DIR, paths.AVATARS_DIR]) fs.ensureDirSync(dir);
});

afterAll(() => { sqlite.close(); });

describe("media deletion safety with real files and SQLite", () => {
  it("preserves root/nested temp_ libraries and referenced partial-looking artifacts", async () => {
    const rootFile = writeMedia("videos/temp_holidays/keep.mp4");
    const nestedFile = writeMedia("videos/author/temp_archive/keep.mp4");
    const referenced = writeMedia("videos/temp_holidays/protected.part");
    const partial = writeMedia("videos/temp_holidays/abandoned.mp4.part");
    const journal = writeMedia("videos/author/temp_archive/abandoned.ytdl");
    saveVideo("root", "/videos/temp_holidays/keep.mp4", { autoDeleteLocked: 1 });
    saveVideo("nested", "/videos/author/temp_archive/keep.mp4", {
      subtitles: [{ filename: "protected.part", path: "/videos/temp_holidays/protected.part", language: "en" }],
    });

    const res = responseStub();
    await cleanupTempFiles({} as never, res as never);

    for (const file of [rootFile, nestedFile, referenced]) expect(fs.readFileSync(file, "utf8")).toBe("completed media");
    for (const file of [partial, journal]) expect(fs.existsSync(file)).toBe(false);
    expect(res.json).toHaveBeenCalledWith({ deletedCount: 2 });
  });

  it("cleans marked abandoned jobs but preserves active, referenced and unmarked directories", async () => {
    const abandoned = createTempDir();
    fs.outputFileSync(path.join(abandoned, "nested/unfinished.mp4"), "data");
    releaseDownloadTempDir(abandoned);
    const active = createTempDir();
    fs.outputFileSync(path.join(active, "active.part"), "data");
    const referenced = createTempDir();
    fs.outputFileSync(path.join(referenced, "keep.mp4"), "data");
    saveVideo("registered-temp", `/videos/${path.basename(referenced)}/keep.mp4`);
    releaseDownloadTempDir(referenced);
    const unmarked = "temp_1700000000000_12345678-1234-1234-1234-123456789012";
    const userMedia = writeMedia(`videos/${unmarked}/keep.mp4`);
    try {
      await cleanupTempFiles({} as never, responseStub() as never);
      expect(fs.existsSync(abandoned)).toBe(false);
      expect(fs.existsSync(path.join(active, "active.part"))).toBe(true);
      expect(fs.existsSync(path.join(referenced, "keep.mp4"))).toBe(true);
      expect(fs.existsSync(userMedia)).toBe(true);
    } finally { releaseDownloadTempDir(active); }
  });

  it("does not let malformed tags or an invalid avatar path block unrelated deletion", () => {
    const media = writeMedia("videos/remove.mp4");
    const avatar = writeMedia("avatars/shared.jpg");
    saveVideo("remove", "/videos/remove.mp4", {
      author: "A", authorAvatarPath: "/avatars/shared.jpg", authorAvatarFilename: "shared.jpg",
    });
    saveVideo("other", "/videos/other.mp4", {
      author: "B", authorAvatarPath: "/avatars/../../outside.jpg", authorAvatarFilename: "shared.jpg",
    });
    sqlite.prepare("UPDATE videos SET tags = ? WHERE id = ?").run("invalid json", "other");
    expect(storage.deleteVideo("remove")).toBe(true);
    expect(fs.existsSync(media)).toBe(false);
    expect(fs.existsSync(avatar)).toBe(true);
  });

  it("blocks redownload cleanup on unreadable owners and checks the actual candidate across aliases", () => {
    const media = writeMedia("videos/group/shared.mp4");
    const thumbnail = writeMedia("images/shared.jpg");
    const old = saveVideo("old", "/videos/group/shared.mp4", { thumbnailPath: "/images/shared.jpg", thumbnailFilename: "shared.jpg" });
    saveVideo("owner", "", { videoFilename: "shared.mp4", thumbnailPath: "/images/folder/../shared.jpg", thumbnailFilename: "shared.jpg" });
    expect(storage.isVideoFileReferencedByOtherVideo(old, old.id, media)).toBe(true);
    expect(storage.isVideoFileReferencedByOtherVideo({ ...old, videoPath: undefined, videoFilename: undefined }, old.id, media)).toBe(true);
    expect(storage.isThumbnailReferencedByOtherVideo(old, old.id, thumbnail)).toBe(true);
    saveVideo("broken-owner", "/videos/broken.mp4");
    sqlite.prepare("UPDATE videos SET subtitles = ? WHERE id = ?").run('{"unexpected":"object"}', "broken-owner");
    expect(() => storage.isVideoFileReferencedByOtherVideo(old, old.id, media)).toThrow(/broken-owner.*subtitles/);
    expect(() => storage.isThumbnailReferencedByOtherVideo(old, old.id, thumbnail)).toThrow(/broken-owner.*subtitles/);
    expect(fs.existsSync(media)).toBe(true);
    expect(fs.existsSync(thumbnail)).toBe(true);
  });

  it("deletes a missing record without selecting another owner's matching basenames", () => {
    const media = writeMedia("videos/ChannelB/same.mp4");
    const thumbnail = writeMedia("images/same.jpg");
    const subtitle = writeMedia("subtitles/same.en.vtt");
    saveVideo("missing", "/videos/ChannelA/same.mp4", {
      thumbnailFilename: "same.jpg", thumbnailPath: "/images/old/same.jpg",
      subtitles: [{ filename: "same.en.vtt", path: "/subtitles/old/same.en.vtt", language: "en" }],
    });
    saveVideo("keep", "/videos/ChannelB/same.mp4", { autoDeleteLocked: 1 });

    expect(storage.deleteVideo("missing")).toBe(true);
    expect(storage.getVideoById("missing")).toBeUndefined();
    expect(storage.getVideoById("keep")).toBeDefined();
    for (const file of [media, thumbnail, subtitle]) expect(fs.existsSync(file)).toBe(true);
  });

  it("rescans a missing entry without destroying the surviving video", async () => {
    const media = writeMedia("videos/ChannelB/same.mp4");
    saveVideo("missing", "/videos/ChannelA/same.mp4");
    saveVideo("keep", "/videos/ChannelB/same.mp4", { fileSize: String(fs.statSync(media).size) });
    const res = responseStub();

    await scanFiles({} as never, res as never);

    expect(fs.existsSync(media)).toBe(true);
    expect(storage.getVideoById("keep")).toBeDefined();
    expect(storage.getVideoById("missing")).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith({ addedCount: 0, deletedCount: 1 });
  });

  it("keeps shared media, thumbnails, subtitles, avatars and sidecars through auto-delete until the last owner goes", async () => {
    const files = [writeMedia("videos/shared/file.mp4"), writeMedia("images/shared.jpg"),
      writeMedia("subtitles/shared.en.vtt"), writeMedia("avatars/shared.jpg")];
    const shared = {
      thumbnailPath: "/images/shared.jpg", thumbnailFilename: "shared.jpg",
      authorAvatarPath: "/avatars/shared.jpg", authorAvatarFilename: "shared.jpg",
      subtitles: [{ path: "/subtitles/shared.en.vtt", filename: "shared.en.vtt", language: "en" }],
    };
    const old = saveVideo("old", "/videos/shared/file.mp4", { ...shared, author: "Old Author" });
    saveVideo("locked", "/videos/shared/file.mp4", { ...shared, author: "Other Author", autoDeleteLocked: 1 });
    const plan = planMediaServerExportPaths(old)!;
    for (const file of [plan.episodeNfoAbsolutePath, plan.episodeSourceJsonAbsolutePath, plan.episodeThumbAliasAbsolutePath]) {
      fs.outputFileSync(file, "sidecar");
      files.push(file);
    }
    storage.saveSettings({ autoDeleteEnabled: true, autoDeleteIntervalDays: 30 });

    const result = await runAutoDeleteSweep();

    expect(result.deletedVideos).toBe(1);
    expect(storage.getVideoById("old")).toBeUndefined();
    expect(storage.getVideoById("locked")?.autoDeleteLocked).toBe(1);
    for (const file of files) expect(fs.existsSync(file), file).toBe(true);
    expect(storage.deleteVideo("locked")).toBe(true);
    for (const file of files) expect(fs.existsSync(file), file).toBe(false);
  });

  it("preserves shared sidecars during redownload with export disabled and skips removal on read failure", () => {
    const old = saveVideo("redownload", "/videos/shared/episode.mp4");
    saveVideo("other-container", "/videos/shared/episode.mkv");
    const sidecar = planMediaServerExportPaths(old)!.episodeNfoAbsolutePath;
    fs.outputFileSync(sidecar, "historical sidecar");
    storage.updateVideo(old.id, { videoPath: "/videos/new/episode.mp4" });
    storage.saveSettings({ mediaServerExportMode: "off" });
    removeMediaServerArtifactsForVideo(old, { preserveSharedArtifacts: true });
    expect(fs.existsSync(sidecar)).toBe(true);
    sqlite.prepare("UPDATE videos SET subtitles = ? WHERE id = ?").run("broken", "other-container");
    removeMediaServerArtifactsForVideo(old, { preserveSharedArtifacts: true });
    expect(fs.existsSync(sidecar)).toBe(true);
    sqlite.prepare("UPDATE videos SET subtitles = NULL, video_path = ? WHERE id = ?").run("/videos/elsewhere/episode.mkv", "other-container");
    removeMediaServerArtifactsForVideo(old, { preserveSharedArtifacts: true });
    expect(fs.existsSync(sidecar)).toBe(false);
  });

  it("protects a legacy basename-only owner and permits deletion of an unshared legacy file", () => {
    const shared = writeMedia("videos/group/shared.mp4");
    saveVideo("explicit", "/videos/group/shared.mp4");
    saveVideo("legacy-owner", "", { videoFilename: "shared.mp4" });
    storage.deleteVideo("explicit");
    expect(fs.existsSync(shared)).toBe(true);

    const own = writeMedia("videos/legacy.mp4");
    saveVideo("legacy", "", { videoFilename: "legacy.mp4" });
    expect(storage.deleteVideo("legacy")).toBe(true);
    expect(fs.existsSync(own)).toBe(false);
  });

  it("does not confuse identical relative paths under different media roots", () => {
    const own = writeMedia("videos/same.jpg");
    const other = writeMedia("images/same.jpg");
    saveVideo("own", "/videos/a.mp4", { thumbnailFilename: "same.jpg", thumbnailPath: "/videos/same.jpg" });
    saveVideo("other", "/videos/b.mp4", { thumbnailFilename: "same.jpg", thumbnailPath: "/images/same.jpg" });
    storage.deleteVideo("own");
    expect(fs.existsSync(own)).toBe(false);
    expect(fs.existsSync(other)).toBe(true);
  });

  it("fails closed before deleting files when another owner's metadata cannot be read", () => {
    const media = writeMedia("videos/keep.mp4");
    saveVideo("keep", "/videos/keep.mp4");
    saveVideo("malformed", "/videos/other.mp4");
    sqlite.prepare("UPDATE videos SET subtitles = ? WHERE id = ?").run("invalid json", "malformed");
    expect(() => storage.deleteVideo("keep")).toThrow(/video malformed has invalid subtitles/);
    expect(fs.existsSync(media)).toBe(true);
    expect(storage.getVideoById("keep")).toBeDefined();
  });
});

describe("SQLite snapshot export and import integrity", () => {
  it("handles a real client disconnect without a second response and releases its snapshot", async () => {
    sqlite.exec("CREATE TABLE disconnect_probe (payload BLOB); INSERT INTO disconnect_probe VALUES (zeroblob(4000000))");
    const cleanup = vi.spyOn(backupService, "cleanupDatabaseExport");
    const errors: Error[] = [];
    const app = express();
    app.get("/export", exportController);
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      errors.push(err);
      errorHandler(err, req, res, next);
    });
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address() as { port: number };
      await new Promise<void>((resolve, reject) => {
        http.get(`http://127.0.0.1:${address.port}/export`, (res) => {
          res.once("data", () => { res.destroy(); resolve(); });
          res.on("error", () => {});
        }).on("error", reject);
      });
      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
      expect(fs.existsSync(cleanup.mock.calls[0][0])).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      cleanup.mockRestore();
      sqlite.exec("DROP TABLE disconnect_probe");
    }
  });

  it("streams a consistent snapshot while the live database changes, then removes the snapshot", async () => {
    sqlite.exec("CREATE TABLE export_probe (id INTEGER PRIMARY KEY, payload BLOB)");
    const add = sqlite.prepare("INSERT INTO export_probe VALUES (?, ?)");
    sqlite.transaction(() => {
      for (let i = 0; i < 1000; i++) add.run(i, Buffer.alloc(6000, 65));
    })();
    let servedPath = "";
    let mutated = false;
    const originalReadStream = nodeFs.createReadStream;
    const streamSpy = vi.spyOn(nodeFs, "createReadStream").mockImplementation((file, options) => {
      const isExport = typeof file === "string" &&
        (path.basename(file).startsWith("export-") || file === path.join(paths.DATA_DIR, "mytube.db"));
      const stream = originalReadStream(file, isExport ? { ...(typeof options === "object" ? options : {}), highWaterMark: 4096 } : options);
      if (isExport) {
        servedPath = String(file);
        stream.once("data", () => { sqlite.exec("DELETE FROM export_probe"); mutated = true; });
      }
      return stream;
    });
    try {
      const app = express();
      app.get("/export", exportController);
      const response = await request(app).get("/export").buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
        res.on("error", done);
      });
      expect(response.status).toBe(200);
      expect(mutated).toBe(true);
      expect(response.body.length).toBe(Number(response.headers["content-length"]));
      const received = path.join(paths.DATA_DIR, "received.db");
      fs.writeFileSync(received, response.body);
      const exported = new Database(received, { readonly: true });
      try {
        expect(exported.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
        expect(exported.prepare("SELECT count(*) AS n FROM export_probe").get()).toEqual({ n: 1000 });
      } finally { exported.close(); }
      expect(sqlite.prepare("SELECT count(*) AS n FROM export_probe").get()).toEqual({ n: 0 });
      expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
      expect(fs.existsSync(servedPath)).toBe(false);
    } finally {
      streamSpy.mockRestore();
      sqlite.exec("DROP TABLE export_probe");
    }
  });

  it("gives simultaneous exports separate immutable files", async () => {
    saveVideo("saved", "/videos/saved.mp4");
    const snapshots = await Promise.all([backupService.exportDatabase(), backupService.exportDatabase()]);
    try {
      expect(new Set(snapshots).size).toBe(2);
      storage.updateVideo("saved", { title: "changed" });
      for (const file of snapshots) {
        const snapshot = new Database(file, { readonly: true });
        try {
          expect(snapshot.prepare("SELECT title FROM videos WHERE id = 'saved'").get()).toEqual({ title: "saved" });
          expect(snapshot.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
        } finally { snapshot.close(); }
      }
    } finally { snapshots.forEach(backupService.cleanupDatabaseExport); }
  });

  it("rejects a corrupt file with a readable schema before replacing the current database", async () => {
    saveVideo("keep", "/videos/keep.mp4");
    const fixture = path.join(paths.DATA_DIR, "corrupt.db");
    const source = new Database(fixture);
    source.exec("CREATE TABLE probe (payload BLOB); INSERT INTO probe VALUES (zeroblob(200000)); DELETE FROM probe;");
    source.close();
    const corrupt = fs.readFileSync(fixture);
    // Lose the freelist pointers while leaving sqlite_master and its schema
    // readable, reproducing the mixed-revision export's allocation corruption.
    corrupt.writeUInt32BE(0, 32);
    corrupt.writeUInt32BE(0, 36);
    fs.writeFileSync(fixture, corrupt);
    const readable = new Database(fixture, { readonly: true });
    try { expect(readable.prepare("SELECT name FROM sqlite_master LIMIT 1").get()).toEqual({ name: "probe" }); }
    finally { readable.close(); }

    expect(() => validateDatabase(fixture)).toThrow("Invalid database file");
    await expect(backupService.importDatabase(corrupt)).rejects.toThrow("Invalid database file");
    expect(storage.getVideoById("keep")).toBeDefined();
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(fs.readdirSync(paths.DATA_DIR).filter((name) => name.startsWith("import-"))).toEqual([]);
  });
});

describe("consistent media export with damaged library records", () => {
  it("uses healthy episodes for single, bulk, and rebuild exports without sweeping damaged owners", async () => {
    storage.saveSettings({ mediaServerExportMode: "nfo" });
    const older = "/videos/Show/Season 01/s01e01 - Older.mp4";
    const current = "/videos/Show/Season 01/s01e02 - Current.mp4";
    for (const media of [older, current, "/videos/damaged.mp4"]) writeMedia(media.slice(1));
    saveVideo("older", older, { date: "20260101", author: "Author" });
    saveVideo("current", current, { date: "20260201", author: "Author" });
    saveVideo("damaged", "/videos/damaged.mp4");
    sqlite.exec("UPDATE videos SET subtitles='broken' WHERE id='damaged'");
    const preservedNfo = writeMedia("videos/damaged.nfo", "<!-- Generated by MyTube -->\n<episodedetails />");
    const showNfo = path.join(paths.VIDEOS_DIR, "Show/tvshow.nfo");
    syncMediaServerArtifactsForVideo("current");
    const expected = fs.readFileSync(showNfo, "utf8");
    expect(expected).toContain("<premiered>2026-01-01</premiered>");
    const { queueBulkArtifactRefresh } = await import("../../services/mediaServerExport/bulkArtifactRefresh");
    queueBulkArtifactRefresh(["current", "damaged"]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fs.readFileSync(showNfo, "utf8")).toBe(expected);
    const { startMediaServerExportJob } = await import("../../services/mediaServerExport/jobService");
    const job = await startMediaServerExportJob("nfo");
    for (let i = 0; i < 100 && job.status === "running"; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(job.status).toBe("completed");
    expect(job.succeeded).toBe(2);
    expect(fs.readFileSync(showNfo, "utf8")).toBe(expected);
    expect(fs.readFileSync(preservedNfo, "utf8")).toContain("<episodedetails />");
  });
  it("continues the bulk queue after a real per-record sidecar write fails", async () => {
    storage.saveSettings({ mediaServerExportMode: "nfo" });
    for (const id of ["unwritable", "healthy"]) {
      writeMedia(`videos/${id}.mp4`);
      saveVideo(id, `/videos/${id}.mp4`);
    }
    const originalRename = fs.renameSync;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      if (String(destination).endsWith("/unwritable.nfo")) throw new Error("simulated filesystem failure");
      return originalRename(source, destination);
    });
    try {
      const { queueBulkArtifactRefresh } = await import("../../services/mediaServerExport/bulkArtifactRefresh");
      queueBulkArtifactRefresh(["unwritable", "healthy"]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fs.existsSync(path.join(paths.VIDEOS_DIR, "unwritable.nfo"))).toBe(false);
      expect(fs.readFileSync(path.join(paths.VIDEOS_DIR, "healthy.nfo"), "utf8")).toContain("<episodedetails>");
    } finally { rename.mockRestore(); }
  });
});

describe("video metadata API validation and legacy-read compatibility", () => {
  function videoApi() {
    const app = express();
    app.use(express.json());
    app.get("/api/videos/:id", getVideoDetails);
    app.put("/api/videos/:id", updateVideoDetails);
    app.use(errorHandler);
    return app;
  }
  it.each([[1], [null], ["ok", 1], "bad", null, { tag: "bad" }].map((tags) => ({ tags })))("rejects invalid tag updates before changing any fields: %j", async ({ tags }) => {
    saveVideo("tagged", "cloud:tagged", { title: "Original", tags: ["old"] });
    const response = await request(videoApi()).put("/api/videos/tagged").send({ title: "Changed", tags });
    expect(response.status).toBe(400);
    expect(storage.getVideoById("tagged")).toMatchObject({ title: "Original", tags: ["old"] });
  });
  it.each(['[1]', '[null]', '["valid",1,null]'])("can read, edit and repair legacy tag arrays: %s", async (storedTags) => {
    saveVideo("legacy", "cloud:legacy", { sourceUrl: "https://example.test/legacy" });
    sqlite.prepare("UPDATE videos SET tags=? WHERE id='legacy'").run(storedTags);
    const app = videoApi();
    const expected = storedTags.includes('"valid"') ? ["valid"] : [];
    const read = await request(app).get("/api/videos/legacy");
    expect(read.status).toBe(200);
    expect(read.body.tags).toEqual(expected);
    expect(storage.getVideoBySourceUrl("https://example.test/legacy")?.id).toBe("legacy");
    const edit = await request(app).put("/api/videos/legacy").send({ title: "Still editable" });
    expect(edit.status).toBe(200);
    expect(edit.body.video.tags).toEqual(expected);
    expect(sqlite.prepare("SELECT tags FROM videos WHERE id='legacy'").get()).toEqual({ tags: storedTags });
    const repair = await request(app).put("/api/videos/legacy").send({ tags: ["repaired"] });
    expect(repair.status).toBe(200);
    expect((await request(app).get("/api/videos/legacy")).body.tags).toEqual(["repaired"]);
    const clear = await request(app).put("/api/videos/legacy").send({ tags: [] });
    expect(clear.status).toBe(200);
    expect(storage.getVideoById("legacy")?.tags).toEqual([]);
  });
  it.each([
    null, "bad", {}, [null], [1], [[]], [{}], [{ path: 1 }], [{ filename: false }],
    [{ path: "/subtitles/good.vtt", filename: 1 }],
    [{ filename: "good.vtt", path: {} }],
    [{ filename: "good.vtt" }, null],
  ].map((subtitles) => ({ subtitles })))("rejects invalid subtitles without persisting any update: %j", async ({ subtitles }) => {
    const old = [{ filename: "old.vtt", path: "/subtitles/old.vtt", language: "en" }];
    saveVideo("subtitled", "cloud:subtitled", { title: "Original", tags: ["old"], subtitles: old });
    const before = sqlite.prepare("SELECT title, tags, subtitles FROM videos WHERE id='subtitled'").get();
    const app = videoApi();
    const rejected = await request(app).put("/api/videos/subtitled").send({ title: "Changed", tags: ["changed"], subtitles });
    expect(rejected.status).toBe(400);
    expect(sqlite.prepare("SELECT title, tags, subtitles FROM videos WHERE id='subtitled'").get()).toEqual(before);
    const read = await request(app).get("/api/videos/subtitled");
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ title: "Original", tags: ["old"], subtitles: old });
  });
  it.each([
    [], [{ filename: "only.vtt" }], [{ path: "/subtitles/only.vtt" }],
    [{ filename: "both.vtt", path: "/subtitles/both.vtt", language: "zh" }],
  ].map((subtitles) => ({ subtitles })))("accepts readable subtitle arrays including clearing: %j", async ({ subtitles }) => {
    saveVideo("subtitled", "cloud:subtitled", { subtitles: [{ filename: "old.vtt", path: "/subtitles/old.vtt", language: "en" }] });
    const app = videoApi();
    const update = await request(app).put("/api/videos/subtitled").send({ subtitles });
    expect(update.status).toBe(200);
    expect(update.body.video.subtitles).toEqual(subtitles);
    const read = await request(app).get("/api/videos/subtitled");
    expect(read.status).toBe(200);
    expect(read.body.subtitles).toEqual(subtitles);
  });
  it("repairs already damaged subtitle metadata without first reading the row", async () => {
    saveVideo("damaged-subtitles", "cloud:damaged-subtitles");
    sqlite.prepare("UPDATE videos SET subtitles='[null]' WHERE id='damaged-subtitles'").run();
    const app = videoApi();
    const repair = await request(app).put("/api/videos/damaged-subtitles").send({ subtitles: [] });
    expect(repair.status).toBe(200);
    expect((await request(app).get("/api/videos/damaged-subtitles")).status).toBe(200);
  });
});
