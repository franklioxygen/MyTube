import { Request, Response } from "express";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearThumbnailCacheEndpoint,
  getSignedUrl,
  syncToCloud,
} from "../../controllers/cloudStorageController";
import { ValidationError } from "../../errors/DownloadErrors";
import { CloudStorageService } from "../../services/CloudStorageService";
import {
  clearThumbnailCache,
  downloadAndCacheThumbnail,
  getCachedThumbnail,
} from "../../services/cloudStorage/cloudThumbnailCache";
import { getVideos } from "../../services/storageService";
import { logger } from "../../utils/logger";

vi.mock("fs-extra");
vi.mock("../../services/storageService", () => ({
  getVideos: vi.fn(),
}));
vi.mock("../../services/CloudStorageService", () => ({
  CloudStorageService: {
    getSignedUrl: vi.fn(),
    uploadVideo: vi.fn(),
    scanCloudFiles: vi.fn(),
  },
}));
vi.mock("../../services/cloudStorage/cloudThumbnailCache", () => ({
  getCachedThumbnail: vi.fn(),
  downloadAndCacheThumbnail: vi.fn(),
  clearThumbnailCache: vi.fn(),
}));
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("cloudStorageController", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;
  let setHeaderMock: ReturnType<typeof vi.fn>;
  let writeMock: ReturnType<typeof vi.fn>;
  let endMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    setHeaderMock = vi.fn();
    writeMock = vi.fn();
    endMock = vi.fn();

    req = { query: {}, body: {} };
    res = {
      json: jsonMock,
      status: statusMock,
      setHeader: setHeaderMock,
      write: writeMock,
      end: endMock,
    };
  });

  describe("getSignedUrl", () => {
    it("should throw ValidationError when filename is missing", async () => {
      req.query = { type: "video" };
      await expect(getSignedUrl(req as Request, res as Response)).rejects.toThrow(
        ValidationError
      );
    });

    it("should throw ValidationError when type is invalid", async () => {
      req.query = { filename: "a.mp4", type: "bad-type" };
      await expect(getSignedUrl(req as Request, res as Response)).rejects.toThrow(
        ValidationError
      );
    });

    it("should return cached thumbnail if present", async () => {
      req.query = { type: "thumbnail", filename: "thumb.jpg" };
      vi.mocked(getCachedThumbnail).mockReturnValue("/cache/path/thumb-1.jpg");

      await getSignedUrl(req as Request, res as Response);

      expect(getCachedThumbnail).toHaveBeenCalledWith("cloud:thumb.jpg");
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        url: "/api/cloud/thumbnail-cache/thumb-1.jpg",
        cached: true,
      });
      expect(CloudStorageService.getSignedUrl).not.toHaveBeenCalled();
    });

    it("should return 404 when thumbnail signed url is not available", async () => {
      req.query = { type: "thumbnail", filename: "thumb.jpg" };
      vi.mocked(getCachedThumbnail).mockReturnValue(null);
      (CloudStorageService.getSignedUrl as any).mockResolvedValue(null);

      await getSignedUrl(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it("should download and return cached thumbnail url when cache miss", async () => {
      req.query = { type: "thumbnail", filename: "thumb.jpg" };
      vi.mocked(getCachedThumbnail).mockReturnValue(null);
      (CloudStorageService.getSignedUrl as any).mockResolvedValue(
        "https://signed.example/thumb.jpg"
      );
      vi.mocked(downloadAndCacheThumbnail).mockResolvedValue("/tmp/cache123.jpg");

      await getSignedUrl(req as Request, res as Response);

      expect(downloadAndCacheThumbnail).toHaveBeenCalledWith(
        "cloud:thumb.jpg",
        "https://signed.example/thumb.jpg"
      );
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        url: "/api/cloud/thumbnail-cache/cache123.jpg",
        cached: true,
      });
    });

    it("should fallback to cloud signed url when thumbnail caching fails", async () => {
      req.query = { type: "thumbnail", filename: "thumb.jpg" };
      vi.mocked(getCachedThumbnail).mockReturnValue(null);
      (CloudStorageService.getSignedUrl as any).mockResolvedValue(
        "https://signed.example/thumb.jpg"
      );
      vi.mocked(downloadAndCacheThumbnail).mockResolvedValue(null);

      await getSignedUrl(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        url: "https://signed.example/thumb.jpg",
        cached: false,
      });
    });

    it("should return video signed url for non-thumbnail type", async () => {
      req.query = { filename: "video.mp4" };
      (CloudStorageService.getSignedUrl as any).mockResolvedValue(
        "https://signed.example/video.mp4"
      );

      await getSignedUrl(req as Request, res as Response);

      expect(CloudStorageService.getSignedUrl).toHaveBeenCalledWith(
        "video.mp4",
        "video"
      );
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        url: "https://signed.example/video.mp4",
      });
    });
  });

  describe("clearThumbnailCacheEndpoint", () => {
    it("should clear cache and return success", async () => {
      await clearThumbnailCacheEndpoint(req as Request, res as Response);

      expect(clearThumbnailCache).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it("should return 500 when clear cache throws", async () => {
      vi.mocked(clearThumbnailCache).mockImplementation(() => {
        throw new Error("boom");
      });

      await clearThumbnailCacheEndpoint(req as Request, res as Response);

      expect(logger.error).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });
  });

  describe("syncToCloud", () => {
    const parseStreamMessages = () =>
      writeMock.mock.calls.map((call) => JSON.parse(String(call[0]).trim()));

    it("should stream progress and completion report", async () => {
      vi.mocked(getVideos).mockReturnValue([
        {
          id: "v1",
          title: "Video 1",
          videoPath: "/videos/video1.mp4",
          thumbnailPath: "/images/video1.jpg",
          videoFilename: "video1.mp4",
          thumbnailFilename: "video1.jpg",
        },
        {
          id: "v2",
          title: "Cloud Video",
          videoPath: "cloud:/videos/v2.mp4",
          thumbnailPath: "cloud:/images/v2.jpg",
        },
      ] as any);

      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const p = String(target);
        if (p.includes("uploads/videos/video1.mp4")) return true;
        if (p.includes("uploads/images/video1.jpg")) return true;
        if (p.endsWith("/data")) return false;
        return false;
      });

      (CloudStorageService.uploadVideo as any).mockResolvedValue(undefined);
      (CloudStorageService.scanCloudFiles as any).mockImplementation(
        async (onProgress: any) => {
          onProgress("Scanning 1/2", 1, 2);
          onProgress("Scanning 2/2", 2, 2);
          return { added: 2, errors: [] };
        }
      );

      await syncToCloud(req as Request, res as Response);

      expect(setHeaderMock).toHaveBeenCalledWith("Content-Type", "application/json");
      expect(setHeaderMock).toHaveBeenCalledWith("Transfer-Encoding", "chunked");
      expect(CloudStorageService.uploadVideo).toHaveBeenCalledTimes(1);
      expect(CloudStorageService.scanCloudFiles).toHaveBeenCalledTimes(1);
      expect(endMock).toHaveBeenCalled();

      const messages = parseStreamMessages();
      expect(messages[0]).toMatchObject({
        type: "progress",
        current: 0,
        total: 1,
      });
      expect(messages.some((m: any) => m.type === "complete")).toBe(true);
      const complete = messages.find((m: any) => m.type === "complete");
      expect(complete.report).toMatchObject({
        total: 1,
        uploaded: 1,
        failed: 0,
        cloudScanAdded: 2,
      });
    });

    it("should include upload errors in completion report", async () => {
      vi.mocked(getVideos).mockReturnValue([
        {
          id: "v1",
          title: "Video 1",
          videoPath: "/videos/video1.mp4",
          thumbnailPath: "/images/video1.jpg",
        },
      ] as any);

      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const p = String(target);
        return p.includes("uploads/videos/video1.mp4") || p.includes("uploads/images/video1.jpg");
      });

      (CloudStorageService.uploadVideo as any).mockRejectedValue(
        new Error("upload failed")
      );
      (CloudStorageService.scanCloudFiles as any).mockResolvedValue({
        added: 0,
        errors: ["scan warning"],
      });

      await syncToCloud(req as Request, res as Response);

      const messages = parseStreamMessages();
      const complete = messages.find((m: any) => m.type === "complete");
      expect(complete.report.failed).toBe(1);
      expect(complete.report.errors.join(" ")).toContain("upload failed");
      expect(complete.report.errors.join(" ")).toContain("scan warning");
    });

    it("should send error progress when unexpected failure occurs", async () => {
      vi.mocked(getVideos).mockImplementation(() => {
        throw new Error("db down");
      });

      await syncToCloud(req as Request, res as Response);

      const messages = parseStreamMessages();
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "error",
            message: expect.stringContaining("db down"),
          }),
        ])
      );
      expect(endMock).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
