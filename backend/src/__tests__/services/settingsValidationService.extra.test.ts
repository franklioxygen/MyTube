import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/storageService", () => ({
  getVideos: vi.fn(),
  updateVideo: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from "../../utils/logger";
import * as settingsValidationService from "../../services/settingsValidationService";
import * as storageService from "../../services/storageService";

describe("settingsValidationService extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validateSettings normalizes unsupported sort values", () => {
    const settings: any = { defaultSort: "not-supported" };

    settingsValidationService.validateSettings(settings);

    expect(settings.defaultSort).toBe("dateDesc");
  });

  it("processTagDeletions returns early when new tags are undefined", () => {
    settingsValidationService.processTagDeletions(["a", "b"], undefined);

    expect(storageService.getVideos).not.toHaveBeenCalled();
    expect(storageService.updateVideo).not.toHaveBeenCalled();
  });

  it("processTagDeletions preserves tags when empty list is sent while old tags exist", () => {
    settingsValidationService.processTagDeletions(["a"], []);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(storageService.getVideos).not.toHaveBeenCalled();
  });

  it("processTagDeletions removes deleted tags from matching videos", () => {
    vi.mocked(storageService.getVideos).mockReturnValue([
      { id: "v1", tags: ["a", "b"] },
      { id: "v2", tags: ["a"] },
      { id: "v3", tags: [] },
    ] as any);

    settingsValidationService.processTagDeletions(["a", "b"], ["a"]);

    expect(logger.info).toHaveBeenCalledWith("Tags deleted:", ["b"]);
    expect(storageService.updateVideo).toHaveBeenCalledWith("v1", {
      tags: ["a"],
    });
    expect(storageService.updateVideo).toHaveBeenCalledTimes(1);
  });

  it("prepareSettingsForSave rejects password updates when password login is disabled", async () => {
    const existing = {
      password: "old-hash",
      visitorPassword: "old-visitor-hash",
      passwordLoginAllowed: true,
      tags: ["a"],
      cloudflaredTunnelEnabled: true,
      cloudflaredToken: "cf-token",
      allowedHosts: ["localhost"],
    } as any;
    const hashPassword = vi.fn(async (p: string) => `hash:${p}`);

    const prepared = await settingsValidationService.prepareSettingsForSave(
      existing,
      {
        passwordLoginAllowed: false,
        password: "new-password",
      } as any,
      hashPassword
    );

    expect(hashPassword).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Password update rejected: password login is not allowed"
    );
    expect(prepared.password).toBeUndefined();
    expect(prepared.visitorPassword).toBe(existing.visitorPassword);
  });

  it("prepareSettingsForSave preserves existing password when an empty password is explicitly sent", async () => {
    const existing = {
      password: "old-hash",
      visitorPassword: "old-visitor-hash",
      tags: ["a"],
      cloudflaredTunnelEnabled: false,
      cloudflaredToken: "",
      allowedHosts: ["localhost"],
    } as any;
    const hashPassword = vi.fn(async (p: string) => `hash:${p}`);

    const prepared = await settingsValidationService.prepareSettingsForSave(
      existing,
      { password: "" } as any,
      hashPassword
    );

    expect(prepared.password).toBe("old-hash");
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("prepareSettingsForSave hashes visitor password and preserves it when empty", async () => {
    const existing = {
      password: "old-hash",
      visitorPassword: "old-visitor-hash",
      tags: ["a"],
      cloudflaredTunnelEnabled: false,
      cloudflaredToken: "",
      allowedHosts: ["localhost"],
    } as any;
    const hashPassword = vi.fn(async (p: string) => `hash:${p}`);

    const hashed = await settingsValidationService.prepareSettingsForSave(
      existing,
      { visitorPassword: "visitor-new" } as any,
      hashPassword
    );
    const preserved = await settingsValidationService.prepareSettingsForSave(
      existing,
      { visitorPassword: "" } as any,
      hashPassword
    );

    expect(hashed.visitorPassword).toBe("hash:visitor-new");
    expect(preserved.visitorPassword).toBe("old-visitor-hash");
  });

  it("prepareSettingsForSave preserves tags on empty payload in preserve mode", async () => {
    const existing = {
      password: "p",
      visitorPassword: "vp",
      tags: ["x", "y"],
      cloudflaredTunnelEnabled: true,
      cloudflaredToken: "t",
      allowedHosts: ["localhost"],
    } as any;
    const hashPassword = vi.fn(async (p: string) => `hash:${p}`);

    const prepared = await settingsValidationService.prepareSettingsForSave(
      existing,
      { tags: [] } as any,
      hashPassword
    );

    expect(prepared.tags).toEqual(["x", "y"]);
  });

  it("prepareSettingsForSave applies explicit tag changes and processes deletions", async () => {
    const existing = {
      password: "p",
      visitorPassword: "vp",
      tags: ["a", "b"],
      cloudflaredTunnelEnabled: false,
      cloudflaredToken: "",
      allowedHosts: ["localhost"],
    } as any;
    const hashPassword = vi.fn(async (p: string) => `hash:${p}`);
    vi.mocked(storageService.getVideos).mockReturnValue([
      { id: "v1", tags: ["a", "b"] },
    ] as any);

    const prepared = await settingsValidationService.prepareSettingsForSave(
      existing,
      { tags: ["a"] } as any,
      hashPassword,
      { preserveUnsetFields: false }
    );

    expect(storageService.updateVideo).toHaveBeenCalledWith("v1", { tags: ["a"] });
    expect(prepared.tags).toEqual(["a"]);
    expect(prepared.password).toBeUndefined();
    expect(prepared.visitorPassword).toBeUndefined();
  });
});
