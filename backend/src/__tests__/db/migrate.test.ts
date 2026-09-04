import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MigrationError } from "../../errors/DownloadErrors";
import { runMigrations } from "../../db/migrate";

const migrateMock = vi.hoisted(() => vi.fn());
const configureDatabaseMock = vi.hoisted(() => vi.fn());
const runDataMigrationMock = vi.hoisted(() => vi.fn());
const migrateLegacySharedVisitorPasswordMock = vi.hoisted(() => vi.fn());
const ensureVisitorUsersTableMock = vi.hoisted(() => vi.fn());
const ensureFavoritesTablesMock = vi.hoisted(() => vi.fn());
const ensureGestureCredentialTableMock = vi.hoisted(() => vi.fn());
const sqliteGetMock = vi.hoisted(() => vi.fn());
const sqlitePrepareMock = vi.hoisted(() => vi.fn());
const securityMocks = vi.hoisted(() => ({
  accessTrustedSync: vi.fn(),
  pathExistsSafeSync: vi.fn(),
  pathExistsTrustedSync: vi.fn(),
  resolveSafePath: vi.fn(
    (filePath: string, allowedDir: string) => `${allowedDir}/${filePath}`
  ),
  statTrustedSync: vi.fn(),
  unlinkTrustedSync: vi.fn(),
  writeFileSafeSync: vi.fn(),
}));

vi.mock("drizzle-orm/better-sqlite3/migrator", () => ({
  migrate: migrateMock,
}));

vi.mock("fs", () => {
  const constants = { R_OK: 4, W_OK: 2 };
  return { constants, default: { constants } };
});

vi.mock("../../config/paths", () => ({
  COLLECTIONS_DATA_PATH: "/test/data/collections.json",
  DATA_DIR: "/test/data",
  ROOT_DIR: "/test",
  STATUS_DATA_PATH: "/test/data/status.json",
  VIDEOS_DATA_PATH: "/test/data/videos.json",
}));

vi.mock("../../utils/security", () => ({
  accessTrustedSync: securityMocks.accessTrustedSync,
  pathExistsSafeSync: securityMocks.pathExistsSafeSync,
  pathExistsTrustedSync: securityMocks.pathExistsTrustedSync,
  resolveSafePath: securityMocks.resolveSafePath,
  statTrustedSync: securityMocks.statTrustedSync,
  unlinkTrustedSync: securityMocks.unlinkTrustedSync,
  writeFileSafeSync: securityMocks.writeFileSafeSync,
}));

vi.mock("../../db", () => ({
  configureDatabase: configureDatabaseMock,
  db: {},
  sqlite: { prepare: sqlitePrepareMock },
}));

vi.mock("../../services/migrationService", () => ({
  runMigration: runDataMigrationMock,
}));

vi.mock("../../services/userService", () => ({
  migrateLegacySharedVisitorPassword: migrateLegacySharedVisitorPasswordMock,
}));

vi.mock("../../services/storageService/migrations/schemaMigrations", () => ({
  ensureVisitorUsersTable: ensureVisitorUsersTableMock,
  ensureFavoritesTables: ensureFavoritesTablesMock,
  ensureGestureCredentialTable: ensureGestureCredentialTableMock,
}));

