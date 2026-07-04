import { Request, Response } from "express";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    deleteVideo,
    getVideoById,
    getVideos,
    updateVideoDetails,
} from "../../controllers/videoController";
import {
    checkBilibiliCollection,
    checkBilibiliParts,
    downloadVideo,
    getDownloadStatus,
    searchVideos,
} from "../../controllers/videoDownloadController";
import { rateVideo } from "../../controllers/videoMetadataController";
import downloadManager from "../../services/downloadManager";
import * as downloadService from "../../services/downloadService";
import { isLoginRequired } from "../../services/passwordService";
import { invalidateRecommendationSignalsCache } from "../../services/recommendationSignalsService";
import * as storageService from "../../services/storageService";

vi.mock("../../db", () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
  },
  sqlite: {
    prepare: vi.fn(),
  },
}));

vi.mock("../../services/downloadService");
vi.mock("../../services/storageService");
vi.mock("../../services/recommendationSignalsService", () => ({
  invalidateRecommendationSignalsCache: vi.fn(),
}));
// isLoginRequired defaults to false (single-user mode) so existing tests are
// unaffected; visitor-visibility tests opt into login-enabled per-case.
vi.mock("../../services/passwordService", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, isLoginRequired: vi.fn(() => false) };
});
vi.mock("../../services/downloadManager");
vi.mock("../../services/metadataService");
vi.mock("../../services/statistics", () => ({
  recordEvent: vi.fn(() => null),
  normalizeSourceKind: vi.fn((value?: string | null) => value ?? "unknown"),
  normalizeSurface: vi.fn((value?: string | null) => value ?? "web"),
  platformFromUrl: vi.fn((url?: string | null) => {
    if (!url) return "unknown";
    if (url.includes("bilibili")) return "bilibili";
    if (url.includes("missav")) return "missav";
    if (url.includes("twitch")) return "twitch";
    return "youtube";
  }),
}));
vi.mock("../../services/thumbnailMirrorService", () => ({
  deleteSmallThumbnailMirrorSync: vi.fn(),
  regenerateSmallThumbnailForThumbnailPath: vi.fn(() => Promise.resolve(null)),
  resolveManagedThumbnailTarget: vi.fn((video: any, filename: string, moveWithVideo: boolean) => {
    const safeFilename = filename.split("/").pop();
    return {
      absolutePath: moveWithVideo ? `/uploads/videos/${safeFilename}` : `/uploads/images/${safeFilename}`,
      webPath: moveWithVideo ? `/videos/${safeFilename}` : `/images/${safeFilename}`,
      relativePath: safeFilename,
    };
  }),
}));
vi.mock("../../utils/security", () => ({
  validateUrl: vi.fn((url: string) => url), // Return URL as-is for tests
  validatePathWithinDirectory: vi.fn(() => true),
  validateVideoPath: vi.fn((path: string) => path),
  validateImagePath: vi.fn((path: string) => path),
  execFileSafe: vi.fn(),
  resolveSafePath: vi.fn((path: string) => path),
  pathExistsSafeSync: vi.fn((targetPath: string) => fs.existsSync(targetPath)),
  unlinkSafeSync: vi.fn((targetPath: string) => fs.unlinkSync(targetPath)),
  writeFileSafeSync: vi.fn((targetPath: string, _allowed: string, data: Buffer) =>
    fs.writeFileSync(targetPath, data)
  ),
  createReadStreamSafe: vi.fn(),
  createWriteStreamSafe: vi.fn(),
}));
vi.mock("../../utils/helpers", () => ({
  extractBilibiliVideoId: vi.fn((url: string) => url.includes("bilibili") ? "BV1xx" : null),
  isBilibiliUrl: vi.fn((url: string) => url.includes("bilibili")),
  isBilibiliShortUrl: vi.fn((url: string) => url.includes("b23.tv")),
  isMissAVUrl: vi.fn((url: string) => url.includes("missav")),
  getMissAVPlaceholderTitle: vi.fn(() => "MissAV Video"),
  isTwitchVideoUrl: vi.fn((url: string) => url.includes("twitch.tv/videos/")),
  isYouTubeUrl: vi.fn((url: string) => url.includes("youtube") || url.includes("youtu.be")),
  isValidUrl: vi.fn((url: string) => url.startsWith("http")),
  processVideoUrl: vi.fn(async (url: string) => ({
    videoUrl: url,
    sourceVideoId: url.includes("bilibili") ? "BV1xx" : "123",
    platform: url.includes("bilibili") ? "bilibili" : url.includes("missav") ? "missav" : "youtube",
  })),
  resolveShortUrl: vi.fn(async (url: string) => url),
  trimBilibiliUrl: vi.fn((url: string) => url),
}));
vi.mock("fs-extra");
vi.mock("child_process");
vi.mock("multer", () => {
  const multer = vi.fn(() => ({
    single: vi.fn(),
    array: vi.fn(),
  }));
  (multer as any).diskStorage = vi.fn(() => ({}));
  (multer as any).memoryStorage = vi.fn(() => ({}));
  return { default: multer };
});

