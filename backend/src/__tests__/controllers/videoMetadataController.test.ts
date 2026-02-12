import { Request, Response } from "express";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as videoMetadataController from "../../controllers/videoMetadataController";
import { getVideoDuration } from "../../services/metadataService";
import * as storageService from "../../services/storageService";
import { logger } from "../../utils/logger";
import {
  execFileSafe,
  validateImagePath,
  validateVideoPath,
} from "../../utils/security";

vi.mock("../../services/storageService", () => ({
  getVideoById: vi.fn(),
  getVideos: vi.fn(),
  updateVideo: vi.fn(),
}));
vi.mock("../../services/metadataService", () => ({
  getVideoDuration: vi.fn(),
}));
vi.mock("../../utils/security", () => ({
  validateVideoPath: vi.fn((targetPath: string) => targetPath),
  validateImagePath: vi.fn((targetPath: string) => targetPath),
  execFileSafe: vi.fn(),
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
    existsSync: vi.fn(),
    ensureDirSync: vi.fn(),
    ensureFileSync: vi.fn(),
    pathExists: vi.fn(),
    stat: vi.fn(),
  },
}));

const createResponse = () => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { res: { status } as unknown as Response, status, json };
};

describe("videoMetadataController", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(fs.existsSync as any).mockReturnValue(true);
    vi.mocked(fs.pathExists as any).mockResolvedValue(true);
    vi.mocked(fs.stat as any).mockResolvedValue({
      isFile: () => true,
      size: 100,
    });

    vi.mocked(getVideoDuration as any).mockResolvedValue(120);
    vi.mocked(execFileSafe as any).mockResolvedValue(undefined);
  });

  describe("rateVideo", () => {
    it("updates rating when input is valid", async () => {
      const { res, status, json } = createResponse();
      vi.mocked(storageService.updateVideo as any).mockReturnValue({
        id: "v1",
        rating: 4,
      });

      await videoMetadataController.rateVideo(
        {
          params: { id: "v1" },
          body: { rating: 4 },
        } as unknown as Request,
        res
      );

      expect(storageService.updateVideo).toHaveBeenCalledWith("v1", {
        rating: 4,
      });
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        success: true,
        video: { id: "v1", rating: 4 },
      });
    });

    it("throws validation error for invalid rating", async () => {
      const { res } = createResponse();

      await expect(
        videoMetadataController.rateVideo(
          {
            params: { id: "v1" },
            body: { rating: 6 },
          } as unknown as Request,
          res
        )
      ).rejects.toThrow("Rating must be a number between 1 and 5");
    });

    it("throws not found when video does not exist", async () => {
      const { res } = createResponse();
      vi.mocked(storageService.updateVideo as any).mockReturnValue(null);

      await expect(
        videoMetadataController.rateVideo(
          {
            params: { id: "missing" },
            body: { rating: 3 },
          } as unknown as Request,
          res
        )
      ).rejects.toThrow("Video not found");
    });
  });

  describe("refreshThumbnail", () => {
    it("throws when video does not exist", async () => {
      const { res } = createResponse();
      vi.mocked(storageService.getVideoById as any).mockReturnValue(null);

      await expect(
        videoMetadataController.refreshThumbnail(
          { params: { id: "missing" } } as unknown as Request,
          res
        )
      ).rejects.toThrow("Video not found");
    });

    it("throws when video path metadata is missing", async () => {
      const { res } = createResponse();
      vi.mocked(storageService.getVideoById as any).mockReturnValue({
        id: "v1",
      });

      await expect(
        videoMetadataController.refreshThumbnail(
          { params: { id: "v1" } } as unknown as Request,
          res
        )
      ).rejects.toThrow("Video file path not found in record");
    });

    it("throws when source video file does not exist", async () => {
      const { res } = createResponse();
      vi.mocked(storageService.getVideoById as any).mockReturnValue({
        id: "v1",
        videoPath: "/videos/a.mp4",
        thumbnailPath: "/images/a.jpg",
      });
      vi.mocked(validateVideoPath as any).mockReturnValue("/safe/a.mp4");
      vi.mocked(fs.existsSync as any).mockImplementation(
        (targetPath: string) => targetPath !== "/safe/a.mp4"
      );

      await expect(
        videoMetadataController.refreshThumbnail(
          { params: { id: "v1" } } as unknown as Request,
          res
        )
      ).rejects.toThrow("Video file not found");
    });

    it("refreshes existing local thumbnail without db update", async () => {
      const { res, json } = createResponse();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456);
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

      vi.mocked(storageService.getVideoById as any).mockReturnValue({
        id: "v1",
        videoPath: "/videos/folder/video.mp4",
        thumbnailPath: "/images/folder/video.jpg",
        thumbnailFilename: "folder/video.jpg",
      });
      vi.mocked(validateVideoPath as any).mockReturnValue("/safe/video.mp4");
      vi.mocked(validateImagePath as any).mockReturnValue("/safe/video.jpg");
      vi.mocked(getVideoDuration as any).mockResolvedValue(3661);

      await videoMetadataController.refreshThumbnail(
        { params: { id: "v1" } } as unknown as Request,
        res
      );

      expect(execFileSafe).toHaveBeenCalledWith("ffmpeg", [
        "-i",
        "/safe/video.mp4",
        "-ss",
        "00:30:30",
        "-vframes",
        "1",
        "/safe/video.jpg",
        "-y",
      ]);
      expect(storageService.updateVideo).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({
        success: true,
        thumbnailUrl: "/images/folder/video.jpg?t=123456",
      });

      nowSpy.mockRestore();
      randomSpy.mockRestore();
    });

    it("creates local thumbnail path for remote thumbnail and updates db", async () => {
      const { res, json } = createResponse();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(999);

      vi.mocked(storageService.getVideoById as any).mockReturnValue({
        id: "v2",
        videoFilename: "movie.mp4",
        thumbnailPath: "https://remote/image.jpg",
      });
      vi.mocked(validateVideoPath as any).mockReturnValue("/safe/movie.mp4");
      vi.mocked(validateImagePath as any).mockReturnValue("/safe/movie.jpg");
      vi.mocked(getVideoDuration as any).mockResolvedValue(0);

      await videoMetadataController.refreshThumbnail(
        { params: { id: "v2" } } as unknown as Request,
        res
      );

      expect(storageService.updateVideo).toHaveBeenCalledWith("v2", {
        thumbnailFilename: "movie.jpg",
        thumbnailPath: "/images/movie.jpg",
        thumbnailUrl: "/images/movie.jpg",
      });
      expect(json).toHaveBeenCalledWith({
        success: true,
        thumbnailUrl: "/images/movie.jpg?t=999",
      });

      nowSpy.mockRestore();
    });

    it("falls back to default timestamp when duration lookup fails", async () => {
      const { res } = createResponse();
      vi.mocked(storageService.getVideoById as any).mockReturnValue({
        id: "v1",
        videoPath: "/videos/a.mp4",
        thumbnailPath: "/images/a.jpg",
      });
      vi.mocked(validateVideoPath as any).mockReturnValue("/safe/a.mp4");
      vi.mocked(validateImagePath as any).mockReturnValue("/safe/a.jpg");
      vi.mocked(getVideoDuration as any).mockRejectedValue(new Error("ffprobe failed"));

      await videoMetadataController.refreshThumbnail(
        { params: { id: "v1" } } as unknown as Request,
        res
      );

      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to get video duration for random thumbnail, using default 00:00:00",
        expect.any(Error)
      );
      expect(execFileSafe).toHaveBeenCalledWith(
        "ffmpeg",
        expect.arrayContaining(["-ss", "00:00:00"])
      );
    });

    it("logs and rethrows ffmpeg errors", async () => {
      const { res } = createResponse();
      vi.mocked(storageService.getVideoById as any).mockReturnValue({
        id: "v1",
        videoPath: "/videos/a.mp4",
        thumbnailPath: "/images/a.jpg",
      });
      vi.mocked(validateVideoPath as any).mockReturnValue("/safe/a.mp4");
      vi.mocked(validateImagePath as any).mockReturnValue("/safe/a.jpg");
      vi.mocked(execFileSafe as any).mockRejectedValue(new Error("ffmpeg failed"));

      await expect(
        videoMetadataController.refreshThumbnail(
          { params: { id: "v1" } } as unknown as Request,
          res
        )
      ).rejects.toThrow("ffmpeg failed");

      expect(logger.error).toHaveBeenCalledWith(
        "Error generating thumbnail:",
        expect.any(Error)
      );
    });
  });

  describe("refreshAllFileSizes", () => {
    it("updates/suppresses/fails counts across mixed sources", async () => {
      const { res, json } = createResponse();

      vi.mocked(storageService.getVideos as any).mockReturnValue([
        { id: "cloud", videoPath: "cloud:abc" },
        { id: "mount-invalid", videoPath: "mount:../escape.mp4" },
        { id: "mount-miss", videoPath: "mount:/mnt/v3.mp4" },
        { id: "bad-local", videoPath: "/videos/bad.mp4" },
        { id: "not-file", videoFilename: "v5.mp4" },
        { id: "updated", videoFilename: "v6.mp4", fileSize: "123" },
        { id: "same", videoFilename: "v7.mp4", fileSize: "777" },
        { id: "stat-fail", videoFilename: "v8.mp4" },
      ]);

      vi.mocked(validateVideoPath as any).mockImplementation((targetPath: string) => {
        if (targetPath.includes("bad.mp4")) {
          throw new Error("invalid path");
        }
        return targetPath;
      });

      vi.mocked(fs.pathExists as any).mockImplementation((targetPath: string) => {
        if (targetPath.includes("/mnt/v3.mp4")) {
          return Promise.resolve(false);
        }
        return Promise.resolve(true);
      });

      vi.mocked(fs.stat as any).mockImplementation((targetPath: string) => {
        if (targetPath.includes("v5.mp4")) {
          return Promise.resolve({ isFile: () => false, size: 10 });
        }
        if (targetPath.includes("v6.mp4")) {
          return Promise.resolve({ isFile: () => true, size: 555 });
        }
        if (targetPath.includes("v7.mp4")) {
          return Promise.resolve({ isFile: () => true, size: 777 });
        }
        if (targetPath.includes("v8.mp4")) {
          return Promise.reject(new Error("stat error"));
        }
        return Promise.resolve({ isFile: () => true, size: 1 });
      });

      await videoMetadataController.refreshAllFileSizes(
        {} as Request,
        res as Response
      );

      expect(storageService.updateVideo).toHaveBeenCalledWith("updated", {
        fileSize: "555",
      });
      expect(json).toHaveBeenCalledWith({
        success: true,
        totalCount: 8,
        updatedCount: 1,
        skippedCount: 6,
        failedCount: 1,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        "Skipping invalid video path for bad-local",
        expect.any(Error)
      );
      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to refresh file size for video stat-fail",
        expect.any(Error)
      );
    });
  });

  describe("incrementViewCount", () => {
    it("throws when video does not exist", async () => {
      const { res } = createResponse();
      vi.mocked(storageService.getVideoById as any).mockReturnValue(null);

      await expect(
        videoMetadataController.incrementViewCount(
          { params: { id: "missing" } } as unknown as Request,
          res
        )
      ).rejects.toThrow("Video not found");
    });

    it("increments view count and updates lastPlayedAt", async () => {
      const { res, json } = createResponse();
      vi.mocked(storageService.getVideoById as any).mockReturnValue({
        id: "v1",
        viewCount: 3,
      });
      vi.mocked(storageService.updateVideo as any).mockReturnValue({
        id: "v1",
        viewCount: 4,
      });

      await videoMetadataController.incrementViewCount(
        { params: { id: "v1" } } as unknown as Request,
        res
      );

      expect(storageService.updateVideo).toHaveBeenCalledWith(
        "v1",
        expect.objectContaining({ viewCount: 4, lastPlayedAt: expect.any(Number) })
      );
      expect(json).toHaveBeenCalledWith({ success: true, viewCount: 4 });
    });
  });

  describe("updateProgress", () => {
    it("validates progress type", async () => {
      const { res } = createResponse();

      await expect(
        videoMetadataController.updateProgress(
          {
            params: { id: "v1" },
            body: { progress: "bad" },
          } as unknown as Request,
          res
        )
      ).rejects.toThrow("Progress must be a number");
    });

    it("throws when updating missing video", async () => {
      const { res } = createResponse();
      vi.mocked(storageService.updateVideo as any).mockReturnValue(null);

      await expect(
        videoMetadataController.updateProgress(
          {
            params: { id: "missing" },
            body: { progress: 40 },
          } as unknown as Request,
          res
        )
      ).rejects.toThrow("Video not found");
    });

    it("updates progress and returns standardized success response", async () => {
      const { res, json } = createResponse();
      vi.mocked(storageService.updateVideo as any).mockReturnValue({
        id: "v1",
        progress: 75,
      });

      await videoMetadataController.updateProgress(
        {
          params: { id: "v1" },
          body: { progress: 75 },
        } as unknown as Request,
        res
      );

      expect(storageService.updateVideo).toHaveBeenCalledWith(
        "v1",
        expect.objectContaining({ progress: 75, lastPlayedAt: expect.any(Number) })
      );
      expect(json).toHaveBeenCalledWith({
        success: true,
        data: {
          progress: 75,
        },
      });
    });
  });
});
