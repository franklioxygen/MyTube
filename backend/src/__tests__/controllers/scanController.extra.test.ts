/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIDEOS_DIR } from "../../config/paths";
import { scanFiles, scanMountDirectories } from "../../controllers/scanController";
import * as storageService from "../../services/storageService";
import { scrapeMetadataFromTMDB } from "../../services/tmdbService";
import {
  execFileSafe,
  isPathWithinDirectory,
  resolveSafePath,
} from "../../utils/security";

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

  it("scanFiles skips entries outside directory, symlinks and non-video extensions", async () => {
    vi.mocked(storageService.getVideos).mockReturnValue([] as any);

    vi.mocked(fs.pathExists).mockResolvedValue(true as any);
    vi.mocked(isPathWithinDirectory).mockImplementation((target: string) => {
      return !String(target).includes("outside");
    });
    vi.mocked(fs.readdir).mockImplementation(async (target: any) => {
      if (String(target) === VIDEOS_DIR) {
        return [
          {
            name: "../outside.mp4",
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
          {
            name: "link.mp4",
            isDirectory: () => false,
            isSymbolicLink: () => true,
          },
          {
            name: "note.txt",
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ] as any;
      }
      return [] as any;
    });

    await scanFiles(req as Request, res as Response);

    expect(storageService.saveVideo).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ addedCount: 0, deletedCount: 0 });
  });

  it("scanFiles skips 0-byte videos", async () => {
    vi.mocked(storageService.getVideos).mockReturnValue([] as any);
    vi.mocked(fs.pathExists).mockResolvedValue(true as any);
    vi.mocked(fs.readdir).mockImplementation(async () => {
      return [
        {
          name: "zero.mp4",
          isDirectory: () => false,
          isSymbolicLink: () => false,
        },
      ] as any;
    });
    vi.mocked(fs.stat).mockResolvedValue({
      size: 0,
      birthtime: new Date("2024-01-01T00:00:00.000Z"),
    } as any);

    await scanFiles(req as Request, res as Response);

    expect(storageService.saveVideo).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ addedCount: 0, deletedCount: 0 });
  });

  it("scanFiles should still save video and create collection when TMDB scraping fails", async () => {
    vi.mocked(storageService.getVideos).mockReturnValue([] as any);
    vi.mocked(storageService.getCollections).mockReturnValue([] as any);
    vi.mocked(scrapeMetadataFromTMDB).mockRejectedValue(
      new Error("tmdb unavailable")
    );
    vi.mocked(fs.pathExists).mockResolvedValue(true as any);
    vi.mocked(fs.readdir).mockImplementation(async (target: any) => {
      const current = String(target);
      if (current === VIDEOS_DIR) {
        return [
          {
            name: "Action",
            isDirectory: () => true,
            isSymbolicLink: () => false,
          },
        ] as any;
      }
      if (current === path.join(VIDEOS_DIR, "Action")) {
        return [
          {
            name: "movie.mp4",
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ] as any;
      }
      return [] as any;
    });
    vi.mocked(fs.stat).mockResolvedValue({
      size: 2048,
      birthtime: new Date("2020-02-02T00:00:00.000Z"),
    } as any);
    vi.mocked(execFileSafe).mockResolvedValue({ stdout: "88", stderr: "" } as any);

    await scanFiles(req as Request, res as Response);

    expect(storageService.saveVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoFilename: "movie.mp4",
        videoPath: "/videos/Action/movie.mp4",
      })
    );
    expect(storageService.saveCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Action",
        name: "Action",
      })
    );
    const savedCollection = vi.mocked(storageService.saveCollection).mock.calls[0][0] as any;
    expect(storageService.addVideoToCollection).toHaveBeenCalledWith(
      savedCollection.id,
      expect.any(String)
    );
    expect(status).toHaveBeenCalledWith(200);
  });

  it("scanFiles continues when local safe path resolution fails", async () => {
    vi.mocked(storageService.getVideos).mockReturnValue([] as any);
    vi.mocked(fs.pathExists).mockResolvedValue(true as any);
    vi.mocked(resolveSafePath).mockImplementation((target: string) => {
      if (String(target).endsWith(".mp4")) {
        throw new Error("unsafe local path");
      }
      return target;
    });
    vi.mocked(fs.readdir).mockResolvedValue([
      {
        name: "safe.mp4",
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
    ] as any);
    vi.mocked(fs.stat).mockResolvedValue({
      size: 1024,
      birthtime: new Date("2021-01-01T00:00:00.000Z"),
    } as any);

    await scanFiles(req as Request, res as Response);

    expect(storageService.saveVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoFilename: "safe.mp4",
      })
    );
  });

  it("scanMountDirectories handles missing directories and malformed existing mount paths", async () => {
    req.body = {
      directories: ["/mnt/missing"],
    };
    vi.mocked(storageService.getVideos).mockReturnValue([
      {
        id: "no-path",
        title: "No Path",
      },
      {
        id: "malformed",
        title: "Malformed",
        videoPath: "mount:\0bad-path",
      },
      {
        id: "outside",
        title: "Outside",
        videoPath: "mount:/mnt/other/video.mp4",
      },
    ] as any);
    vi.mocked(fs.pathExists).mockResolvedValue(false as any);

    await scanMountDirectories(req as Request, res as Response);

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      addedCount: 0,
      deletedCount: 0,
      scannedDirectories: 1,
    });
  });

  it("scanMountDirectories rejects null-byte paths in request", async () => {
    req.body = {
      directories: ["/mnt/\0bad"],
    };

    await scanMountDirectories(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Invalid mount directories detected (must be absolute safe paths)",
      })
    );
  });
});
