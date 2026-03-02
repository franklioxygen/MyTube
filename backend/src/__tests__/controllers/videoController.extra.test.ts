/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from "express";
import fs from "fs-extra";
import { PassThrough } from "stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthorChannelUrl,
  getVideoById,
  serveMountVideo,
  uploadSubtitle,
  uploadSubtitleMiddleware,
  upload,
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
  getSettings: vi.fn(),
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
    moveSync: vi.fn(),
    unlinkSync: vi.fn(),
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
  },
  ensureDirSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
  moveSync: vi.fn(),
  unlinkSync: vi.fn(),
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
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
  const state = (globalThis as any).__videoControllerMulterState || {
    diskStorageConfig: null as any,
    calls: [] as any[],
  };
  (globalThis as any).__videoControllerMulterState = state;

  const multer = vi.fn(() => ({
    single: vi.fn(),
    array: vi.fn(),
  }));
  (multer as any).diskStorage = vi.fn((config: any) => {
    state.diskStorageConfig = config;
    return { _config: config };
  });
  (multer as any).memoryStorage = vi.fn(() => ({}));
  (multer as any).mockImplementation((options: any) => {
    state.calls.push(options);
    return {
      single: vi.fn(),
      array: vi.fn(),
      _options: options,
    };
  });
  return { default: multer };
});

