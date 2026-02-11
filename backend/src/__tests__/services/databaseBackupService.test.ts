import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reinitializeDatabase as reinitDb, sqlite } from "../../db";
import * as databaseBackupService from "../../services/databaseBackupService";
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
  },
}));
vi.mock("../../db", () => ({
  reinitializeDatabase: vi.fn(),
  sqlite: {
    close: vi.fn(),
  },
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

const createValidDbHandle = () => {
  const get = vi.fn();
  const prepare = vi.fn(() => ({ get }));
  const close = vi.fn();
  return { prepare, close };
};

describe("databaseBackupService", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(fs.existsSync as any).mockReturnValue(true);
    vi.mocked(fs.readdirSync as any).mockReturnValue([]);
    vi.mocked(fs.statSync as any).mockReturnValue({ mtimeMs: 1000 });
    vi.mocked(fs.copyFileSync as any).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync as any).mockImplementation(() => undefined);
    vi.mocked(fs.unlinkSync as any).mockImplementation(() => undefined);

    vi.mocked(resolveSafePath as any).mockImplementation((input: string) => input);
    vi.mocked(isPathWithinDirectory as any).mockReturnValue(true);

    vi.mocked(crypto.randomBytes as any).mockReturnValue(Buffer.from("12345678"));
    vi.mocked(Database as any).mockImplementation(() => createValidDbHandle());
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
