import { beforeEach, describe, expect, it, vi } from "vitest";
import { runYtDlpSafeConfigMigrationIfNeeded } from "../../services/ytDlpSafeConfigMigrationService";
import * as storageService from "../../services/storageService";
import { logger } from "../../utils/logger";

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("ytDlpSafeConfigMigrationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageService.getSettings).mockReturnValue({});
  });

  it("does nothing when migration is already applied", () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      ytDlpSafeConfigMigrationVersion: 1,
      ytDlpConfig: "--proxy http://127.0.0.1:7890",
    });

    runYtDlpSafeConfigMigrationIfNeeded();

    expect(storageService.saveSettings).not.toHaveBeenCalled();
  });

  it("migrates legacy text config into structured config and clears old text", () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      ytDlpSafeConfigMigrationVersion: 0,
      ytDlpConfig: "--proxy http://127.0.0.1:7890\n-S res:1080\n--exec echo hacked",
    });

    runYtDlpSafeConfigMigrationIfNeeded();

    expect(storageService.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ytDlpSafeConfigMigrationVersion: 1,
        ytDlpConfig: "",
        ytDlpSafeConfig: {
          proxy: "http://127.0.0.1:7890",
          maxResolution: 1080,
        },
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("rejected legacy yt-dlp options")
    );
  });

  it("normalizes existing structured config and logs when no migration is needed", () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      ytDlpSafeConfigMigrationVersion: 0,
      ytDlpSafeConfig: {
        maxResolution: 1080,
      },
      ytDlpConfig: "",
    });

    runYtDlpSafeConfigMigrationIfNeeded();

    expect(storageService.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ytDlpSafeConfigMigrationVersion: 1,
        ytDlpSafeConfig: {
          maxResolution: 1080,
        },
      })
    );
  });
});
