import { Request, Response } from "express";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthorChannelUrl,
  getVideoById,
  serveMountVideo,
  uploadVideo,
} from "../../controllers/videoController";
import { ValidationError } from "../../errors/DownloadErrors";
import { CloudStorageService } from "../../services/CloudStorageService";
import * as storageService from "../../services/storageService";
import { extractBilibiliVideoId, isBilibiliUrl, isYouTubeUrl } from "../../utils/helpers";
import {
  executeYtDlpJson,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../utils/ytDlpUtils";

vi.mock("../../services/storageService", () => ({
  getVideoById: vi.fn(),
  getVideoBySourceUrl: vi.fn(),
  updateVideo: vi.fn(),
  saveVideo: vi.fn(),
}));

vi.mock("../../services/CloudStorageService", () => ({
  CloudStorageService: {
    getSignedUrl: vi.fn(),
  },
}));

vi.mock("../../utils/ytDlpUtils", () => ({
  executeYtDlpJson: vi.fn(),
  getNetworkConfigFromUserConfig: vi.fn(),
  getUserYtDlpConfig: vi.fn(),
}));

vi.mock("../../utils/helpers", () => ({
  extractBilibiliVideoId: vi.fn(),
  isBilibiliUrl: vi.fn(),
  isYouTubeUrl: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    ensureDirSync: vi.fn(),
    existsSync: vi.fn(),
    statSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  ensureDirSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn((cmd: string, _args: any, maybeOptionsOrCb: any, maybeCb: any) => {
    const cb = typeof maybeOptionsOrCb === "function" ? maybeOptionsOrCb : maybeCb;
    if (cmd === "ffprobe") {
      cb(null, "125.6", "");
      return;
    }
    cb(null, "", "");
  }),
}));

vi.mock("multer", () => {
  const multer = vi.fn(() => ({
    single: vi.fn(),
    array: vi.fn(),
  }));
  (multer as any).diskStorage = vi.fn(() => ({}));
  (multer as any).memoryStorage = vi.fn(() => ({}));
  return { default: multer };
});

describe("videoController extra coverage", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;
  let setHeader: any;
  let sendFile: any;

  beforeEach(() => {
    vi.clearAllMocks();

    json = vi.fn();
    status = vi.fn(() => ({ json }));
    setHeader = vi.fn();
    sendFile = vi.fn();

    req = {
      params: { id: "v1" },
      query: {},
      body: {},
      headers: {},
    };
    res = {
      status,
      json,
      setHeader,
      sendFile,
    } as any;

    vi.mocked(getUserYtDlpConfig).mockReturnValue({} as any);
    vi.mocked(getNetworkConfigFromUserConfig).mockReturnValue({} as any);
    vi.mocked(isYouTubeUrl).mockReturnValue(false);
    vi.mocked(isBilibiliUrl).mockReturnValue(false);
    vi.mocked(extractBilibiliVideoId).mockReturnValue(null);
  });

  it("getVideoById injects signed cloud URLs", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "cloud:video.mp4",
      thumbnailPath: "cloud:thumb.jpg",
    } as any);
    vi.mocked(CloudStorageService.getSignedUrl)
      .mockResolvedValueOnce("https://cdn.example/video.mp4")
      .mockResolvedValueOnce("https://cdn.example/thumb.jpg");

    await getVideoById(req as Request, res as Response);

    expect(CloudStorageService.getSignedUrl).toHaveBeenNthCalledWith(
      1,
      "video.mp4",
      "video"
    );
    expect(CloudStorageService.getSignedUrl).toHaveBeenNthCalledWith(
      2,
      "thumb.jpg",
      "thumbnail"
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        signedUrl: "https://cdn.example/video.mp4",
        signedThumbnailUrl: "https://cdn.example/thumb.jpg",
      })
    );
  });

  it("getVideoById sets mount playback URL", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "mount:/mnt/videos/a.mp4",
    } as any);

    await getVideoById(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ signedUrl: "/api/mount-video/v1" })
    );
  });

  it("getAuthorChannelUrl returns cached channel URL", async () => {
    req.query = { sourceUrl: "https://youtube.com/watch?v=1" } as any;
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue({
      id: "v1",
      channelUrl: "https://youtube.com/@cached",
    } as any);

    await getAuthorChannelUrl(req as Request, res as Response);

    expect(storageService.updateVideo).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({
      success: true,
      channelUrl: "https://youtube.com/@cached",
    });
  });

  it("getAuthorChannelUrl resolves youtube channel and persists", async () => {
    req.query = { sourceUrl: "https://youtube.com/watch?v=2" } as any;
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue({
      id: "v2",
    } as any);
    vi.mocked(isYouTubeUrl).mockReturnValue(true);
    vi.mocked(executeYtDlpJson).mockResolvedValue({
      channel_url: "https://youtube.com/@fresh",
    } as any);

    await getAuthorChannelUrl(req as Request, res as Response);

    expect(storageService.updateVideo).toHaveBeenCalledWith("v2", {
      channelUrl: "https://youtube.com/@fresh",
    });
    expect(json).toHaveBeenCalledWith({
      success: true,
      channelUrl: "https://youtube.com/@fresh",
    });
  });

  it("getAuthorChannelUrl falls back to bilibili owner URL", async () => {
    const axios = await import("axios");
    req.query = { sourceUrl: "https://www.bilibili.com/video/BV1xx" } as any;
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue({ id: "v3" } as any);
    vi.mocked(isYouTubeUrl).mockReturnValue(false);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(extractBilibiliVideoId).mockReturnValue("BV1xx");
    vi.mocked(axios.default.get).mockResolvedValue({
      data: { data: { owner: { mid: 12345 } } },
    } as any);

    await getAuthorChannelUrl(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({
      success: true,
      channelUrl: "https://space.bilibili.com/12345",
    });
  });

  it("getAuthorChannelUrl returns null on resolver errors", async () => {
    req.query = { sourceUrl: "https://youtube.com/watch?v=3" } as any;
    vi.mocked(isYouTubeUrl).mockReturnValue(true);
    vi.mocked(executeYtDlpJson).mockRejectedValue(new Error("yt failed"));

    await getAuthorChannelUrl(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({ success: true, channelUrl: null });
  });

  it("serveMountVideo sends file with playback headers", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "mount:/mnt/media/video.mp4",
    } as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);

    await serveMountVideo(req as Request, res as Response);

    expect(setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "video/mp4"
    );
    expect(sendFile).toHaveBeenCalledWith("/mnt/media/video.mp4");
  });

  it("serveMountVideo rejects unsafe mount paths", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "mount:../unsafe.mp4",
    } as any);

    await expect(serveMountVideo(req as Request, res as Response)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("uploadVideo rejects when file is missing", async () => {
    req.file = undefined as any;

    await expect(uploadVideo(req as Request, res as Response)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("uploadVideo saves video metadata", async () => {
    req.file = {
      filename: "uploaded.mp4",
      originalname: "Original Name.mp4",
    } as any;
    req.body = { title: "Uploaded Title", author: "Uploader" };

    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      const value = String(target);
      return value.endsWith("uploaded.mp4") || value.endsWith("uploaded.jpg");
    });
    vi.mocked(fs.statSync).mockReturnValue({ size: 2048 } as any);

    await uploadVideo(req as Request, res as Response);

    expect(storageService.saveVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Uploaded Title",
        author: "Uploader",
        videoFilename: "uploaded.mp4",
        thumbnailFilename: "uploaded.jpg",
        duration: "125.6",
        fileSize: "2048",
      })
    );
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Video uploaded successfully",
      })
    );
  });
});
