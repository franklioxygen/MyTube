import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reinitializeDatabase as reinitDb, sqlite } from "../../db";
import * as databaseBackupService from "../../services/databaseBackupService";
import { invalidateSettingsCache } from "../../services/storageService/settings";
import { logger } from "../../utils/logger";
import { isPathWithinDirectory, resolveSafePath } from "../../utils/security";

vi.mock("fs-extra", () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    copyFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));
vi.mock("better-sqlite3", () => ({
  default: vi.fn(),
}));
vi.mock("crypto", () => ({
  default: {
    randomBytes: vi.fn(),
    randomUUID: vi.fn(() => "generated-uuid"),
  },
}));
vi.mock("../../db", () => ({
  reinitializeDatabase: vi.fn(),
  sqlite: {
    close: vi.fn(),
    prepare: vi.fn(),
    transaction: vi.fn((callback: () => void) => callback),
  },
}));
vi.mock("../../services/storageService/settings", () => ({
  invalidateSettingsCache: vi.fn(),
}));
vi.mock("../../utils/helpers", () => ({
  generateTimestamp: vi.fn(() => "20240101010101"),
}));
vi.mock("../../utils/security", () => ({
  resolveSafePath: vi.fn((targetPath: string) => targetPath),
  isPathWithinDirectory: vi.fn(() => true),
}));
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type TableRows = Record<string, Array<Record<string, any>>>;
type TableColumns = Record<string, string[]>;

const createStatement = ({
  allResult = [],
  getResult,
  runImpl,
}: {
  allResult?: any[];
  getResult?: any;
  runImpl?: (params?: any) => void;
} = {}) => ({
  all: vi.fn(() => allResult),
  get: vi.fn((..._args: any[]) => getResult),
  run: vi.fn((params?: any) => {
    runImpl?.(params);
    return { changes: 1 };
  }),
});

const inferTableColumns = (tables: TableRows): TableColumns =>
  Object.fromEntries(
    Object.entries(tables).map(([tableName, rows]) => [
      tableName,
      rows.length > 0 ? Object.keys(rows[0]) : [],
    ])
  );

const createSourceDbHandle = (
  tables: TableRows,
  columns: TableColumns = inferTableColumns(tables)
) => {
  const prepare = vi.fn((sql: string) => {
    if (sql.includes("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")) {
      return createStatement({
        getResult: Object.keys(tables).length > 0 ? { name: Object.keys(tables)[0] } : undefined,
      });
    }

    if (sql.includes("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")) {
      return {
        all: vi.fn(),
        run: vi.fn(),
        get: vi.fn((tableName: string) =>
          Object.prototype.hasOwnProperty.call(columns, tableName) ? { 1: 1 } : undefined
        ),
      };
    }

    const pragmaMatch = sql.match(/^PRAGMA table_info\("(.+)"\)$/);
    if (pragmaMatch) {
      const [, tableName] = pragmaMatch;
      return createStatement({
        allResult: (columns[tableName] || []).map((name) => ({ name })),
      });
    }

    if (sql === "SELECT value FROM settings WHERE key = 'tags' LIMIT 1") {
      const tagsRow = tables.settings?.find((row) => row.key === "tags");
      return createStatement({ getResult: tagsRow ? { value: tagsRow.value } : undefined });
    }

    const tableMatch = sql.match(/FROM "([^"]+)"/);
    if (sql.startsWith("SELECT") && tableMatch) {
      return createStatement({ allResult: tables[tableMatch[1]] || [] });
    }

    return createStatement();
  });

  const close = vi.fn();
  return { prepare, close };
};

