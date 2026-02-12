/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkBilibiliCollection,
  checkBilibiliParts,
  checkPlaylist,
  checkVideoDownloadStatus,
  downloadVideo,
  getDownloadStatus,
  searchVideos,
} from "../../controllers/videoDownloadController";
import { ValidationError } from "../../errors/DownloadErrors";
import downloadManager from "../../services/downloadManager";
import * as downloadService from "../../services/downloadService";
import * as storageService from "../../services/storageService";
import {
  extractBilibiliVideoId,
  isBilibiliShortUrl,
  isBilibiliUrl,
  isMissAVUrl,
  isYouTubeUrl,
  isValidUrl,
  processVideoUrl,
  resolveShortUrl,
  trimBilibiliUrl,
} from "../../utils/helpers";
import { validateUrl } from "../../utils/security";

vi.mock("../../services/downloadManager", () => ({
  default: {
    addDownload: vi.fn(),
    updateTaskTitle: vi.fn(),
  },
}));

vi.mock("../../services/downloadService", () => ({
  searchYouTube: vi.fn(),
  checkBilibiliVideoParts: vi.fn(),
  checkBilibiliCollectionOrSeries: vi.fn(),
  downloadBilibiliCollection: vi.fn(),
  downloadSingleBilibiliPart: vi.fn(),
  downloadRemainingBilibiliParts: vi.fn(),
  downloadMissAVVideo: vi.fn(),
  downloadYouTubeVideo: vi.fn(),
  getVideoInfo: vi.fn(),
  checkPlaylist: vi.fn(),
}));

vi.mock("../../services/storageService", () => ({
  checkVideoDownloadBySourceId: vi.fn(),
  verifyVideoExists: vi.fn(),
  getVideoById: vi.fn(),
  getSettings: vi.fn(),
  handleVideoDownloadCheck: vi.fn(),
  addDownloadHistoryItem: vi.fn(),
  getActiveDownload: vi.fn(),
  updateActiveDownloadTitle: vi.fn(),
  addActiveDownload: vi.fn(),
  getVideoBySourceUrl: vi.fn(),
  getCollectionByVideoId: vi.fn(),
  getCollectionByName: vi.fn(),
  saveCollection: vi.fn(),
  getCollectionById: vi.fn(),
  atomicUpdateCollection: vi.fn(),
  getDownloadStatus: vi.fn(),
}));

vi.mock("../../utils/helpers", () => ({
  extractBilibiliVideoId: vi.fn(),
  isBilibiliShortUrl: vi.fn(),
  isBilibiliUrl: vi.fn(),
  isMissAVUrl: vi.fn(),
  isYouTubeUrl: vi.fn(),
  isValidUrl: vi.fn(),
  processVideoUrl: vi.fn(),
  resolveShortUrl: vi.fn(),
  trimBilibiliUrl: vi.fn((url: string) => url),
}));

