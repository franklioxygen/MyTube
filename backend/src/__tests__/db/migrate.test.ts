import { beforeEach, describe, expect, it, vi } from "vitest";
import { MigrationError } from "../../errors/DownloadErrors";
import { runMigrations } from "../../db/migrate";

const migrateMock = vi.hoisted(() => vi.fn());
const configureDatabaseMock = vi.hoisted(() => vi.fn());
const runDataMigrationMock = vi.hoisted(() => vi.fn());
const securityMocks = vi.hoisted(() => ({
  accessTrustedSync: vi.fn(),
  pathExistsSafeSync: vi.fn(),
  pathExistsTrustedSync: vi.fn(),
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
  statTrustedSync: securityMocks.statTrustedSync,
  unlinkTrustedSync: securityMocks.unlinkTrustedSync,
  writeFileSafeSync: securityMocks.writeFileSafeSync,
}));

vi.mock("../../db", () => ({
  configureDatabase: configureDatabaseMock,
  db: {},
  sqlite: {},
}));

vi.mock("../../services/migrationService", () => ({
  runMigration: runDataMigrationMock,
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
      uid: 0,
    } as any);
    migrateMock.mockImplementation(() => undefined);
    configureDatabaseMock.mockImplementation(() => undefined);
    runDataMigrationMock.mockResolvedValue(undefined);
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
});
