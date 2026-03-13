import { beforeEach, describe, expect, it, vi } from "vitest";
import { isStrictSecurityModel } from "../../config/securityModel";
import { HookService } from "../../services/hookService";
import { runStrictSecurityMigrationIfNeeded } from "../../services/strictSecurityMigrationService";
import * as storageService from "../../services/storageService";
import { logger } from "../../utils/logger";

vi.mock("../../config/securityModel", () => ({
  isStrictSecurityModel: vi.fn(),
}));

vi.mock("../../services/hookService", () => ({
  HookService: {
    disableAllHooks: vi.fn(),
  },
}));

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

describe("strictSecurityMigrationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isStrictSecurityModel).mockReturnValue(false);
    vi.mocked(storageService.getSettings).mockReturnValue({});
    vi.mocked(HookService.disableAllHooks).mockReturnValue(0);
  });

  it("does nothing when strict security model is disabled", () => {
    runStrictSecurityMigrationIfNeeded();

    expect(storageService.getSettings).not.toHaveBeenCalled();
    expect(storageService.saveSettings).not.toHaveBeenCalled();
    expect(HookService.disableAllHooks).not.toHaveBeenCalled();
  });

  it("does nothing when migration is already applied", () => {
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    vi.mocked(storageService.getSettings).mockReturnValue({
      strictSecurityMigrationVersion: 1,
      ytDlpConfig: "--proxy http://127.0.0.1:7890",
    });

    runStrictSecurityMigrationIfNeeded();

    expect(HookService.disableAllHooks).not.toHaveBeenCalled();
    expect(storageService.saveSettings).not.toHaveBeenCalled();
  });

  it("applies strict migration cleanup and persists migration version", () => {
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    vi.mocked(storageService.getSettings).mockReturnValue({
      strictSecurityMigrationVersion: 0,
      ytDlpConfig: "--proxy http://127.0.0.1:7890",
      cloudflaredTunnelEnabled: true,
      mountDirectories: "/mnt/a\n/mnt/b",
    });
    vi.mocked(HookService.disableAllHooks).mockReturnValue(2);

    runStrictSecurityMigrationIfNeeded();

    expect(HookService.disableAllHooks).toHaveBeenCalledTimes(1);
    expect(storageService.saveSettings).toHaveBeenCalledWith({
      strictSecurityMigrationVersion: 1,
      ytDlpConfig: "",
      cloudflaredTunnelEnabled: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Applied v1")
    );
  });

  it("logs info when no legacy risky state is detected", () => {
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    vi.mocked(storageService.getSettings).mockReturnValue({
      strictSecurityMigrationVersion: 0,
      ytDlpConfig: "",
      cloudflaredTunnelEnabled: false,
    });

    runStrictSecurityMigrationIfNeeded();

    expect(storageService.saveSettings).toHaveBeenCalledWith({
      strictSecurityMigrationVersion: 1,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("no legacy high-risk state detected")
    );
  });
});