vi.mock("../../utils/security", () => ({
  validateUrl: vi.fn((url: string) => url),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const flushBackgroundTasks = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("videoDownloadController extra coverage", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;
  const setupMultipartDownloadWithResolvedCollectionName = () => {
    req.body = {
      youtubeUrl: "https://www.bilibili.com/video/BVdownload",
      downloadAllParts: true,
      collectionName: "Collection With Download",
    };
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://www.bilibili.com/video/BVdownload",
      sourceVideoId: "bv-download",
      platform: "bilibili",
    } as any);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(extractBilibiliVideoId).mockReturnValue("BVdownload");
    vi.mocked(downloadService.checkBilibiliVideoParts).mockResolvedValue({
      success: true,
      videosNumber: 3,
      title: "Parts Title",
    } as any);
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue(undefined);
    vi.mocked(storageService.getCollectionByVideoId).mockReturnValue(null as any);
    vi.mocked(storageService.getCollectionByName).mockReturnValue({
      id: "col-download",
      name: "Resolved Collection Name",
      videos: [],
    } as any);
    vi.mocked(storageService.getCollectionById).mockReturnValue({
      id: "col-download",
      name: "Resolved Collection Name",
      videos: [],
    } as any);
    vi.mocked(storageService.getActiveDownload).mockReturnValue(undefined);
    vi.mocked(downloadService.downloadSingleBilibiliPart).mockResolvedValue({
      success: true,
      videoData: { id: "part-new" },
    } as any);
    vi.mocked(storageService.atomicUpdateCollection).mockImplementation(
      (_id: string, updater: any) => updater({ videos: [] })
    );
    vi.mocked(downloadService.downloadRemainingBilibiliParts).mockRejectedValue(
      new Error("remaining failed")
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    json = vi.fn();
    status = vi.fn(() => ({ json }));
    req = {
      query: {},
      body: {},
    };
    res = {
      status,
      json,
      send: vi.fn(),
    } as any;

    vi.mocked(isValidUrl).mockReturnValue(true);
    vi.mocked(isYouTubeUrl).mockReturnValue(false);
    vi.mocked(isBilibiliUrl).mockReturnValue(false);
    vi.mocked(isMissAVUrl).mockReturnValue(false);
    vi.mocked(isBilibiliShortUrl).mockReturnValue(false);
    vi.mocked(trimBilibiliUrl).mockImplementation((url: string) => url);
    vi.mocked(resolveShortUrl).mockImplementation(async (url: string) => url);
    vi.mocked(validateUrl).mockImplementation((url: string) => url);
    vi.mocked(storageService.getSettings).mockReturnValue({
      dontSkipDeletedVideo: false,
    } as any);
    vi.mocked(storageService.handleVideoDownloadCheck).mockReturnValue({
      shouldSkip: false,
      response: null,
    } as any);
    vi.mocked(downloadManager.addDownload).mockImplementation(
      async (task: any) => task(vi.fn())
    );
    vi.mocked(downloadService.getVideoInfo).mockResolvedValue({
      title: "Fetched Title",
    } as any);
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://youtube.com/watch?v=abc",
      sourceVideoId: "yt-1",
      platform: "youtube",
    } as any);
  });

  it("searchVideos validates query and forwards limit/offset", async () => {
    req.query = { query: "music", limit: "12", offset: "3" } as any;
    vi.mocked(downloadService.searchYouTube).mockResolvedValue([{ id: "v1" }] as any);

    await searchVideos(req as Request, res as Response);

    expect(downloadService.searchYouTube).toHaveBeenCalledWith("music", 12, 3);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ results: [{ id: "v1" }] });
  });

  it("checkVideoDownloadStatus handles invalid URL validation", async () => {
    req.query = { url: "http://bad" } as any;
    vi.mocked(validateUrl).mockImplementation(() => {
      throw new Error("Blocked URL");
    });

    await expect(
      checkVideoDownloadStatus(req as Request, res as Response)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("checkVideoDownloadStatus throws when url is missing", async () => {
    req.query = {} as any;

    await expect(
      checkVideoDownloadStatus(req as Request, res as Response)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("checkVideoDownloadStatus returns deleted status when verification updates check", async () => {
    req.query = { url: "http://ok" } as any;
    vi.mocked(processVideoUrl).mockResolvedValue({
      sourceVideoId: "id-1",
      platform: "youtube",
    } as any);
    vi.mocked(storageService.checkVideoDownloadBySourceId).mockReturnValue({
      found: true,
      status: "exists",
      title: "Old",
      author: "A",
      downloadedAt: "2026-01-01",
    } as any);
    vi.mocked(storageService.verifyVideoExists).mockReturnValue({
      updatedCheck: {
        title: "Deleted",
        author: "A",
        downloadedAt: "2026-01-01",
      },
    } as any);

    await checkVideoDownloadStatus(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({
      found: true,
      status: "deleted",
      title: "Deleted",
      author: "A",
      downloadedAt: "2026-01-01",
    });
  });

  it("checkVideoDownloadStatus returns exists with file paths", async () => {
    req.query = { url: "http://ok" } as any;
    vi.mocked(processVideoUrl).mockResolvedValue({
      sourceVideoId: "id-2",
      platform: "youtube",
    } as any);
    vi.mocked(storageService.checkVideoDownloadBySourceId).mockReturnValue({
      found: true,
      status: "exists",
      videoId: "video-2",
      title: "Title",
      author: "Author",
      downloadedAt: "2026-01-02",
    } as any);
    vi.mocked(storageService.verifyVideoExists).mockReturnValue({
      exists: true,
      video: {
        id: "video-2",
        title: "Stored Title",
        author: "Stored Author",
        videoPath: "/videos/v2.mp4",
        thumbnailPath: "/images/v2.jpg",
      },
    } as any);

    await checkVideoDownloadStatus(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        found: true,
        status: "exists",
        videoId: "video-2",
        videoPath: "/videos/v2.mp4",
      })
    );
  });

  it("checkVideoDownloadStatus returns found false when source id cannot be extracted", async () => {
    req.query = { url: "http://ok" } as any;
    vi.mocked(processVideoUrl).mockResolvedValue({ sourceVideoId: null } as any);

    await checkVideoDownloadStatus(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({ found: false });
  });

  it("checkVideoDownloadStatus returns stored status when verification does not find a file", async () => {
    req.query = { url: "http://ok" } as any;
    vi.mocked(processVideoUrl).mockResolvedValue({
      sourceVideoId: "id-fallback",
      platform: "youtube",
    } as any);
    vi.mocked(storageService.checkVideoDownloadBySourceId).mockReturnValue({
      found: true,
      status: "deleted",
      title: "Gone",
      author: "Tester",
      downloadedAt: "2026-01-03",
      deletedAt: "2026-01-04",
    } as any);
    vi.mocked(storageService.verifyVideoExists).mockReturnValue({
      exists: false,
      video: null,
      updatedCheck: null,
    } as any);

    await checkVideoDownloadStatus(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({
      found: true,
      status: "deleted",
      title: "Gone",
      author: "Tester",
      downloadedAt: "2026-01-03",
      deletedAt: "2026-01-04",
    });
  });

  it("downloadVideo returns bad request for missing URL", async () => {
    req.body = {};

    await downloadVideo(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: "Video URL is required",
    });
  });

  it("downloadVideo returns bad request when URL validation fails", async () => {
    req.body = { youtubeUrl: "https://youtube.com/watch?v=bad" };
    vi.mocked(validateUrl).mockImplementation(() => {
      throw new Error("validation failed");
    });

    await downloadVideo(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: "validation failed",
    });
  });

  it("downloadVideo skips already-downloaded items when handler says skip", async () => {
    req.body = { youtubeUrl: "https://youtube.com/watch?v=skip" };
    vi.mocked(storageService.handleVideoDownloadCheck).mockReturnValue({
      shouldSkip: true,
      response: { found: true, status: "exists" },
    } as any);

    await downloadVideo(req as Request, res as Response);

    expect(downloadManager.addDownload).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ found: true, status: "exists" });
  });

  it("downloadVideo queues youtube tasks and updates title asynchronously", async () => {
    req.body = { youtubeUrl: "https://youtube.com/watch?v=new" };
    vi.mocked(isYouTubeUrl).mockReturnValue(true);
    vi.mocked(downloadService.downloadYouTubeVideo).mockResolvedValue({ id: "video-yt" } as any);

    await downloadVideo(req as Request, res as Response);
    await flushBackgroundTasks();

    expect(downloadManager.addDownload).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(String),
      "YouTube Video",
      "https://youtube.com/watch?v=abc",
      "youtube"
    );
    expect(downloadService.downloadYouTubeVideo).toHaveBeenCalled();
    expect(downloadManager.updateTaskTitle).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "Download queued" })
    );
  });

  it("downloadVideo handles bilibili collection download task", async () => {
    req.body = {
      youtubeUrl: "https://www.bilibili.com/video/BV1xx",
      downloadCollection: true,
      collectionName: "Series",
      collectionInfo: { title: "Series Title" },
    };
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://www.bilibili.com/video/BV1xx",
      sourceVideoId: "bv-1",
      platform: "bilibili",
    } as any);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(downloadService.downloadBilibiliCollection).mockResolvedValue({
      success: true,
      collectionId: "c-1",
      videosDownloaded: 5,
    } as any);

    await downloadVideo(req as Request, res as Response);

    expect(downloadService.downloadBilibiliCollection).toHaveBeenCalledWith(
      { title: "Series Title" },
      "Series",
      expect.any(String)
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "Download queued" })
    );
  });

  it("downloadVideo handles bilibili collection task failure branch", async () => {
    req.body = {
      youtubeUrl: "https://www.bilibili.com/video/BVfail",
      downloadCollection: true,
      collectionName: "Fallback Name",
      collectionInfo: { title: "Collection Info Name" },
    };
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://www.bilibili.com/video/BVfail",
      sourceVideoId: "bv-fail",
      platform: "bilibili",
    } as any);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(storageService.getActiveDownload).mockReturnValue({
      title: "Bilibili Video",
    } as any);
    vi.mocked(downloadService.downloadBilibiliCollection).mockResolvedValue({
      success: false,
      error: "collection failed",
    } as any);

    await downloadVideo(req as Request, res as Response);
    await flushBackgroundTasks();

    expect(downloadService.downloadBilibiliCollection).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "Download queued" })
    );
  });

  it("downloadVideo handles multipart failure when bilibili id cannot be extracted", async () => {
    req.body = {
      youtubeUrl: "https://www.bilibili.com/video/BVnoid",
      downloadAllParts: true,
    };
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://www.bilibili.com/video/BVnoid",
      sourceVideoId: "bv-noid",
      platform: "bilibili",
    } as any);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(extractBilibiliVideoId).mockReturnValue(null);

    await downloadVideo(req as Request, res as Response);
    await flushBackgroundTasks();

    expect(downloadService.checkBilibiliVideoParts).not.toHaveBeenCalled();
  });

  it("downloadVideo handles multipart failure when parts info request fails", async () => {
    req.body = {
      youtubeUrl: "https://www.bilibili.com/video/BVparts",
      downloadAllParts: true,
    };
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://www.bilibili.com/video/BVparts",
      sourceVideoId: "bv-parts",
      platform: "bilibili",
    } as any);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(extractBilibiliVideoId).mockReturnValue("BVparts");
    vi.mocked(downloadService.checkBilibiliVideoParts).mockResolvedValue({
      success: false,
      videosNumber: 0,
    } as any);

    await downloadVideo(req as Request, res as Response);
    await flushBackgroundTasks();

    expect(downloadService.checkBilibiliVideoParts).toHaveBeenCalledWith("BVparts");
  });

  it("downloadVideo reuses existing collection by video id for multipart downloads", async () => {
    req.body = {
      youtubeUrl: "https://www.bilibili.com/video/BVexisting",
      downloadAllParts: true,
      collectionName: "Series Reuse",
    };
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://www.bilibili.com/video/BVexisting",
      sourceVideoId: "bv-existing",
      platform: "bilibili",
    } as any);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(extractBilibiliVideoId).mockReturnValue("BVexisting");
    vi.mocked(downloadService.checkBilibiliVideoParts).mockResolvedValue({
      success: true,
      videosNumber: 1,
      title: "Existing Series",
    } as any);
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue({
      id: "part-existing",
    } as any);
    vi.mocked(storageService.getCollectionByVideoId).mockReturnValue({
      id: "col-existing",
      name: "Existing Collection",
    } as any);
    vi.mocked(storageService.getCollectionById).mockReturnValue({
      id: "col-existing",
      videos: [],
    } as any);
    vi.mocked(storageService.atomicUpdateCollection).mockImplementation(
      (_id: string, updater: any) => updater({ videos: [] })
    );

    await downloadVideo(req as Request, res as Response);
    await flushBackgroundTasks();

    expect(storageService.getCollectionByVideoId).toHaveBeenCalledWith("part-existing");
    expect(storageService.atomicUpdateCollection).toHaveBeenCalled();
  });

  it("downloadVideo reuses existing collection by name for multipart downloads", async () => {
    req.body = {
      youtubeUrl: "https://www.bilibili.com/video/BVname",
      downloadAllParts: true,
      collectionName: "Collection By Name",
    };
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://www.bilibili.com/video/BVname",
      sourceVideoId: "bv-name",
      platform: "bilibili",
    } as any);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(extractBilibiliVideoId).mockReturnValue("BVname");
    vi.mocked(downloadService.checkBilibiliVideoParts).mockResolvedValue({
      success: true,
      videosNumber: 1,
      title: "Name Series",
    } as any);
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue({
      id: "part-name",
    } as any);
    vi.mocked(storageService.getCollectionByVideoId).mockReturnValue(null as any);
    vi.mocked(storageService.getCollectionByName).mockReturnValue({
      id: "col-by-name",
      name: "Collection By Name",
    } as any);

    await downloadVideo(req as Request, res as Response);
    await flushBackgroundTasks();

    expect(storageService.getCollectionByName).toHaveBeenCalledWith(
      "Collection By Name"
    );
    expect(storageService.saveCollection).not.toHaveBeenCalled();
  });

  it("downloadVideo passes resolved collection name to first-part downloader and handles background error", async () => {
    setupMultipartDownloadWithResolvedCollectionName();

    await downloadVideo(req as Request, res as Response);
    await flushBackgroundTasks();

    expect(downloadService.downloadSingleBilibiliPart).toHaveBeenCalledWith(
      "https://www.bilibili.com/video/BVdownload?p=1",
      1,
      3,
      "Parts Title",
      expect.any(String),
      expect.any(Function),
      "Resolved Collection Name"
    );
    expect(storageService.atomicUpdateCollection).toHaveBeenCalled();
  });

  it("downloadVideo handles single-part bilibili failure branch", async () => {
    req.body = {
      youtubeUrl: "https://www.bilibili.com/video/BVsingle",
    };
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://www.bilibili.com/video/BVsingle",
      sourceVideoId: "bv-single",
      platform: "bilibili",
    } as any);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(downloadService.downloadSingleBilibiliPart).mockResolvedValue({
      success: false,
      error: "single part failed",
    } as any);

    await downloadVideo(req as Request, res as Response);
    await flushBackgroundTasks();

    expect(downloadService.downloadSingleBilibiliPart).toHaveBeenCalledWith(
      "https://www.bilibili.com/video/BVsingle",
      1,
      1,
      "",
      expect.any(String),
      expect.any(Function)
    );
  });

  it("downloadVideo handles bilibili multi-part flow with existing part and background remaining downloads", async () => {
    req.body = {
      youtubeUrl: "https://www.bilibili.com/video/BV2xx",
      downloadAllParts: true,
      collectionName: "My Collection",
    };
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://www.bilibili.com/video/BV2xx?spm_id_from=333.1007.tianma.1-1-1.click",
      sourceVideoId: "bv-2",
      platform: "bilibili",
    } as any);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(extractBilibiliVideoId).mockReturnValue("BV2xx");
    vi.mocked(downloadService.checkBilibiliVideoParts).mockResolvedValue({
      success: true,
      videosNumber: 3,
      title: "Series Name",
    } as any);
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue({
      id: "part1-existing",
    } as any);
    vi.mocked(storageService.getCollectionByVideoId).mockReturnValue(null as any);
    vi.mocked(storageService.getCollectionByName).mockReturnValue(null as any);
    vi.mocked(storageService.getCollectionById).mockReturnValue({
      id: "new-col",
      videos: [],
    } as any);
    vi.mocked(storageService.atomicUpdateCollection).mockImplementation(
      (_id: string, updater: any) => updater({ videos: [] })
    );
    vi.mocked(storageService.getActiveDownload).mockReturnValue({
      title: "Queue Title",
    } as any);
    vi.mocked(downloadService.downloadRemainingBilibiliParts).mockResolvedValue(undefined);

    await downloadVideo(req as Request, res as Response);

    expect(downloadService.checkBilibiliVideoParts).toHaveBeenCalledWith("BV2xx");
    expect(storageService.saveCollection).toHaveBeenCalled();
    expect(downloadService.downloadRemainingBilibiliParts).toHaveBeenCalledWith(
      "https://www.bilibili.com/video/BV2xx",
      2,
      3,
      "Queue Title",
      expect.any(String),
      expect.any(String)
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "Download queued" })
    );
  });

  it("downloadVideo handles MissAV downloads", async () => {
    req.body = { youtubeUrl: "https://missav.com/watch/1" };
    vi.mocked(processVideoUrl).mockResolvedValue({
      videoUrl: "https://missav.com/watch/1",
      sourceVideoId: "m-1",
      platform: "missav",
    } as any);
    vi.mocked(isMissAVUrl).mockReturnValue(true);
    vi.mocked(downloadService.downloadMissAVVideo).mockResolvedValue({ id: "missav-video" } as any);

    await downloadVideo(req as Request, res as Response);

    expect(downloadService.downloadMissAVVideo).toHaveBeenCalled();
    expect(downloadManager.addDownload).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(String),
      "MissAV Video",
      "https://missav.com/watch/1",
      "missav"
    );
  });

  it("downloadVideo returns internal error on unexpected exception", async () => {
    req.body = { youtubeUrl: "https://youtube.com/watch?v=oops" };
    vi.mocked(processVideoUrl).mockRejectedValue(new Error("process failed"));

    await downloadVideo(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: "Failed to queue download",
    });
  });

  it("downloadVideo handles addDownload rejection branch", async () => {
    req.body = { youtubeUrl: "https://youtube.com/watch?v=queue-error" };
    vi.mocked(downloadManager.addDownload).mockRejectedValueOnce(
      new Error("queue failed")
    );

    await downloadVideo(req as Request, res as Response);
    await flushBackgroundTasks();

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "Download queued" })
    );
  });

  it("downloadVideo tolerates background getVideoInfo failures", async () => {
    req.body = { youtubeUrl: "https://youtube.com/watch?v=noinfo" };
    vi.mocked(downloadService.getVideoInfo).mockRejectedValueOnce(
      new Error("info failed")
    );

    await downloadVideo(req as Request, res as Response);
    await flushBackgroundTasks();

    expect(downloadService.getVideoInfo).toHaveBeenCalled();
  });

  it("checkBilibiliParts resolves short URLs and forwards video ID", async () => {
    req.query = { url: "https://b23.tv/short" } as any;
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(isBilibiliShortUrl).mockReturnValue(true);
    vi.mocked(resolveShortUrl).mockResolvedValue(
      "https://www.bilibili.com/video/BV1short"
    );
    vi.mocked(trimBilibiliUrl).mockReturnValue(
      "https://www.bilibili.com/video/BV1short"
    );
    vi.mocked(extractBilibiliVideoId).mockReturnValue("BV1short");
    vi.mocked(downloadService.checkBilibiliVideoParts).mockResolvedValue({
      success: true,
      videosNumber: 2,
    } as any);

    await checkBilibiliParts(req as Request, res as Response);

    expect(downloadService.checkBilibiliVideoParts).toHaveBeenCalledWith("BV1short");
    expect(json).toHaveBeenCalledWith({ success: true, videosNumber: 2 });
  });

  it("checkBilibiliParts throws when bilibili id cannot be extracted", async () => {
    req.query = { url: "https://www.bilibili.com/video/unknown" } as any;
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(isBilibiliShortUrl).mockReturnValue(false);
    vi.mocked(extractBilibiliVideoId).mockReturnValue(null);

    await expect(checkBilibiliParts(req as Request, res as Response)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("checkBilibiliCollection validates and forwards video ID", async () => {
    req.query = { url: "https://www.bilibili.com/video/BV9x" } as any;
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(extractBilibiliVideoId).mockReturnValue("BV9x");
    vi.mocked(downloadService.checkBilibiliCollectionOrSeries).mockResolvedValue({
      success: true,
      type: "collection",
    } as any);

    await checkBilibiliCollection(req as Request, res as Response);

    expect(downloadService.checkBilibiliCollectionOrSeries).toHaveBeenCalledWith("BV9x");
    expect(json).toHaveBeenCalledWith({ success: true, type: "collection" });
  });

  it("checkBilibiliCollection throws on non-bilibili url", async () => {
    req.query = { url: "https://example.com/video/1" } as any;
    vi.mocked(isBilibiliUrl).mockReturnValue(false);

    await expect(
      checkBilibiliCollection(req as Request, res as Response)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("checkBilibiliCollection resolves short url then throws when id is missing", async () => {
    req.query = { url: "https://b23.tv/noid" } as any;
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(isBilibiliShortUrl).mockReturnValue(true);
    vi.mocked(resolveShortUrl).mockResolvedValue(
      "https://www.bilibili.com/video/not-found"
    );
    vi.mocked(trimBilibiliUrl).mockReturnValue(
      "https://www.bilibili.com/video/not-found"
    );
    vi.mocked(extractBilibiliVideoId).mockReturnValue(null);

    await expect(
      checkBilibiliCollection(req as Request, res as Response)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("getDownloadStatus logs progress branch and returns status", async () => {
    vi.mocked(storageService.getDownloadStatus).mockReturnValue({
      activeDownloads: [
        { id: "d1", progress: 50, speed: "1MB/s", totalSize: "100MB" },
      ],
      queuedDownloads: [],
    } as any);

    await getDownloadStatus(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({
      activeDownloads: [
        { id: "d1", progress: 50, speed: "1MB/s", totalSize: "100MB" },
      ],
      queuedDownloads: [],
    });
  });

  it("checkPlaylist rejects youtube links without list parameter", async () => {
    req.query = { url: "https://youtube.com/watch?v=only-video" } as any;
    vi.mocked(isYouTubeUrl).mockReturnValue(true);

    await expect(checkPlaylist(req as Request, res as Response)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("checkPlaylist throws when url is missing", async () => {
    req.query = {} as any;

    await expect(checkPlaylist(req as Request, res as Response)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("checkPlaylist returns service result on success", async () => {
    req.query = { url: "https://youtube.com/playlist?list=PLok" } as any;
    vi.mocked(isYouTubeUrl).mockReturnValue(true);
    vi.mocked(downloadService.checkPlaylist).mockResolvedValue({
      success: true,
      count: 10,
    } as any);

    await checkPlaylist(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({ success: true, count: 10 });
  });

  it("checkPlaylist returns error payload when service throws", async () => {
    req.query = { url: "https://youtube.com/playlist?list=PL123" } as any;
    vi.mocked(isYouTubeUrl).mockReturnValue(true);
    vi.mocked(downloadService.checkPlaylist).mockRejectedValue(new Error("playlist failed"));

    await checkPlaylist(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({ success: false, error: "playlist failed" });
  });
});