describe("runMigrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    securityMocks.pathExistsSafeSync.mockReturnValue(true);
    securityMocks.pathExistsTrustedSync.mockReturnValue(false);
    securityMocks.writeFileSafeSync.mockImplementation(() => undefined);
    securityMocks.unlinkTrustedSync.mockImplementation(() => undefined);
    securityMocks.accessTrustedSync.mockImplementation(() => undefined);
    securityMocks.statTrustedSync.mockReturnValue({
      gid: 0,
      mode: 0o100644,
      size: 4096,
      uid: 0,
    } as any);
    // Default to a database that already holds tables, which is every existing
    // install; the misdirection guard only looks at empty ones.
    sqliteGetMock.mockReturnValue({ count: 12 });
    sqlitePrepareMock.mockReturnValue({ get: sqliteGetMock });
    delete process.env.MYTUBE_DATA_DIR;
    migrateMock.mockImplementation(() => undefined);
    configureDatabaseMock.mockImplementation(() => undefined);
    runDataMigrationMock.mockResolvedValue(undefined);
    migrateLegacySharedVisitorPasswordMock.mockResolvedValue(undefined);
    ensureVisitorUsersTableMock.mockImplementation(() => undefined);
    ensureFavoritesTablesMock.mockImplementation(() => undefined);
    ensureGestureCredentialTableMock.mockImplementation(() => undefined);
  });

  it("runs drizzle, legacy data import, and visitor password migration in order", async () => {
    await runMigrations();

    expect(migrateMock).toHaveBeenCalledTimes(1);
    expect(configureDatabaseMock).toHaveBeenCalledTimes(1);
    expect(runDataMigrationMock).toHaveBeenCalledTimes(1);
    expect(ensureVisitorUsersTableMock).toHaveBeenCalledTimes(1);
    expect(ensureFavoritesTablesMock).toHaveBeenCalledTimes(1);
    // A skipped migration batch cannot be recovered by the column
    // self-heals, so the gesture table needs its own.
    expect(ensureGestureCredentialTableMock).toHaveBeenCalledTimes(1);
    expect(migrateLegacySharedVisitorPasswordMock).toHaveBeenCalledTimes(1);
    expect(
      migrateMock.mock.invocationCallOrder[0]
    ).toBeLessThan(runDataMigrationMock.mock.invocationCallOrder[0]);
    expect(
      runDataMigrationMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      migrateLegacySharedVisitorPasswordMock.mock.invocationCallOrder[0]
    );
    // The users table must be self-healed before the legacy-password
    // migration touches it, otherwise it fails with "no such table: users".
    expect(
      ensureVisitorUsersTableMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      migrateLegacySharedVisitorPasswordMock.mock.invocationCallOrder[0]
    );
  });

  it("skips the legacy JSON data migration when skipLegacyDataMigration is set", async () => {
    await runMigrations({ skipLegacyDataMigration: true });

    // Schema migration, config, self-heals, and the visitor-password migration
    // still run — only the legacy JSON → DB import is suppressed so a database
    // import/restore cannot be overwritten by stale on-disk files.
    expect(migrateMock).toHaveBeenCalledTimes(1);
    expect(configureDatabaseMock).toHaveBeenCalledTimes(1);
    expect(ensureVisitorUsersTableMock).toHaveBeenCalledTimes(1);
    expect(ensureFavoritesTablesMock).toHaveBeenCalledTimes(1);
    // A skipped migration batch cannot be recovered by the column
    // self-heals, so the gesture table needs its own.
    expect(ensureGestureCredentialTableMock).toHaveBeenCalledTimes(1);
    expect(migrateLegacySharedVisitorPasswordMock).toHaveBeenCalledTimes(1);
    expect(runDataMigrationMock).not.toHaveBeenCalled();
  });

  it("fails fast with an actionable message when the database file is not writable", async () => {
    securityMocks.accessTrustedSync.mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    });

    let thrown: unknown;
    try {
      await runMigrations();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationError);
    expect((thrown as MigrationError).step).toBe("database_write_preflight");
    expect((thrown as MigrationError).message).toContain(
      "Database file is not writable: /test/data/mytube.db"
    );
    expect((thrown as MigrationError).message).toContain(
      "cannot update the SQLite database"
    );
    expect(migrateMock).not.toHaveBeenCalled();
  });

  it("wraps SQLITE_READONLY migration errors with the same actionable guidance", async () => {
    migrateMock.mockImplementation(() => {
      throw Object.assign(new Error("drizzle failed"), {
        cause: {
          code: "SQLITE_READONLY",
          message: "attempt to write a readonly database",
        },
      });
    });

    let thrown: unknown;
    try {
      await runMigrations();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationError);
    expect((thrown as MigrationError).step).toBe("drizzle_migrate");
    expect((thrown as MigrationError).message).toContain(
      "SQLite database is not writable: /test/data/mytube.db"
    );
    expect((thrown as MigrationError).message).toContain(
      "attempt to write a readonly database"
    );
  });

  describe("misdirected data directory guard", () => {
    const originalLegacyDataDir = process.env.MYTUBE_DATA_DIR;

    afterEach(() => {
      if (originalLegacyDataDir === undefined) {
        delete process.env.MYTUBE_DATA_DIR;
      } else {
        process.env.MYTUBE_DATA_DIR = originalLegacyDataDir;
      }
    });

    const pointLegacyVarAtAPopulatedDatabase = () => {
      process.env.MYTUBE_DATA_DIR = "/srv/host-data";
      securityMocks.pathExistsTrustedSync.mockImplementation(
        (candidate: string) => candidate === "/srv/host-data/mytube.db"
      );
    };

    it("refuses to start when the data directory is empty and MYTUBE_DATA_DIR holds the database", async () => {
      sqliteGetMock.mockReturnValue({ count: 0 });
      pointLegacyVarAtAPopulatedDatabase();

      await expect(runMigrations()).rejects.toBeInstanceOf(MigrationError);
      // Nothing may run against the wrong database, least of all migrations
      // that would fill it in and hide the mistake.
      expect(migrateMock).not.toHaveBeenCalled();
    });

    it("names both the database it found and the variable to fix", async () => {
      sqliteGetMock.mockReturnValue({ count: 0 });
      pointLegacyVarAtAPopulatedDatabase();

      await expect(runMigrations()).rejects.toThrow(
        /\/srv\/host-data\/mytube\.db[\s\S]*MYTUBE_BACKEND_DATA_DIR/
      );
    });

    it("starts normally on a first install, where no other database exists", async () => {
      sqliteGetMock.mockReturnValue({ count: 0 });
      process.env.MYTUBE_DATA_DIR = "/srv/host-data";
      securityMocks.statTrustedSync.mockImplementation((candidate: string) => {
        if (candidate === "/srv/host-data/mytube.db") {
          throw Object.assign(new Error("not found"), { code: "ENOENT" });
        }
        return { size: 4096 } as any;
      });

      await runMigrations();

      expect(migrateMock).toHaveBeenCalledTimes(1);
    });

    it("ignores a zero-byte mytube.db, which is what an abandoned directory keeps", async () => {
      sqliteGetMock.mockReturnValue({ count: 0 });
      pointLegacyVarAtAPopulatedDatabase();
      securityMocks.statTrustedSync.mockReturnValue({ size: 0 } as any);

      await runMigrations();

      expect(migrateMock).toHaveBeenCalledTimes(1);
    });

    it("refuses an ambiguous legacy relocation when the selected database also has tables", async () => {
      pointLegacyVarAtAPopulatedDatabase();

      await expect(runMigrations()).rejects.toThrow(
        /\/test\/data[\s\S]*\/srv\/host-data\/mytube\.db[\s\S]*MYTUBE_BACKEND_DATA_DIR/
      );
      expect(migrateMock).not.toHaveBeenCalled();
    });

    it("leaves a populated database alone when the legacy path has no database", async () => {
      process.env.MYTUBE_DATA_DIR = "/srv/host-data";
      securityMocks.statTrustedSync.mockImplementation((candidate: string) => {
        if (candidate === "/srv/host-data/mytube.db") {
          throw Object.assign(new Error("not found"), { code: "ENOENT" });
        }
        return { size: 4096 } as any;
      });

      await runMigrations();

      expect(migrateMock).toHaveBeenCalledTimes(1);
    });

    it("fails closed when the legacy database cannot be inspected", async () => {
      sqliteGetMock.mockReturnValue({ count: 0 });
      process.env.MYTUBE_DATA_DIR = "/srv/host-data";
      securityMocks.statTrustedSync.mockImplementation((candidate: string) => {
        if (candidate === "/srv/host-data/mytube.db") {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        }
        return { size: 4096 } as any;
      });

      await expect(runMigrations()).rejects.toThrow(
        /unable to inspect[\s\S]*\/srv\/host-data\/mytube\.db/
      );
      expect(migrateMock).not.toHaveBeenCalled();
    });

    it("recognizes an alias of the selected database by device and inode", async () => {
      process.env.MYTUBE_DATA_DIR = "/srv/data-alias";
      securityMocks.pathExistsTrustedSync.mockImplementation(
        (candidate: string) => candidate === "/srv/data-alias/mytube.db"
      );
      securityMocks.statTrustedSync.mockReturnValue({
        dev: 42,
        ino: 99,
        size: 4096,
      } as any);

      await runMigrations();

      expect(migrateMock).toHaveBeenCalledTimes(1);
    });

    it("does not block startup when the database cannot be inspected", async () => {
      sqlitePrepareMock.mockImplementation(() => {
        throw new Error("no such table: sqlite_master");
      });
      pointLegacyVarAtAPopulatedDatabase();

      await runMigrations();

      expect(migrateMock).toHaveBeenCalledTimes(1);
    });
  });
});