const createSqlitePrepareMock = (
  tables: TableRows,
  columns: TableColumns = inferTableColumns(tables)
) =>
  vi.fn((sql: string) => {
    if (sql.includes("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")) {
      return {
        all: vi.fn(),
        run: vi.fn(),
        get: vi.fn((tableName: string) =>
          Object.prototype.hasOwnProperty.call(columns, tableName) ? { 1: 1 } : undefined
        ),
      };
    }

    const pragmaMatch = sql.match(/^PRAGMA table_info\("(.+)"\)$/);
    if (pragmaMatch) {
      const [, tableName] = pragmaMatch;
      return createStatement({
        allResult: (columns[tableName] || []).map((name) => ({ name })),
      });
    }

    if (sql === "SELECT id, source_url AS source_url FROM videos") {
      return createStatement({ allResult: tables.videos || [] });
    }

    if (sql === "SELECT id, name, title FROM collections") {
      return createStatement({ allResult: tables.collections || [] });
    }

    if (
      sql ===
      "SELECT collection_id AS collection_id, video_id AS video_id FROM collection_videos"
    ) {
      return createStatement({ allResult: tables.collection_videos || [] });
    }

    if (sql === "SELECT id, author_url AS author_url FROM subscriptions") {
      return createStatement({ allResult: tables.subscriptions || [] });
    }

    if (
      sql ===
      "SELECT id, title, source_url AS source_url, finished_at AS finished_at, status FROM download_history"
    ) {
      return createStatement({ allResult: tables.download_history || [] });
    }

    if (
      sql ===
      "SELECT id, source_video_id AS source_video_id, platform FROM video_downloads"
    ) {
      return createStatement({ allResult: tables.video_downloads || [] });
    }

    if (sql === "SELECT value FROM settings WHERE key = 'tags' LIMIT 1") {
      const tagsRow = tables.settings?.find((row) => row.key === "tags");
      return createStatement({ getResult: tagsRow ? { value: tagsRow.value } : undefined });
    }

    if (sql.startsWith("INSERT INTO")) {
      return createStatement();
    }

    return createStatement();
  });

