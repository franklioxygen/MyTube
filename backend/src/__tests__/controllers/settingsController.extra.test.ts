import { Request, Response } from "express";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatFilenames,
  getCloudflaredStatus,
  patchSettings,
  renameTag,
  updateSettings,
} from "../../controllers/settingsController";
import { cloudflaredService } from "../../services/cloudflaredService";
import downloadManager from "../../services/downloadManager";
import * as settingsValidationService from "../../services/settingsValidationService";
import * as storageService from "../../services/storageService";
import { logger } from "../../utils/logger";

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  formatLegacyFilenames: vi.fn(),
}));

vi.mock("../../services/settingsValidationService", () => ({
  mergeSettings: vi.fn(),
  validateSettings: vi.fn(),
  prepareSettingsForSave: vi.fn(),
}));

vi.mock("../../services/passwordService", () => ({
  hashPassword: vi.fn(async (password: string) => `hashed-${password}`),
}));

vi.mock("../../services/cloudflaredService", () => ({
  cloudflaredService: {
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    getStatus: vi.fn(() => ({ running: true, tunnelUrl: "https://x" })),
  },
}));

vi.mock("../../services/downloadManager", () => ({
  default: {
    setMaxConcurrentDownloads: vi.fn(),
  },
}));

vi.mock("../../services/subtitleService", () => ({
  moveAllSubtitles: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../services/thumbnailService", () => ({
  moveAllThumbnails: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../services/tagService", () => ({
  renameTag: vi.fn(),
  deleteTagsFromVideos: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    writeFileSync: vi.fn(),
  },
  writeFileSync: vi.fn(),
}));

const flushAsyncImports = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("settingsController extra coverage", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  const existingSettings = {
    loginEnabled: true,
    tags: ["OldTag", "KeepTag"],
    moveSubtitlesToVideoFolder: false,
    moveThumbnailsToVideoFolder: false,
    cloudflaredTunnelEnabled: false,
    cloudflaredToken: "",
    allowedHosts: "localhost",
    maxConcurrentDownloads: 2,
    theme: "light",
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();

    json = vi.fn();
    status = vi.fn(() => ({ json }));
    req = { body: {}, user: { role: "admin" } as any };
    res = { json, status } as any;

    vi.mocked(storageService.getSettings).mockReturnValue(existingSettings);
    vi.mocked(storageService.formatLegacyFilenames).mockReturnValue({
      renamed: 3,
      skipped: 1,
    } as any);

    vi.mocked(settingsValidationService.mergeSettings).mockImplementation(
      (base: any, incoming: any) => ({ ...base, ...incoming })
    );
    vi.mocked(settingsValidationService.validateSettings).mockImplementation(
      () => undefined
    );
    vi.mocked(settingsValidationService.prepareSettingsForSave).mockResolvedValue(
      {}
    );
  });

  it("formatFilenames returns legacy formatting results", async () => {
    await formatFilenames(req as Request, res as Response);

    expect(storageService.formatLegacyFilenames).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({ results: { renamed: 3, skipped: 1 } });
  });

  it("getCloudflaredStatus returns service status payload", async () => {
    await getCloudflaredStatus(req as Request, res as Response);

    expect(cloudflaredService.getStatus).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({ running: true, tunnelUrl: "https://x" });
  });

  it("renameTag validates required inputs and identical values", async () => {
    req.body = { oldTag: "", newTag: "new" };
    await renameTag(req as Request, res as Response);
    expect(status).toHaveBeenCalledWith(400);

    req.body = { oldTag: "same", newTag: "same" };
    await renameTag(req as Request, res as Response);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("renameTag blocks case-insensitive collisions", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      ...existingSettings,
      tags: ["Work", "study"],
    } as any);
    req.body = { oldTag: "Work", newTag: "STUDY" };

    await renameTag(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("conflicts") })
    );
  });

  it("renameTag delegates to tag service on success", async () => {
    const tagService = await import("../../services/tagService");
    vi.mocked(tagService.renameTag).mockReturnValue({ updated: 5 } as any);
    req.body = { oldTag: "OldTag", newTag: "FreshTag" };

    await renameTag(req as Request, res as Response);

    expect(tagService.renameTag).toHaveBeenCalledWith("OldTag", "FreshTag");
    expect(json).toHaveBeenCalledWith({ success: true, result: { updated: 5 } });
  });

  it("updateSettings applies tag mutations, moves assets, writes env and starts cloudflared", async () => {
    const tagService = await import("../../services/tagService");
    const subtitleService = await import("../../services/subtitleService");
    const thumbnailService = await import("../../services/thumbnailService");

    req.body = {
      tags: ["oldtag"],
      moveSubtitlesToVideoFolder: true,
      moveThumbnailsToVideoFolder: true,
      cloudflaredTunnelEnabled: true,
      cloudflaredToken: "",
      allowedHosts: "abc.com\n<script>",
      maxConcurrentDownloads: 7,
      password: "should-not-persist",
      visitorPassword: "also-drop",
    };

    await updateSettings(req as Request, res as Response);
    await flushAsyncImports();

    expect(storageService.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ["oldtag"],
      })
    );
    const savedSettings = vi.mocked(storageService.saveSettings).mock.calls[0][0] as any;
    expect(savedSettings.password).toBeUndefined();
    expect(savedSettings.visitorPassword).toBeUndefined();

    expect(tagService.renameTag).toHaveBeenCalledWith("OldTag", "oldtag");
    expect(tagService.deleteTagsFromVideos).toHaveBeenCalledWith(["KeepTag"]);
    expect(subtitleService.moveAllSubtitles).toHaveBeenCalledWith(true);
    expect(thumbnailService.moveAllThumbnails).toHaveBeenCalledWith(true);

    expect(cloudflaredService.start).toHaveBeenCalledWith(undefined, 5551);
    expect(downloadManager.setMaxConcurrentDownloads).toHaveBeenCalledWith(7);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("frontend/.env.local"),
      expect.stringContaining("VITE_ALLOWED_HOSTS=abc.comscript"),
      "utf8"
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        settings: expect.objectContaining({
          password: undefined,
          visitorPassword: undefined,
        }),
      })
    );
  });

  it("patchSettings persists only patch fields and keeps merged output", async () => {
    req.body = { theme: "dark" };

    await patchSettings(req as Request, res as Response);

    expect(storageService.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "dark" })
    );
    const saved = vi.mocked(storageService.saveSettings).mock.calls[0][0] as any;
    expect(saved.tags).toBeUndefined();

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        settings: expect.objectContaining({
          theme: "dark",
          loginEnabled: true,
        }),
      })
    );
  });

  it("updateSettings stops cloudflared when disabled", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      ...existingSettings,
      cloudflaredTunnelEnabled: true,
    } as any);
    req.body = { cloudflaredTunnelEnabled: false };

    await updateSettings(req as Request, res as Response);

    expect(cloudflaredService.stop).toHaveBeenCalledTimes(1);
  });

  it("updateSettings restarts cloudflared with token when token changes", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      ...existingSettings,
      cloudflaredTunnelEnabled: true,
      cloudflaredToken: "old-token",
    } as any);
    req.body = { cloudflaredToken: "new-token" };

    await updateSettings(req as Request, res as Response);

    expect(cloudflaredService.restart).toHaveBeenCalledWith("new-token");
  });

  it("warns instead of throwing when allowedHosts env write fails", async () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("disk full");
    });
    req.body = { allowedHosts: "dev.local" };

    await patchSettings(req as Request, res as Response);

    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to write allowedHosts to .env.local:",
      expect.any(Error)
    );
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
