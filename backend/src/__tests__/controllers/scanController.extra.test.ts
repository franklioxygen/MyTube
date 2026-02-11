import { Request, Response } from "express";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanFiles, scanMountDirectories } from "../../controllers/scanController";
import * as storageService from "../../services/storageService";
import { execFileSafe } from "../../utils/security";

vi.mock("../../services/storageService", () => ({
  getVideos: vi.fn(),
  deleteVideo: vi.fn(),
  saveVideo: vi.fn(),
  addVideoToCollection: vi.fn(),
  getCollections: vi.fn(),
  saveCollection: vi.fn(),
}));

vi.mock("../../services/tmdbService", () => ({
  scrapeMetadataFromTMDB: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../utils/helpers", () => ({
  formatVideoFilename: vi.fn((title: string, author: string, date: string) =>
    `${title}_${author}_${date}`
  ),
}));

vi.mock("../../utils/security", () => ({
  execFileSafe: vi.fn().mockResolvedValue({ stdout: "61", stderr: "" }),
  isPathWithinDirectory: vi.fn(() => true),
  resolveSafePath: vi.fn((target: string) => target),
  validateImagePath: vi.fn((target: string) => target),
}));

vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
  },
  pathExists: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  remove: vi.fn(),
  move: vi.fn(),
}));

describe("scanController extra coverage", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn(() => ({ json }));
    req = { body: {} };
    res = { status, json };

    vi.mocked(storageService.getCollections).mockReturnValue([] as any);
    vi.mocked(storageService.deleteVideo).mockReturnValue(true as any);
    vi.mocked(fs.pathExists).mockResolvedValue(true as any);
    vi.mocked(fs.readdir).mockResolvedValue([] as any);
  });

  it("scanFiles returns success message when videos directory is missing", async () => {
    vi.mocked(storageService.getVideos).mockReturnValue([] as any);
    vi.mocked(fs.pathExists).mockResolvedValue(false as any);

    await scanFiles(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Videos directory does not exist",
      })
    );
  });

  it("scanFiles deletes missing current and legacy videos", async () => {
    vi.mocked(storageService.getVideos).mockReturnValue([
      {
        id: "missing-current",
        title: "Missing Current",
        videoPath: "/videos/missing-current.mp4",
      },
      {
        id: "missing-legacy",
        title: "Missing Legacy",
        videoFilename: "missing-legacy.mp4",
        videoPath: undefined,
      },
    ] as any);

    vi.mocked(fs.pathExists).mockResolvedValue(true as any);
    vi.mocked(fs.readdir).mockResolvedValue([] as any);

    await scanFiles(req as Request, res as Response);

    expect(storageService.deleteVideo).toHaveBeenCalledWith("missing-current");
    expect(storageService.deleteVideo).toHaveBeenCalledWith("missing-legacy");
    expect(json).toHaveBeenCalledWith({ addedCount: 0, deletedCount: 2 });
  });

  it("scanMountDirectories rejects empty/missing directory list", async () => {
    req.body = {};

    await scanMountDirectories(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: "Directories array is required and must not be empty",
    });
  });

  it("scanMountDirectories rejects blank directory values", async () => {
    req.body = {
      directories: ["   ", ""],
    };

    await scanMountDirectories(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: "No valid directories provided" });
  });

  it("scanMountDirectories rejects invalid mount directories", async () => {
    req.body = {
      directories: ["../unsafe", "/tmp/ok", "/tmp/../still-bad"],
    };

    await scanMountDirectories(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Invalid mount directories detected (must be absolute safe paths)",
        invalidDirectories: ["../unsafe", "/tmp/../still-bad"],
      })
    );
  });

  it("scanMountDirectories scans mount paths and removes missing mount videos", async () => {
    req.body = {
      directories: ["/mnt/library"],
    };

    vi.mocked(storageService.getVideos).mockReturnValue([
      {
        id: "missing-mount-video",
        title: "Missing Mount",
        videoPath: "mount:/mnt/library/missing.mp4",
        fileSize: "200",
      },
    ] as any);

    vi.mocked(fs.pathExists).mockImplementation(async (target: any) => {
      const value = String(target);
      return value === "/mnt/library";
    });

    vi.mocked(fs.readdir).mockImplementation(async (target: any) => {
      if (String(target) === "/mnt/library") {
        return [
          {
            name: "new.mp4",
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ] as any;
      }
      return [] as any;
    });

    vi.mocked(fs.stat).mockResolvedValue({
      size: 100,
      birthtime: new Date("2024-01-01T00:00:00.000Z"),
    } as any);

    await scanMountDirectories(req as Request, res as Response);

    expect(execFileSafe).toHaveBeenCalled();
    expect(storageService.saveVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoPath: "mount:/mnt/library/new.mp4",
        videoFilename: "new.mp4",
        duration: "61",
        fileSize: "100",
      })
    );
    expect(storageService.deleteVideo).toHaveBeenCalledWith("missing-mount-video");
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      addedCount: 1,
      deletedCount: 1,
      scannedDirectories: 1,
    });
  });
});
