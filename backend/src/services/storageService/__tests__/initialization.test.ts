import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, sqlite } from "../../../db";
import { MigrationError } from "../../../errors/DownloadErrors";
import { logger } from "../../../utils/logger";
import { findVideoFile } from "../fileHelpers";
import { initializeStorage } from "../initialization";

vi.mock("fs-extra", () => ({
  default: {
    ensureDirSync: vi.fn(),
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
  },
}));

vi.mock("../../../db", () => ({
  db: {
    delete: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
  sqlite: {
    prepare: vi.fn(),
  },
}));

vi.mock("../../../db/schema", () => ({
  downloads: { status: "status" },
  videos: { id: "id" },
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../fileHelpers", () => ({
  findVideoFile: vi.fn(),
}));

describe("storageService initialization", () => {
  const statusPath = "/Users/franklioxygen/Projects/mytube/backend/data/status.json";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs full migration flow, deduplicates video_downloads and populates file size", () => {
    let videosPragmaCalls = 0;
    const indexRun = vi.fn();
    const dedupeDeleteRun = vi.fn(() => ({ changes: 1 }));
    const backfillRun = vi.fn(() => ({ changes: 2 }));

    vi.mocked(sqlite.prepare).mockImplementation((sql: string) => {
      if (sql.includes("GROUP BY source_video_id, platform")) {
        return {
          all: vi.fn(() => [
            { sourceVideoId: "src-1", platform: "youtube", count: 2 },
          ]),
        } as any;
      }
      if (
        sql.includes("FROM video_downloads") &&
        sql.includes("WHERE source_video_id = ? AND platform = ?") &&
        sql.includes("ORDER BY")
      ) {
        return {
          all: vi.fn(() => [
            { id: "keep-1", status: "exists", downloadedAt: 123 },
            { id: "drop-1", status: "deleted", downloadedAt: 100 },
          ]),
        } as any;
      }
      if (sql.includes("DELETE FROM video_downloads")) {
        return { run: dedupeDeleteRun } as any;
      }
      if (sql === "PRAGMA table_info(videos)") {
        videosPragmaCalls += 1;
        if (videosPragmaCalls === 1) {
          return { all: vi.fn(() => [{ name: "id" }]) } as any;
        }
        return { all: vi.fn(() => []) } as any;
      }
      if (sql === "PRAGMA table_info(downloads)") {
        return { all: vi.fn(() => []) } as any;
      }
      if (sql === "PRAGMA table_info(subscriptions)") {
        return { all: vi.fn(() => []) } as any;
      }
      if (sql === "PRAGMA table_info(download_history)") {
        return { all: vi.fn(() => []) } as any;
      }
      if (sql.includes("UPDATE download_history")) {
        return { run: backfillRun } as any;
      }
      if (
        sql.includes("ALTER TABLE") ||
        sql.includes("CREATE TABLE") ||
        sql.includes("CREATE UNIQUE INDEX") ||
        sql.includes("CREATE INDEX")
      ) {
        return { run: indexRun } as any;
      }
      return {
        run: vi.fn(),
        all: vi.fn(() => []),
      } as any;
    });

    const activeDeleteRun = vi.fn();
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn(() => ({ run: activeDeleteRun })),
    } as any);

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        all: vi.fn(() => [
          { id: "v-mount", fileSize: null, videoPath: "mount:/abs/mounted.mp4" },
          { id: "v-name", fileSize: null, videoFilename: "name.mp4" },
          { id: "v-path", fileSize: null, videoPath: "/videos/sub/path.mp4" },
          { id: "v-skip", fileSize: "123" },
        ]),
      })),
    } as any);

    const updateRun = vi.fn();
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ run: updateRun })),
      })),
    } as any);

    vi.mocked(findVideoFile).mockReturnValue("/abs/from-find.mp4");

    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const asText = String(p);
      if (asText === statusPath) return true;
      return (
        asText.includes("/abs/mounted.mp4") ||
        asText.includes("/abs/from-find.mp4") ||
        asText.includes("/sub/path.mp4")
      );
    });
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ activeDownloads: [{ id: "x" }], queuedDownloads: [] }) as any
    );
    vi.mocked(fs.statSync).mockReturnValue({ size: 2048 } as any);

    initializeStorage();

    expect(dedupeDeleteRun).toHaveBeenCalledWith("src-1", "youtube", "keep-1");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("duplicated video_downloads groups")
    );
    expect(updateRun).toHaveBeenCalledTimes(3);
    expect(backfillRun).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Backfilled video_id")
    );
  });

  it("handles status reset/db cleanup errors, index/subscription migration skips, and stat/backfill failures", () => {
    let videosPragmaCalls = 0;
    const indexRun = vi.fn(() => {
      throw new Error("index conflict");
    });
    const backfillRun = vi.fn(() => {
      throw new Error("backfill failed");
    });

    vi.mocked(sqlite.prepare).mockImplementation((sql: string) => {
      if (sql.includes("SELECT\n        source_video_id AS sourceVideoId")) {
        return { all: vi.fn(() => []) } as any;
      }
      if (sql === "PRAGMA table_info(videos)") {
        videosPragmaCalls += 1;
        if (videosPragmaCalls === 1) {
          return { all: vi.fn(() => [{ name: "tags" }]) } as any;
        }
        return {
          all: vi.fn(() => [
            { name: "view_count" },
            { name: "progress" },
            { name: "duration" },
            { name: "file_size" },
            { name: "last_played_at" },
            { name: "subtitles" },
            { name: "description" },
            { name: "author_avatar_filename" },
            { name: "author_avatar_path" },
          ]),
        } as any;
      }
      if (sql === "PRAGMA table_info(downloads)") {
        return {
          all: vi.fn(() => [{ name: "source_url" }, { name: "type" }]),
        } as any;
      }
      if (sql === "PRAGMA table_info(subscriptions)") {
        return {
          all: vi.fn(() => {
            throw new Error("subscriptions unavailable");
          }),
        } as any;
      }
      if (sql === "PRAGMA table_info(download_history)") {
        return {
          all: vi.fn(() => [
            { name: "video_id" },
            { name: "downloaded_at" },
            { name: "deleted_at" },
          ]),
        } as any;
      }
      if (sql.includes("CREATE UNIQUE INDEX")) {
        return { run: indexRun } as any;
      }
      if (sql.includes("UPDATE download_history")) {
        return { run: backfillRun } as any;
      }
      if (sql.includes("CREATE TABLE") || sql.includes("CREATE INDEX")) {
        return { run: vi.fn() } as any;
      }
      return {
        run: vi.fn(),
        all: vi.fn(() => []),
      } as any;
    });

    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn(() => ({
        run: vi.fn(() => {
          throw new Error("active cleanup failed");
        }),
      })),
    } as any);

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn(() => ({
        all: vi.fn(() => [{ id: "v-err", fileSize: null, videoFilename: "err.mp4" }]),
      })),
    } as any);

    vi.mocked(db.update).mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ run: vi.fn() })),
      })),
    } as any);

    vi.mocked(findVideoFile).mockReturnValue("/abs/err.mp4");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => String(p) === statusPath || String(p).includes("/abs/err.mp4"));
    vi.mocked(fs.readFileSync).mockReturnValue("not-json" as any);
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error("stat failed");
    });

    initializeStorage();

    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Error clearing active downloads from database",
      expect.any(Error)
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "Subscriptions table migration skipped (table may not exist yet)",
      expect.any(Error)
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "Index creation skipped (may already exist)",
      expect.any(Error)
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to get file size for video v-err")
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Error backfilling video_id in download history",
      expect.any(Error)
    );
  });

  it("throws MigrationError when tags migration check fails", () => {
    vi.mocked(sqlite.prepare).mockImplementation((sql: string) => {
      if (sql === "PRAGMA table_info(videos)") {
        return {
          all: vi.fn(() => {
            throw new Error("tags pragma failed");
          }),
        } as any;
      }
      return { run: vi.fn(), all: vi.fn(() => []) } as any;
    });

    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn(() => ({ run: vi.fn() })),
    } as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    let thrown: unknown;
    try {
      initializeStorage();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationError);
    expect((thrown as Error).message).toContain("Failed to migrate tags column");
  });

  it("throws MigrationError when column migration block fails", () => {
    let videosPragmaCalls = 0;

    vi.mocked(sqlite.prepare).mockImplementation((sql: string) => {
      if (sql === "PRAGMA table_info(videos)") {
        videosPragmaCalls += 1;
        if (videosPragmaCalls === 1) {
          return { all: vi.fn(() => [{ name: "tags" }]) } as any;
        }
        return {
          all: vi.fn(() => {
            throw new Error("columns pragma failed");
          }),
        } as any;
      }
      return { run: vi.fn(), all: vi.fn(() => []) } as any;
    });

    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn(() => ({ run: vi.fn() })),
    } as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    let thrown: unknown;
    try {
      initializeStorage();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationError);
    expect((thrown as Error).message).toContain(
      "Failed to migrate database columns"
    );
  });
});