describe("VideoController", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but not implementations; restore the
    // single-user default so a login-enabled test doesn't leak into later ones.
    vi.mocked(isLoginRequired).mockReturnValue(false);
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json, end: vi.fn() });
    req = { headers: {} };
    res = {
      json,
      status,
      set: vi.fn(),
    };
    (storageService.handleVideoDownloadCheck as any) = vi.fn().mockReturnValue({
      shouldSkip: false,
      shouldForce: false,
    });
    (storageService.checkVideoDownloadBySourceId as any) = vi.fn().mockReturnValue({
      found: false,
    });
    (storageService.getSettings as any) = vi.fn().mockReturnValue({
      dontSkipDeletedVideo: false,
    });
    (storageService.saveVideoIfAbsent as any) = vi.fn().mockReturnValue(true);
  });

  describe("searchVideos", () => {
    it("should return search results", async () => {
      req.query = { query: "test" };
      const mockResults = [{ id: "1", title: "Test" }];
      (downloadService.searchYouTube as any).mockResolvedValue(mockResults);

      await searchVideos(req as Request, res as Response);

      expect(downloadService.searchYouTube).toHaveBeenCalledWith("test", 8, 1);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ results: mockResults });
    });

    it("should return 400 if query is missing", async () => {
      req.query = {};

      req.query = {};

      // Validation errors might return 400 or 500 depending on middleware config, but usually 400 is expected for validation
      // But since we are catching validation error in test via try/catch in middleware in real app, here we are testing controller directly.
      // Wait, searchVideos does not throw ValidationError for empty query, it explicitly returns 400?
      // Let's check controller. It throws ValidationError. Middleware catches it.
      // But in this unit test we are mocking req/res. We are NOT using middleware.
      // So calling searchVideos will THROW.
      try {
        await searchVideos(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("ValidationError");
      }
    });
  });

  describe("downloadVideo", () => {
    it("should queue download for valid URL", async () => {
      req.body = { youtubeUrl: "https://youtube.com/watch?v=123" };
      (downloadManager.addDownload as any).mockResolvedValue("success");

      await downloadVideo(req as Request, res as Response);

      expect(downloadManager.addDownload).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: "Download queued" })
      );
    });

    it("should return 400 for invalid URL", async () => {
      req.body = { youtubeUrl: "not-a-url" };

      await downloadVideo(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Not a valid URL" })
      );
    });

    it("should return 400 if url is missing", async () => {
      req.body = {};
      await downloadVideo(req as Request, res as Response);
      expect(status).toHaveBeenCalledWith(400);
    });

    it("should handle Bilibili collection download", async () => {
      req.body = {
        youtubeUrl: "https://www.bilibili.com/video/BV1xx",
        downloadCollection: true,
        collectionName: "Col",
        collectionInfo: {},
      };
      (downloadService.downloadBilibiliCollection as any).mockResolvedValue({
        success: true,
        collectionId: "1",
      });

      await downloadVideo(req as Request, res as Response);

      // The actual download task runs async, we just check it queued successfully
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: "Download queued" })
      );
    });

    it("should handle Bilibili multi-part download", async () => {
      req.body = {
        youtubeUrl: "https://www.bilibili.com/video/BV1xx",
        downloadAllParts: true,
        collectionName: "Col",
      };
      (downloadService.checkBilibiliVideoParts as any).mockResolvedValue({
        success: true,
        videosNumber: 2,
        title: "Title",
      });
      (downloadService.downloadSingleBilibiliPart as any).mockResolvedValue({
        success: true,
        videoData: { id: "v1" },
      });
      (
        downloadService.downloadRemainingBilibiliParts as any
      ).mockImplementation(() => {});
      (storageService.saveCollection as any).mockImplementation(() => {});
      (storageService.atomicUpdateCollection as any).mockImplementation(
        (_id: string, fn: Function) => fn({ videos: [] })
      );

      await downloadVideo(req as Request, res as Response);

      // The actual download task runs async, we just check it queued successfully
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: "Download queued" })
      );
    });

    it("should handle MissAV download", async () => {
      req.body = { youtubeUrl: "https://missav.com/v1" };
      (downloadService.downloadMissAVVideo as any).mockResolvedValue({
        id: "v1",
      });
      (storageService.checkVideoDownloadBySourceId as any).mockReturnValue({
        found: false,
      });
      (downloadManager.addDownload as any).mockResolvedValue("success");

      await downloadVideo(req as Request, res as Response);

      // The actual download task runs async, we just check it queued successfully
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: "Download queued" })
      );
    });

    it("should handle Bilibili single part download when checkParts returns 1 video", async () => {
      req.body = {
        youtubeUrl: "https://www.bilibili.com/video/BV1xx",
        downloadAllParts: true,
      };
      (downloadService.checkBilibiliVideoParts as any).mockResolvedValue({
        success: true,
        videosNumber: 1,
        title: "Title",
      });
      (downloadService.downloadSingleBilibiliPart as any).mockResolvedValue({
        success: true,
        videoData: { id: "v1" },
      });

      await downloadVideo(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: "Download queued" })
      );
    });

    it("should handle Bilibili single part download failure", async () => {
      req.body = { youtubeUrl: "https://www.bilibili.com/video/BV1xx" };
      (downloadService.downloadSingleBilibiliPart as any).mockResolvedValue({
        success: false,
        error: "Failed",
      });
      (storageService.checkVideoDownloadBySourceId as any).mockReturnValue({
        found: false,
      });
      (storageService.getSettings as any) = vi.fn().mockReturnValue({
        dontSkipDeletedVideo: false,
      });
      (downloadManager.addDownload as any).mockResolvedValue("success");

      await downloadVideo(req as Request, res as Response);

      // Should still queue successfully even if the task itself might fail
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should handle download task errors", async () => {
      req.body = { youtubeUrl: "https://youtube.com/watch?v=123" };
      (downloadManager.addDownload as any).mockImplementation(() => {
        throw new Error("Queue error");
      });

      await downloadVideo(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Failed to queue download" })
      );
    });

    it("should handle YouTube download", async () => {
      req.body = { youtubeUrl: "https://www.youtube.com/watch?v=abc123" };
      (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
        id: "v1",
      });
      (downloadManager.addDownload as any).mockResolvedValue("success");

      await downloadVideo(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: "Download queued" })
      );
    });
  });

  describe("getVideos", () => {
    beforeEach(() => {
      (storageService.getVideosListETag as any) = vi
        .fn()
        .mockReturnValue('W/"videos-all-test-1"');
    });

    it("should return all video summaries", () => {
      const mockVideos = [{ id: "1" }];
      (storageService.getVideoSummaries as any).mockReturnValue(mockVideos);

      getVideos(req as Request, res as Response);

      expect(storageService.getVideoSummaries).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(mockVideos);
    });

    it("should scope videos to public-only when caller is a visitor", () => {
      vi.mocked(isLoginRequired).mockReturnValue(true);
      const mockVideos = [{ id: "1" }];
      (storageService.getVideoSummaries as any).mockReturnValue(mockVideos);
      req.user = { role: "visitor" } as any;

      getVideos(req as Request, res as Response);

      expect(storageService.getVideoSummaries).toHaveBeenCalledWith(
        "visitor",
        undefined
      );
      expect(storageService.getVideosListETag).toHaveBeenCalledWith("visitor");
      expect(json).toHaveBeenCalledWith(mockVideos);
    });

    it("should ignore a stale visitor role when login is disabled", () => {
      // Regression for the single-user-mode compatibility gap: when login is
      // off, a leftover visitor session must not scope the query (which would
      // wrongly hide hidden videos in single-user mode).
      vi.mocked(isLoginRequired).mockReturnValue(false);
      const mockVideos = [{ id: "1" }];
      (storageService.getVideoSummaries as any).mockReturnValue(mockVideos);
      req.user = { role: "visitor" } as any;

      getVideos(req as Request, res as Response);

      expect(storageService.getVideoSummaries).toHaveBeenCalledWith(
        undefined,
        undefined
      );
      expect(storageService.getVideosListETag).toHaveBeenCalledWith("all");
      expect(json).toHaveBeenCalledWith(mockVideos);
    });

    it("should pass an opt-in pagination window to the query layer", () => {
      (storageService.getVideoSummaries as any).mockReturnValue([]);
      req.query = { limit: "50", offset: "100" };

      getVideos(req as Request, res as Response);

      expect(storageService.getVideoSummaries).toHaveBeenCalledWith(undefined, {
        limit: 50,
        offset: 100,
      });
    });

    it("should clamp out-of-range pagination values", () => {
      (storageService.getVideoSummaries as any).mockReturnValue([]);
      req.query = { limit: "99999", offset: "not-a-number" };

      getVideos(req as Request, res as Response);

      expect(storageService.getVideoSummaries).toHaveBeenCalledWith(undefined, {
        limit: 500,
        offset: 0,
      });
    });

    it("should set the list ETag on full responses", () => {
      (storageService.getVideoSummaries as any).mockReturnValue([]);

      getVideos(req as Request, res as Response);

      expect(res.set).toHaveBeenCalledWith("ETag", 'W/"videos-all-test-1"');
      expect(res.set).toHaveBeenCalledWith("Cache-Control", "private, no-cache");
    });

    it("should answer 304 without querying when If-None-Match matches", () => {
      const end = vi.fn();
      status = vi.fn().mockReturnValue({ json, end });
      res = { json, status, set: vi.fn() };
      req.headers = { "if-none-match": 'W/"videos-all-test-1"' };

      getVideos(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(304);
      expect(end).toHaveBeenCalled();
      expect(storageService.getVideoSummaries).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
    });
  });

  describe("getVideoById", () => {
    it("should return video if found", () => {
      req.params = { id: "1" };
      const mockVideo = { id: "1" };
      (storageService.getVideoById as any).mockReturnValue(mockVideo);

      getVideoById(req as Request, res as Response);

      // Unauthenticated caller -> role undefined (admin/server-side default).
      expect(storageService.getVideoById).toHaveBeenCalledWith("1", undefined);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(mockVideo);
    });

    it("should treat hidden videos as not found for a visitor", async () => {
      vi.mocked(isLoginRequired).mockReturnValue(true);
      req.params = { id: "hidden-1" };
      req.user = { role: "visitor" } as any;
      // getVideoById returns undefined for a hidden video when role=visitor.
      (storageService.getVideoById as any).mockReturnValue(undefined);

      try {
        await getVideoById(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("NotFoundError");
      }
      expect(storageService.getVideoById).toHaveBeenCalledWith(
        "hidden-1",
        "visitor"
      );
    });

    it("should throw NotFoundError if not found", async () => {
      req.params = { id: "1" };
      (storageService.getVideoById as any).mockReturnValue(undefined);

      try {
        await getVideoById(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("NotFoundError");
      }
    });
  });

  describe("deleteVideo", () => {
    it("should delete video", () => {
      req.params = { id: "1" };
      (storageService.deleteVideo as any).mockReturnValue(true);

      deleteVideo(req as Request, res as Response);

      expect(storageService.deleteVideo).toHaveBeenCalledWith("1");
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should throw NotFoundError if delete fails", async () => {
      req.params = { id: "1" };
      (storageService.deleteVideo as any).mockReturnValue(false);

      try {
        await deleteVideo(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("NotFoundError");
      }
    });
  });

  describe("rateVideo", () => {
    it("should rate video", () => {
      req.params = { id: "1" };
      req.body = { rating: 5 };
      const mockVideo = { id: "1", rating: 5 };
      (storageService.updateVideo as any).mockReturnValue(mockVideo);

      rateVideo(req as Request, res as Response);

      expect(storageService.updateVideo).toHaveBeenCalledWith("1", {
        rating: 5,
      });
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ success: true, video: mockVideo });
    });

    it("should throw ValidationError for invalid rating", async () => {
      req.params = { id: "1" };
      req.body = { rating: 6 };

      try {
        await rateVideo(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("ValidationError");
      }
    });

    it("should throw NotFoundError if video not found", async () => {
      req.params = { id: "1" };
      req.body = { rating: 5 };
      (storageService.updateVideo as any).mockReturnValue(null);

      try {
        await rateVideo(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("NotFoundError");
      }
    });
  });

  describe("updateVideoDetails", () => {
    it("should update video details", () => {
      req.params = { id: "1" };
      req.body = { title: "New Title" };
      const mockVideo = { id: "1", title: "New Title" };
      (storageService.updateVideo as any).mockReturnValue(mockVideo);

      updateVideoDetails(req as Request, res as Response);

      expect(storageService.updateVideo).toHaveBeenCalledWith("1", {
        title: "New Title",
      });
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should update tags field", () => {
      req.params = { id: "1" };
      req.body = { tags: ["tag1", "tag2"] };
      const mockVideo = { id: "1", tags: ["tag1", "tag2"] };
      (storageService.updateVideo as any).mockReturnValue(mockVideo);

      updateVideoDetails(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(200);
    });

    it("invalidates recommendation signals when visibility changes", () => {
      req.params = { id: "1" };
      req.body = { visibility: 0 };
      const mockVideo = { id: "1", visibility: 0 };
      (storageService.updateVideo as any).mockReturnValue(mockVideo);

      updateVideoDetails(req as Request, res as Response);

      expect(invalidateRecommendationSignalsCache).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should throw NotFoundError if video not found", async () => {
      req.params = { id: "1" };
      req.body = { title: "New Title" };
      (storageService.updateVideo as any).mockReturnValue(null);

      try {
        await updateVideoDetails(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("NotFoundError");
      }
    });

    it("should throw ValidationError if no valid updates", async () => {
      req.params = { id: "1" };
      req.body = { invalid: "field" };

      try {
        await updateVideoDetails(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("ValidationError");
      }
    });
  });

  describe("checkBilibiliParts", () => {
    it("should check bilibili parts", async () => {
      req.query = { url: "https://www.bilibili.com/video/BV1xx" };
      (downloadService.checkBilibiliVideoParts as any).mockResolvedValue({
        success: true,
      });

      await checkBilibiliParts(req as Request, res as Response);

      expect(downloadService.checkBilibiliVideoParts).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should throw ValidationError if url is missing", async () => {
      req.query = {};
      try {
        await checkBilibiliParts(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("ValidationError");
      }
    });

    it("should throw ValidationError if url is invalid", async () => {
      req.query = { url: "invalid" };
      try {
        await checkBilibiliParts(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("ValidationError");
      }
    });
  });

  describe("checkBilibiliCollection", () => {
    it("should check bilibili collection", async () => {
      req.query = { url: "https://www.bilibili.com/video/BV1xx" };
      (
        downloadService.checkBilibiliCollectionOrSeries as any
      ).mockResolvedValue({ success: true });

      await checkBilibiliCollection(req as Request, res as Response);

      expect(
        downloadService.checkBilibiliCollectionOrSeries
      ).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should throw ValidationError if url is missing", async () => {
      req.query = {};
      try {
        await checkBilibiliCollection(req as Request, res as Response);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("ValidationError");
      }
    });
  });

  describe("getVideoComments", () => {
    it("should get video comments", async () => {
      req.params = { id: "1" };
      // Mock commentService dynamically since it's imported dynamically in controller
      vi.mock("../../services/commentService", () => ({
        getComments: vi.fn().mockResolvedValue([]),
      }));

      await import("../../controllers/videoController").then((m) =>
        m.getVideoComments(req as Request, res as Response)
      );

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith([]);
    });

    it("should treat a hidden video's comments as not found for a visitor", async () => {
      vi.mocked(isLoginRequired).mockReturnValue(true);
      req.params = { id: "hidden-1" };
      req.user = { role: "visitor" } as any;
      // Query-layer role filter yields undefined for a hidden id + visitor.
      (storageService.getVideoById as any).mockReturnValue(undefined);

      await expect(
        import("../../controllers/videoController").then((m) =>
          m.getVideoComments(req as Request, res as Response)
        )
      ).rejects.toMatchObject({ name: "NotFoundError" });

      expect(storageService.getVideoById).toHaveBeenCalledWith(
        "hidden-1",
        "visitor"
      );
    });
  });

  describe("uploadVideo", () => {
    it("should upload video", async () => {
      req.file = {
        filename: "vid.mp4",
        originalname: "vid.mp4",
        path: "/tmp/vid.mp4",
      } as any;
      req.body = { title: "Title" };
      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024 });
      (fs.ensureDirSync as any).mockImplementation(() => {});

      // Mock child_process.execFile to invoke callback (needed for local getVideoDuration and execFileSafe)
      const cp = await import("child_process");
      vi.mocked(cp.execFile).mockImplementation((cmd: string, fileArgs: any, maybeOptionsOrCb: any, maybeCb: any) => {
        const callback =
          typeof maybeOptionsOrCb === "function" ? maybeOptionsOrCb : maybeCb;
        if (typeof callback === "function") {
          const args = Array.isArray(fileArgs) ? fileArgs : [];
          if (cmd === "ffprobe" && args.includes("stream=codec_type")) {
            callback(null, "video\n", "");
          } else if (cmd === "ffprobe" && args.includes("format=duration")) {
            callback(null, "120", "");
          } else {
            callback(null, "", "");
          }
        }
        return {} as any;
      });

      // Set up mocks before importing the controller
      const securityUtils = await import("../../utils/security");
      vi.mocked(securityUtils.execFileSafe).mockResolvedValue({
        stdout: "",
        stderr: "",
      });
      vi.mocked(securityUtils.validateVideoPath).mockImplementation(
        (path: string) => path
      );
      vi.mocked(securityUtils.validateImagePath).mockImplementation(
        (path: string) => path
      );

      const metadataService = await import("../../services/metadataService");
      vi.mocked(metadataService.getVideoDuration).mockResolvedValue(120);

      await import("../../controllers/videoController").then((m) =>
        m.uploadVideo(req as Request, res as Response)
      );

      expect(storageService.saveVideoIfAbsent).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(201);
    });
  });

  describe("getDownloadStatus", () => {
    it("should return download status", async () => {
      (storageService.getDownloadStatus as any).mockReturnValue({
        activeDownloads: [],
        queuedDownloads: [],
      });

      await getDownloadStatus(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(200);
    });
  });
});