describe("databaseBackupService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let uuidCounter = 0;

    vi.mocked(fs.existsSync as any).mockReturnValue(true);
    vi.mocked(fs.readdirSync as any).mockReturnValue([]);
    vi.mocked(fs.statSync as any).mockReturnValue({ mtimeMs: 1000 });
    vi.mocked(fs.copyFileSync as any).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync as any).mockImplementation(() => undefined);
    vi.mocked(fs.unlinkSync as any).mockImplementation(() => undefined);

    vi.mocked(resolveSafePath as any).mockImplementation((input: string) => input);
    vi.mocked(isPathWithinDirectory as any).mockReturnValue(true);

    vi.mocked(crypto.randomBytes as any).mockReturnValue(Buffer.from("12345678"));
    vi.mocked(crypto.randomUUID as any).mockImplementation(
      () => `generated-uuid-${++uuidCounter}`
    );
    vi.mocked(Database as any).mockImplementation(() =>
      createSourceDbHandle({ videos: [{ id: "db", source_url: "source" }] })
    );
    vi.mocked(sqlite.prepare as any).mockImplementation(() => createStatement());
    vi.mocked(sqlite.transaction as any).mockImplementation(
      (callback: () => void) => callback
    );
  });

  describe("exportDatabase", () => {
    it("returns db path when database exists", () => {
      vi.mocked(fs.existsSync as any).mockReturnValue(true);

      const exported = databaseBackupService.exportDatabase();

      expect(exported).toContain("mytube.db");
    });

    it("throws when database is missing", () => {
      vi.mocked(fs.existsSync as any).mockReturnValue(false);

      expect(() => databaseBackupService.exportDatabase()).toThrow(
        "Database file not found"
      );
    });
  });

  describe("importDatabase", () => {
    it("rejects invalid buffers", () => {
      expect(() => databaseBackupService.importDatabase(Buffer.alloc(0))).toThrow(
        "Invalid uploaded database file"
      );
      expect(() => databaseBackupService.importDatabase(null as any)).toThrow(
        "Invalid uploaded database file"
      );
    });

    it("rejects when resolved db path is unsafe", () => {
      vi.mocked(isPathWithinDirectory as any).mockImplementation(
        (candidate: string) => !candidate.includes("mytube.db")
      );

      expect(() =>
        databaseBackupService.importDatabase(Buffer.from("sqlite"))
      ).toThrow("Invalid database path");
    });

    it("rejects invalid sqlite uploads during validation", () => {
      vi.mocked(Database as any).mockImplementation(() => {
        throw new Error("bad sqlite");
      });

      expect(() =>
        databaseBackupService.importDatabase(Buffer.from("sqlite"))
      ).toThrow("Invalid database file");
    });

    it("imports database successfully", () => {
      databaseBackupService.importDatabase(Buffer.from("sqlite-bytes"));

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
      expect(sqlite.close).toHaveBeenCalledTimes(2);
      expect(reinitDb).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        "Closed current database connection for import"
      );
    });

    it("restores backup when replacement fails", () => {
      let copyCall = 0;
      vi.mocked(fs.copyFileSync as any).mockImplementation(() => {
        copyCall += 1;
        if (copyCall === 2) {
          throw new Error("replace failed");
        }
      });

      expect(() =>
        databaseBackupService.importDatabase(Buffer.from("sqlite-bytes"))
      ).toThrow("replace failed");

      expect(fs.copyFileSync).toHaveBeenCalledTimes(3);
      expect(logger.info).toHaveBeenCalledWith(
        "Restored database from backup after failed import"
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Database import failed:",
        expect.any(Error)
      );
    });

    it("logs restore failure when backup validation fails during rollback", () => {
      let copyCall = 0;
      vi.mocked(fs.copyFileSync as any).mockImplementation(() => {
        copyCall += 1;
        if (copyCall === 2) {
          throw new Error("replace failed");
        }
      });

      let checkCall = 0;
      vi.mocked(isPathWithinDirectory as any).mockImplementation(() => {
        checkCall += 1;
        if (checkCall === 3) {
          return false;
        }
        return true;
      });

      expect(() =>
        databaseBackupService.importDatabase(Buffer.from("sqlite-bytes"))
      ).toThrow("replace failed");

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to restore database from backup:",
        expect.any(Error)
      );
    });

    it("logs temp cleanup error if unlink fails", () => {
      vi.mocked(fs.unlinkSync as any).mockImplementation(() => {
        throw new Error("unlink failed");
      });

      databaseBackupService.importDatabase(Buffer.from("sqlite-bytes"));

      expect(logger.error).toHaveBeenCalledWith(
        "Error cleaning up temp file:",
        expect.any(Error)
      );
    });
  });

  describe("mergeDatabase", () => {
    it("merges missing records while keeping existing data", () => {
      const sourceTables = {
        videos: [
          {
            id: "source-video-existing",
            title: "Existing Source Video",
            source_url: "https://example.com/watch/existing",
            video_path: "/videos/existing.mp4",
            created_at: "2024-01-01T00:00:00.000Z",
            tags: JSON.stringify(["local", "video-only"]),
          },
          {
            id: "source-video-new",
            title: "New Source Video",
            source_url: "https://example.com/watch/new",
            video_path: "/videos/new.mp4",
            created_at: "2024-01-02T00:00:00.000Z",
            tags: JSON.stringify(["local", "video-only"]),
          },
        ],
        collections: [
          {
            id: "source-collection-existing",
            name: "Watch Later",
            title: "Watch Later",
            created_at: "2024-01-01T00:00:00.000Z",
          },
          {
            id: "collection-existing",
            name: "Imported Queue",
            title: "Imported Queue",
            created_at: "2024-01-02T00:00:00.000Z",
          },
        ],
        collection_videos: [
          {
            collection_id: "source-collection-existing",
            video_id: "source-video-existing",
            order: 1,
          },
          {
            collection_id: "collection-existing",
            video_id: "source-video-new",
            order: 2,
          },
        ],
        subscriptions: [
          {
            id: "source-subscription-existing",
            author: "Existing Author",
            author_url: "https://example.com/channel/existing",
            interval: 60,
            created_at: 1704067200000,
            collection_id: "source-collection-existing",
          },
          {
            id: "subscription-existing",
            author: "New Author",
            author_url: "https://example.com/channel/new",
            interval: 120,
            created_at: 1704153600000,
            collection_id: "collection-existing",
          },
        ],
        download_history: [
          {
            id: "source-history-existing",
            title: "Existing History",
            source_url: "https://example.com/watch/existing",
            finished_at: 1704067200000,
            status: "success",
            video_id: "source-video-existing",
            subscription_id: "source-subscription-existing",
            task_id: "task-old",
          },
          {
            id: "history-existing",
            title: "Merged History",
            source_url: "https://example.com/watch/new",
            finished_at: 1704153600000,
            status: "success",
            video_id: "source-video-new",
            subscription_id: "subscription-existing",
            task_id: "task-new",
          },
        ],
        video_downloads: [
          {
            id: "source-vd-existing",
            source_video_id: "platform-existing",
            source_url: "https://example.com/watch/existing",
            platform: "YouTube",
            video_id: "source-video-existing",
            status: "exists",
            downloaded_at: 1704067200000,
          },
          {
            id: "vd-existing",
            source_video_id: "platform-new",
            source_url: "https://example.com/watch/new",
            platform: "YouTube",
            video_id: "source-video-new",
            status: "exists",
            downloaded_at: 1704153600000,
          },
        ],
        settings: [
          {
            key: "tags",
            value: JSON.stringify(["local", "imported-setting"]),
          },
        ],
      };

      const sourceColumns = {
        videos: ["id", "title", "source_url", "video_path", "created_at", "tags"],
        collections: ["id", "name", "title", "created_at"],
        collection_videos: ["collection_id", "video_id", "order"],
        subscriptions: [
          "id",
          "author",
          "author_url",
          "interval",
          "created_at",
          "collection_id",
        ],
        download_history: [
          "id",
          "title",
          "source_url",
          "finished_at",
          "status",
          "video_id",
          "subscription_id",
          "task_id",
        ],
        video_downloads: [
          "id",
          "source_video_id",
          "source_url",
          "platform",
          "video_id",
          "status",
          "downloaded_at",
        ],
        settings: ["key", "value"],
      };

      const targetTables = {
        videos: [
          {
            id: "video-existing",
            source_url: "https://example.com/watch/existing",
          },
        ],
        collections: [
          {
            id: "collection-existing",
            name: "Watch Later",
            title: "Watch Later",
          },
        ],
        collection_videos: [
          {
            collection_id: "collection-existing",
            video_id: "video-existing",
          },
        ],
        subscriptions: [
          {
            id: "subscription-existing",
            author_url: "https://example.com/channel/existing",
          },
        ],
        download_history: [
          {
            id: "history-existing-local",
            title: "Existing History",
            source_url: "https://example.com/watch/existing",
            finished_at: 1704067200000,
            status: "success",
          },
        ],
        video_downloads: [
          {
            id: "vd-existing",
            source_video_id: "platform-existing",
            platform: "YouTube",
          },
        ],
        settings: [
          {
            key: "tags",
            value: JSON.stringify(["local"]),
          },
        ],
      };

      const targetColumns = {
        videos: ["id", "title", "source_url", "video_path", "created_at"],
        collections: ["id", "name", "title", "created_at"],
        collection_videos: ["collection_id", "video_id", "order"],
        subscriptions: [
          "id",
          "author",
          "author_url",
          "interval",
          "created_at",
          "collection_id",
        ],
        download_history: [
          "id",
          "title",
          "source_url",
          "finished_at",
          "status",
          "video_id",
          "subscription_id",
          "task_id",
        ],
        video_downloads: [
          "id",
          "source_video_id",
          "source_url",
          "platform",
          "video_id",
          "status",
          "downloaded_at",
        ],
        settings: ["key", "value"],
      };

      vi.mocked(Database as any).mockImplementation(() =>
        createSourceDbHandle(sourceTables, sourceColumns)
      );
      vi.mocked(sqlite.prepare as any).mockImplementation(
        createSqlitePrepareMock(targetTables, targetColumns)
      );

      const summary = databaseBackupService.mergeDatabase(
        Buffer.from("sqlite-bytes")
      );

      expect(summary).toEqual({
        videos: { merged: 1, skipped: 1 },
        collections: { merged: 1, skipped: 1 },
        collectionLinks: { merged: 1, skipped: 1 },
        subscriptions: { merged: 1, skipped: 1 },
        downloadHistory: { merged: 1, skipped: 1 },
        videoDownloads: { merged: 1, skipped: 1 },
        tags: { merged: 2, skipped: 1 },
      });
      expect(sqlite.transaction).toHaveBeenCalledTimes(1);
      expect(invalidateSettingsCache).toHaveBeenCalledTimes(1);
      expect(fs.copyFileSync).toHaveBeenCalledTimes(1);
    });

    it("does not deduplicate videos by local path across instances", () => {
      const sourceTables = {
        videos: [
          {
            id: "source-video-path-only",
            title: "Imported Local Video",
            source_url: null,
            video_path: "/videos/shared.mp4",
            created_at: "2024-01-03T00:00:00.000Z",
          },
        ],
      };

      const targetTables = {
        videos: [
          {
            id: "target-video-path-only",
            source_url: null,
            video_path: "/videos/shared.mp4",
          },
        ],
        settings: [],
      };

      const videoInsertRun = vi.fn(() => ({ changes: 1 }));
      vi.mocked(Database as any).mockImplementation(() =>
        createSourceDbHandle(sourceTables, {
          videos: ["id", "title", "source_url", "video_path", "created_at"],
        })
      );
      vi.mocked(sqlite.prepare as any).mockImplementation((sql: string) => {
        if (sql === "SELECT id, source_url AS source_url FROM videos") {
          return createStatement({ allResult: targetTables.videos });
        }

        if (sql.includes("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")) {
          return {
            all: vi.fn(),
            run: vi.fn(),
            get: vi.fn((tableName: string) =>
              tableName === "videos" || tableName === "settings"
                ? { 1: 1 }
                : undefined
            ),
          };
        }

        if (sql === 'PRAGMA table_info("videos")') {
          return createStatement({
            allResult: [
              { name: "id" },
              { name: "title" },
              { name: "source_url" },
              { name: "video_path" },
              { name: "created_at" },
            ],
          });
        }

        if (sql === 'PRAGMA table_info("settings")') {
          return createStatement({
            allResult: [
              { name: "key" },
              { name: "value" },
            ],
          });
        }

        if (sql.startsWith('INSERT INTO "videos"')) {
          return {
            all: vi.fn(() => []),
            get: vi.fn(),
            run: videoInsertRun,
          };
        }

        if (sql === "SELECT value FROM settings WHERE key = 'tags' LIMIT 1") {
          return createStatement({ getResult: undefined });
        }

        return createStatement();
      });

      const summary = databaseBackupService.mergeDatabase(
        Buffer.from("sqlite-bytes")
      );

      expect(summary.videos).toEqual({ merged: 1, skipped: 0 });
      expect(videoInsertRun).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "source-video-path-only",
          video_path: "/videos/shared.mp4",
        })
      );
    });

    it("rejects databases without compatible tables", () => {
      vi.mocked(Database as any).mockImplementation(() =>
        createSourceDbHandle({})
      );

      expect(() =>
        databaseBackupService.mergeDatabase(Buffer.from("sqlite-bytes"))
      ).toThrow("compatible MyTube tables");
      expect(logger.error).toHaveBeenCalledWith(
        "Database merge failed:",
        expect.any(Error)
      );
    });
  });

  describe("previewMergeDatabase", () => {
    it("summarizes the merge without mutating current data", () => {
      const sourceTables = {
        videos: [
          {
            id: "source-video-existing",
            title: "Existing Source Video",
            source_url: "https://example.com/watch/existing",
            tags: JSON.stringify(["video-tag", "shared"]),
          },
          {
            id: "source-video-new",
            title: "New Source Video",
            source_url: "https://example.com/watch/new",
            tags: JSON.stringify(["video-tag", "imported"]),
          },
        ],
        settings: [
          {
            key: "tags",
            value: JSON.stringify(["shared", "settings-tag"]),
          },
        ],
      };

      const sourceColumns = {
        videos: ["id", "title", "source_url", "tags"],
        settings: ["key", "value"],
      };

      const targetTables = {
        videos: [
          {
            id: "video-existing",
            source_url: "https://example.com/watch/existing",
          },
        ],
        settings: [
          {
            key: "tags",
            value: JSON.stringify(["shared"]),
          },
        ],
      };

      const targetColumns = {
        videos: ["id", "title", "source_url"],
        settings: ["key", "value"],
      };

      vi.mocked(Database as any).mockImplementation(() =>
        createSourceDbHandle(sourceTables, sourceColumns)
      );
      vi.mocked(sqlite.prepare as any).mockImplementation(
        createSqlitePrepareMock(targetTables, targetColumns)
      );

      const summary = databaseBackupService.previewMergeDatabase(
        Buffer.from("sqlite-bytes")
      );

      expect(summary).toEqual({
        videos: { merged: 1, skipped: 1 },
        collections: { merged: 0, skipped: 0 },
        collectionLinks: { merged: 0, skipped: 0 },
        subscriptions: { merged: 0, skipped: 0 },
        downloadHistory: { merged: 0, skipped: 0 },
        videoDownloads: { merged: 0, skipped: 0 },
        tags: { merged: 3, skipped: 1 },
      });
      expect(sqlite.transaction).not.toHaveBeenCalled();
      expect(fs.copyFileSync).not.toHaveBeenCalled();
      expect(invalidateSettingsCache).not.toHaveBeenCalled();
    });
  });

  describe("getLastBackupInfo", () => {
    it("returns exists=false when no backup files are present", () => {
      vi.mocked(fs.readdirSync as any).mockReturnValue(["readme.txt"]);

      expect(databaseBackupService.getLastBackupInfo()).toEqual({ exists: false });
    });

    it("returns latest backup file by mtime", () => {
      vi.mocked(fs.readdirSync as any).mockReturnValue([
        "mytube-backup-old.db.backup",
        "mytube-backup-new.db.backup",
      ]);
      vi.mocked(fs.statSync as any).mockImplementation((targetPath: string) => {
        if (targetPath.includes("old")) {
          return { mtimeMs: 100 };
        }
        return { mtimeMs: 900 };
      });

      const result = databaseBackupService.getLastBackupInfo();

      expect(result).toEqual({
        exists: true,
        filename: "mytube-backup-new.db.backup",
        timestamp: "new",
      });
      expect(resolveSafePath).toHaveBeenCalled();
    });
  });

  describe("restoreFromLastBackup", () => {
    it("throws when no backups are available", () => {
      vi.mocked(fs.readdirSync as any).mockReturnValue([]);

      expect(() => databaseBackupService.restoreFromLastBackup()).toThrow(
        "Backup database file not found"
      );
    });

    it("throws when backup path is unsafe", () => {
      vi.mocked(fs.readdirSync as any).mockReturnValue([
        "mytube-backup-unsafe.db.backup",
      ]);
      vi.mocked(fs.statSync as any).mockReturnValue({ mtimeMs: 500 });
      vi.mocked(isPathWithinDirectory as any).mockImplementation(
        (candidate: string) => !candidate.includes("unsafe")
      );

      expect(() => databaseBackupService.restoreFromLastBackup()).toThrow(
        "Invalid backup file path"
      );
    });

    it("throws when backup file is not a valid sqlite database", () => {
      vi.mocked(fs.readdirSync as any).mockReturnValue([
        "mytube-backup-corrupt.db.backup",
      ]);
      vi.mocked(fs.statSync as any).mockReturnValue({ mtimeMs: 500 });
      vi.mocked(Database as any).mockImplementation(() => {
        throw new Error("corrupt");
      });

      expect(() => databaseBackupService.restoreFromLastBackup()).toThrow(
        "Invalid database file"
      );
    });

    it("restores from latest backup and reinitializes DB", () => {
      vi.mocked(fs.readdirSync as any).mockReturnValue([
        "mytube-backup-ok.db.backup",
      ]);
      vi.mocked(fs.statSync as any).mockReturnValue({ mtimeMs: 500 });

      databaseBackupService.restoreFromLastBackup();

      expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
      expect(sqlite.close).toHaveBeenCalledTimes(2);
      expect(reinitDb).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Database file restored successfully")
      );
    });
  });

  describe("cleanupBackupDatabases", () => {
    it("deletes backups and records failures", () => {
      vi.mocked(fs.readdirSync as any).mockReturnValue([
        "mytube-backup-a.db.backup",
        "mytube-backup-b.db.backup",
        "note.txt",
      ]);
      vi.mocked(fs.unlinkSync as any)
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw new Error("permission denied");
        });

      const result = databaseBackupService.cleanupBackupDatabases();

      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Failed to delete mytube-backup-b.db.backup");
    });

    it("throws when listing directory fails", () => {
      vi.mocked(fs.readdirSync as any).mockImplementation(() => {
        throw new Error("disk error");
      });

      expect(() => databaseBackupService.cleanupBackupDatabases()).toThrow(
        "disk error"
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Error cleaning up backup databases:",
        expect.any(Error)
      );
    });
  });
});