vi.mock("ass-to-vtt", () => ({
  default: vi.fn(() => new PassThrough()),
}));

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
    vi.mocked(storageService.getSettings).mockReturnValue({
      moveSubtitlesToVideoFolder: false,
    } as any);
    vi.mocked(fs.moveSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("multer upload storage callbacks generate destination and filename", () => {
    const state = (globalThis as any).__videoControllerMulterState;
    const cb = vi.fn();

    expect(state.diskStorageConfig).toBeTruthy();
    state.diskStorageConfig.destination({}, {}, cb);
    expect(fs.ensureDirSync).toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith(null, expect.stringContaining("/uploads/videos"));

    const filenameCb = vi.fn();
    state.diskStorageConfig.filename(
      {},
      { originalname: "movie.mp4" },
      filenameCb
    );
    expect(filenameCb).toHaveBeenCalledWith(
      null,
      expect.stringMatching(/\.mp4$/)
    );
  });

  it("uploadSubtitleMiddleware fileFilter accepts subtitle extensions and rejects invalid types", () => {
    const state = (globalThis as any).__videoControllerMulterState;
    const subtitleConfig = state.calls[1];
    const okCb = vi.fn();
    subtitleConfig.fileFilter({}, { originalname: "sub.zh.vtt" }, okCb);
    expect(okCb).toHaveBeenCalledWith(null, true);

    const badCb = vi.fn();
    subtitleConfig.fileFilter({}, { originalname: "sub.exe" }, badCb);
    expect(badCb).toHaveBeenCalledWith(expect.any(Error));
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

  it("getAuthorChannelUrl returns null for unsupported platforms", async () => {
    req.query = { sourceUrl: "https://example.com/video/1" } as any;
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue(null as any);
    vi.mocked(isYouTubeUrl).mockReturnValue(false);
    vi.mocked(isBilibiliUrl).mockReturnValue(false);

    await getAuthorChannelUrl(req as Request, res as Response);

    expect(json).toHaveBeenCalledWith({ success: true, channelUrl: null });
  });

  it("getAuthorChannelUrl returns null when bilibili id cannot be extracted", async () => {
    req.query = { sourceUrl: "https://www.bilibili.com/video/unknown" } as any;
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue({ id: "v4" } as any);
    vi.mocked(isYouTubeUrl).mockReturnValue(false);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(extractBilibiliVideoId).mockReturnValue(null);

    await getAuthorChannelUrl(req as Request, res as Response);

    expect(storageService.updateVideo).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ success: true, channelUrl: null });
  });

  it("getAuthorChannelUrl handles bilibili api errors and returns null", async () => {
    const axios = await import("axios");
    req.query = { sourceUrl: "https://www.bilibili.com/video/BV2yy" } as any;
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue({ id: "v5" } as any);
    vi.mocked(isBilibiliUrl).mockReturnValue(true);
    vi.mocked(extractBilibiliVideoId).mockReturnValue("av123");
    vi.mocked(axios.default.get).mockRejectedValue(new Error("network failed"));

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
    expect(sendFile).toHaveBeenCalledWith("video.mp4", { root: "/mnt/media" });
  });

  it("serveMountVideo throws not found when record is missing", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue(null as any);
    await expect(serveMountVideo(req as Request, res as Response)).rejects.toThrow(
      "Video not found"
    );
  });

  it("serveMountVideo throws not found for non-mount videos", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "/videos/normal.mp4",
    } as any);
    await expect(serveMountVideo(req as Request, res as Response)).rejects.toThrow(
      "Video not found"
    );
  });

  it("serveMountVideo throws when mount file does not exist", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "mount:/mnt/missing.mp4",
    } as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await expect(serveMountVideo(req as Request, res as Response)).rejects.toThrow(
      "Video file not found"
    );
  });

  it("serveMountVideo throws when mount path is not a file", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "mount:/mnt/folder",
    } as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as any);
    await expect(serveMountVideo(req as Request, res as Response)).rejects.toThrow(
      "Path is not a file"
    );
  });

  it("serveMountVideo sets content type from extension map", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "mount:/mnt/media/video.mkv",
    } as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);

    await serveMountVideo(req as Request, res as Response);

    expect(setHeader).toHaveBeenCalledWith("Content-Type", "video/x-matroska");
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

  it("uploadVideo rejects unsafe video filename path traversal", async () => {
    req.file = {
      filename: "../evil.mp4",
      originalname: "evil.mp4",
    } as any;

    await expect(uploadVideo(req as Request, res as Response)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("uploadVideo keeps going when ffmpeg thumbnail generation fails", async () => {
    const cp = await import("child_process");
    vi.mocked(cp.execFile).mockImplementation((cmd: string, ...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb !== "function") return {} as any;
      if (cmd === "ffmpeg") {
        cb(new Error("ffmpeg failed"), "", "stderr");
      } else {
        cb(null, "120", "");
      }
      return {} as any;
    });

    req.file = {
      filename: "thumb-fail.mp4",
      originalname: "thumb-fail.mp4",
    } as any;
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await uploadVideo(req as Request, res as Response);

    expect(storageService.saveVideo).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(201);
  });

  it("uploadVideo handles ffprobe failure and file size stat errors", async () => {
    const cp = await import("child_process");
    vi.mocked(cp.execFile).mockImplementation((cmd: string, ...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb !== "function") return {} as any;
      if (cmd === "ffprobe") {
        cb(new Error("ffprobe failed"), "", "stderr");
      } else {
        cb(null, "", "");
      }
      return {} as any;
    });

    req.file = {
      filename: "stat-fail.mp4",
      originalname: "stat-fail.mp4",
    } as any;
    vi.mocked(fs.existsSync).mockImplementation((target: any) =>
      String(target).endsWith("stat-fail.mp4")
    );
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error("stat failed");
    });

    await uploadVideo(req as Request, res as Response);

    expect(storageService.saveVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        duration: undefined,
        fileSize: undefined,
      })
    );
  });

  it("uploadSubtitle rejects missing file", async () => {
    req.file = undefined as any;
    await expect(uploadSubtitle(req as Request, res as Response)).rejects.toThrow(
      "No subtitle file uploaded"
    );
  });

  it("uploadSubtitle rejects empty files", async () => {
    req.file = {
      originalname: "empty.vtt",
      buffer: Buffer.alloc(0),
    } as any;
    await expect(uploadSubtitle(req as Request, res as Response)).rejects.toThrow(
      "Uploaded subtitle file is empty"
    );
  });

  it("uploadSubtitle cleans up temp file when video does not exist", async () => {
    req.file = {
      originalname: "sub.vtt",
      buffer: Buffer.from("WEBVTT"),
    } as any;
    vi.mocked(storageService.getVideoById).mockReturnValue(null as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await expect(uploadSubtitle(req as Request, res as Response)).rejects.toThrow(
      "Video not found"
    );
    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it("uploadSubtitle moves subtitles into mirrored subtitles directory and auto-detects language", async () => {
    req.file = {
      originalname: "movie.en.vtt",
      buffer: Buffer.from("WEBVTT"),
    } as any;
    req.body = {};
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "/videos/Collection A/movie.mp4",
      subtitles: [],
    } as any);
    vi.mocked(storageService.updateVideo).mockReturnValue({
      id: "v1",
      subtitles: [],
    } as any);
    vi.mocked(storageService.getSettings).mockReturnValue({
      moveSubtitlesToVideoFolder: false,
    } as any);

    await uploadSubtitle(req as Request, res as Response);

    expect(fs.moveSync).toHaveBeenCalled();
    expect(storageService.updateVideo).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({
        subtitles: [
          expect.objectContaining({
            language: "en",
            path: expect.stringMatching(/^\/subtitles\//),
          }),
        ],
      })
    );
    expect(status).toHaveBeenCalledWith(201);
  });

  it("uploadSubtitle moves subtitles to video folder when setting is enabled", async () => {
    req.file = {
      originalname: "movie.vtt",
      buffer: Buffer.from("WEBVTT"),
    } as any;
    req.body = { language: "zh" };
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "/videos/Col1/Sub1/movie.mp4",
      subtitles: [],
    } as any);
    vi.mocked(storageService.updateVideo).mockReturnValue({
      id: "v1",
      subtitles: [],
    } as any);
    vi.mocked(storageService.getSettings).mockReturnValue({
      moveSubtitlesToVideoFolder: true,
    } as any);

    await uploadSubtitle(req as Request, res as Response);

    expect(storageService.updateVideo).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({
        subtitles: [
          expect.objectContaining({
            language: "zh",
            path: expect.stringMatching(/^\/videos\//),
          }),
        ],
      })
    );
  });

  it("uploadSubtitle falls back to root subtitle path when move fails", async () => {
    req.file = {
      originalname: "movie.vtt",
      buffer: Buffer.from("WEBVTT"),
    } as any;
    req.body = {};
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "/videos/movie.mp4",
      subtitles: [],
    } as any);
    vi.mocked(storageService.updateVideo).mockReturnValue({
      id: "v1",
      subtitles: [],
    } as any);
    vi.mocked(fs.moveSync).mockImplementation(() => {
      throw new Error("move failed");
    });

    await uploadSubtitle(req as Request, res as Response);

    expect(storageService.updateVideo).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({
        subtitles: [
          expect.objectContaining({
            path: expect.stringMatching(/^\/subtitles\//),
          }),
        ],
      })
    );
  });

  it("uploadSubtitle throws not found when video update returns null", async () => {
    req.file = {
      originalname: "movie.vtt",
      buffer: Buffer.from("WEBVTT"),
    } as any;
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "/videos/movie.mp4",
      subtitles: [],
    } as any);
    vi.mocked(storageService.updateVideo).mockReturnValue(null as any);

    await expect(uploadSubtitle(req as Request, res as Response)).rejects.toThrow(
      "Video not found"
    );
  });
});
