/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "crypto";
import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { PassThrough } from "stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthorChannelUrl,
  getVideoById,
  serveMountVideo,
  uploadSubtitle,
  uploadBatch,
  uploadSubtitleMiddleware,
  upload,
  uploadVideo,
  uploadVideosBatch,
} from "../../controllers/videoController";
import { ValidationError } from "../../errors/DownloadErrors";
import { CloudStorageService } from "../../services/CloudStorageService";
import * as storageService from "../../services/storageService";
import { twitchApiService } from "../../services/twitchService";
import {
  extractBilibiliVideoId,
  extractTwitchVideoId,
  isBilibiliUrl,
  isTwitchChannelUrl,
  isTwitchVideoUrl,
  isYouTubeUrl,
  normalizeTwitchChannelUrl,
} from "../../utils/helpers";
import {
  executeYtDlpJson,
  getChannelUrlFromVideo,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../utils/ytDlpUtils";

vi.mock("../../services/storageService", () => ({
  getVideoById: vi.fn(),
  getVideoBySourceUrl: vi.fn(),
  updateVideo: vi.fn(),
  saveVideo: vi.fn(),
  saveVideoIfAbsent: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../../services/thumbnailMirrorService", () => ({
  deleteSmallThumbnailMirrorSync: vi.fn(),
  regenerateSmallThumbnailForThumbnailPath: vi.fn(() => Promise.resolve(null)),
  resolveManagedThumbnailTarget: vi.fn((video: any, filename: string, moveWithVideo: boolean) => {
    const safeFilename = path.basename(filename);
    return {
      absolutePath: moveWithVideo ? `/uploads/videos/${safeFilename}` : `/uploads/images/${safeFilename}`,
      webPath: moveWithVideo ? `/videos/${safeFilename}` : `/images/${safeFilename}`,
      relativePath: safeFilename,
    };
  }),
}));

vi.mock("../../services/CloudStorageService", () => ({
  CloudStorageService: {
    getSignedUrl: vi.fn(),
  },
}));

vi.mock("../../utils/ytDlpUtils", () => ({
  executeYtDlpJson: vi.fn(),
  getChannelUrlFromVideo: vi.fn(),
  getNetworkConfigFromUserConfig: vi.fn(),
  getUserYtDlpConfig: vi.fn(),
}));

vi.mock("../../utils/helpers", () => ({
  extractBilibiliVideoId: vi.fn(),
  extractTwitchVideoId: vi.fn(),
  isBilibiliUrl: vi.fn(),
  isTwitchChannelUrl: vi.fn(),
  isTwitchVideoUrl: vi.fn(),
  isYouTubeUrl: vi.fn(),
  normalizeTwitchChannelUrl: vi.fn((url: string) => url),
}));

vi.mock("../../services/twitchService", () => ({
  twitchApiService: {
    getVideoById: vi.fn(),
  },
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
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    writeFileSync: vi.fn(),
    moveSync: vi.fn(),
    unlinkSync: vi.fn(),
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
  },
  ensureDirSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
  moveSync: vi.fn(),
  unlinkSync: vi.fn(),
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn((cmd: string, fileArgs: any, maybeOptionsOrCb: any, maybeCb: any) => {
    const cb = typeof maybeOptionsOrCb === "function" ? maybeOptionsOrCb : maybeCb;
    if (cmd === "ffprobe") {
      const args = Array.isArray(fileArgs) ? fileArgs : [];
      if (args.includes("stream=codec_type")) {
        cb(null, "video\naudio\n", "");
        return;
      }
      if (args.includes("format=duration")) {
        cb(null, "125.6", "");
        return;
      }
      cb(null, "", "");
      return;
    }
    cb(null, "", "");
  }),
  spawnSync: vi.fn((_cmd: string, _args: any[]) => ({
    status: 1,
    stdout: "",
  })),
}));

vi.mock("multer", () => {
  const state = (globalThis as any).__videoControllerMulterState || {
    calls: [] as any[],
  };
  (globalThis as any).__videoControllerMulterState = state;

  const multer = vi.fn(() => ({
    single: vi.fn(),
    array: vi.fn(),
  }));
  (multer as any).diskStorage = vi.fn((config: any) => ({ _config: config }));
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
    vi.mocked(isTwitchChannelUrl).mockReturnValue(false);
    vi.mocked(isTwitchVideoUrl).mockReturnValue(false);
    vi.mocked(normalizeTwitchChannelUrl).mockImplementation((url: string) => url);
    vi.mocked(extractBilibiliVideoId).mockReturnValue(null);
    vi.mocked(extractTwitchVideoId).mockReturnValue(null);
    vi.mocked(storageService.getSettings).mockReturnValue({
      moveSubtitlesToVideoFolder: false,
    } as any);
    vi.mocked(storageService.updateVideo).mockReturnValue({} as any);
    vi.mocked(fs.moveSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);
    vi.mocked(storageService.getVideoById).mockReturnValue(undefined);
    vi.mocked(storageService.saveVideoIfAbsent).mockReturnValue(true);
  });

  it("upload middlewares use separate storages and tighter batch limits", () => {
    const state = (globalThis as any).__videoControllerMulterState;
    const uploadConfig = state.calls[0];
    const batchConfig = state.calls[1];

    expect(upload).toBeTruthy();
    expect(uploadBatch).toBeTruthy();
    expect(uploadConfig.storage).toBeTruthy();
    expect(uploadConfig.storage).not.toBe(batchConfig.storage);
    expect(typeof uploadConfig.storage._handleFile).toBe("function");
    expect(typeof uploadConfig.storage._removeFile).toBe("function");
    expect(uploadConfig.limits.fileSize).toBe(100 * 1024 * 1024 * 1024);
    expect(uploadConfig.limits.files).toBe(1);
    expect(batchConfig.limits.files).toBe(100);
  });

  it("uploadSubtitleMiddleware fileFilter accepts subtitle extensions and rejects invalid types", () => {
    const state = (globalThis as any).__videoControllerMulterState;
    const subtitleConfig = state.calls[2];
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

  it("getVideoById repairs missing merged local files using split artifacts", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "/videos/test.webm",
      videoFilename: "test.webm",
    } as any);

    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      const value = String(target);
      if (value.endsWith(path.join("uploads", "videos"))) return true;
      if (value.endsWith(path.join("uploads", "videos", "test.webm")))
        return false;
      if (value.endsWith(path.join("uploads", "videos", "test.f248.webm")))
        return true;
      if (value.endsWith(path.join("uploads", "videos", "test.f251.webm")))
        return true;
      return false;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
      "test.f248.webm",
      "test.f251.webm",
    ] as any);
    vi.mocked(fs.statSync).mockImplementation((target: any) => {
      const value = String(target);
      return {
        size: value.endsWith("test.f248.webm") ? 2048 : 256,
      } as any;
    });

    await getVideoById(req as Request, res as Response);

    expect(storageService.updateVideo).toHaveBeenCalledWith("v1", {
      videoPath: "/videos/test.f248.webm",
      videoFilename: "test.f248.webm",
    });
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        videoPath: "/videos/test.f248.webm",
        videoFilename: "test.f248.webm",
      })
    );
  });

  it("getVideoById keeps response successful when repair persistence fails", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "v1",
      videoPath: "/videos/test.webm",
      videoFilename: "test.webm",
    } as any);
    vi.mocked(storageService.updateVideo).mockImplementation(() => {
      throw new Error("db write failed");
    });

    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      const value = String(target);
      if (value.endsWith(path.join("uploads", "videos"))) return true;
      if (value.endsWith(path.join("uploads", "videos", "test.webm")))
        return false;
      if (value.endsWith(path.join("uploads", "videos", "test.f248.webm")))
        return true;
      return false;
    });
    vi.mocked(fs.readdirSync).mockReturnValue(["test.f248.webm"] as any);
    vi.mocked(fs.statSync).mockReturnValue({ size: 2048 } as any);

    await expect(getVideoById(req as Request, res as Response)).resolves.toBeUndefined();

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        videoPath: "/videos/test.f248.webm",
        videoFilename: "test.f248.webm",
      })
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

  it("getAuthorChannelUrl falls back to yt-dlp for Twitch videos when Helix lookup fails", async () => {
    req.query = { sourceUrl: "https://www.twitch.tv/videos/123456" } as any;
    vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue({ id: "v-twitch" } as any);
    vi.mocked(isYouTubeUrl).mockReturnValue(false);
    vi.mocked(isBilibiliUrl).mockReturnValue(false);
    vi.mocked(isTwitchChannelUrl).mockReturnValue(false);
    vi.mocked(isTwitchVideoUrl).mockReturnValue(true);
    vi.mocked(extractTwitchVideoId).mockReturnValue("123456");
    vi.mocked(getUserYtDlpConfig).mockReturnValue({} as any);
    vi.mocked(getNetworkConfigFromUserConfig).mockReturnValue({ proxy: "http://proxy" } as any);
    vi.mocked(twitchApiService.getVideoById).mockRejectedValue(new Error("missing creds"));
    vi.mocked(getChannelUrlFromVideo).mockResolvedValue("https://www.twitch.tv/fallbackchannel");

    await getAuthorChannelUrl(req as Request, res as Response);

    expect(getChannelUrlFromVideo).toHaveBeenCalledWith(
      "https://www.twitch.tv/videos/123456",
      { proxy: "http://proxy" }
    );
    expect(storageService.updateVideo).toHaveBeenCalledWith("v-twitch", {
      channelUrl: "https://www.twitch.tv/fallbackchannel",
    });
    expect(json).toHaveBeenCalledWith({
      success: true,
      channelUrl: "https://www.twitch.tv/fallbackchannel",
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
    expect(sendFile).toHaveBeenCalledWith(
      "video.mp4",
      expect.objectContaining({
        root: expect.stringMatching(/[\\/]mnt[\\/]media$/),
      })
    );
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
    const randomUuidSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("11111111-1111-4111-8111-111111111111");
    req.file = {
      filename: "uploaded.mp4",
      originalname: "Original Name.mp4",
      path: path.join(process.cwd(), "uploads", "videos", "uploaded.mp4"),
      size: 2048,
    } as any;
    req.body = { title: "Uploaded Title", author: "Uploader" };

    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      const value = String(target);
      return value.endsWith("uploaded.mp4") || value.endsWith("uploaded.jpg");
    });
    await uploadVideo(req as Request, res as Response);

    expect(storageService.saveVideoIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
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

    randomUuidSpy.mockRestore();
  });

  it("uploadVideo rejects unsafe video filename path traversal", async () => {
    req.file = {
      filename: "../evil.mp4",
      originalname: "evil.mp4",
      path: path.join(process.cwd(), "uploads", "videos", "../evil.mp4"),
    } as any;

    await expect(uploadVideo(req as Request, res as Response)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("uploadVideo rejects files without a video stream and removes the uploaded file", async () => {
    const cp = await import("child_process");
    vi.mocked(cp.execFile).mockImplementation(
      (cmd: string, fileArgs: any, maybeOptionsOrCb: any, maybeCb: any) => {
        const cb =
          typeof maybeOptionsOrCb === "function" ? maybeOptionsOrCb : maybeCb;
        const args = Array.isArray(fileArgs) ? fileArgs : [];
        if (cmd === "ffprobe" && args.includes("stream=codec_type")) {
          cb(null, "audio\n", "");
          return {} as any;
        }
        cb(null, "", "");
        return {} as any;
      }
    );

    req.file = {
      filename: "audio-only.mp4",
      originalname: "audio-only.mp4",
      path: path.join(process.cwd(), "uploads", "videos", "audio-only.mp4"),
    } as any;
    vi.mocked(fs.existsSync).mockImplementation((target: any) =>
      String(target).endsWith("audio-only.mp4")
    );

    await expect(uploadVideo(req as Request, res as Response)).rejects.toThrow(
      "Uploaded file is not a valid supported video"
    );

    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(storageService.saveVideoIfAbsent).not.toHaveBeenCalled();
  });

  it("uploadVideo keeps going when ffmpeg thumbnail generation fails", async () => {
    const cp = await import("child_process");
    vi.mocked(cp.execFile).mockImplementation(
      (cmd: string, fileArgs: any, maybeOptionsOrCb: any, maybeCb: any) => {
        const cb =
          typeof maybeOptionsOrCb === "function" ? maybeOptionsOrCb : maybeCb;
        if (typeof cb !== "function") return {} as any;
        const args = Array.isArray(fileArgs) ? fileArgs : [];
        if (cmd === "ffprobe" && args.includes("stream=codec_type")) {
          cb(null, "video\n", "");
        } else if (cmd === "ffprobe" && args.includes("format=duration")) {
          cb(null, "120", "");
        } else if (cmd === "ffmpeg") {
          cb(new Error("ffmpeg failed"), "", "stderr");
        } else {
          cb(null, "", "");
        }
        return {} as any;
      }
    );

    req.file = {
      filename: "thumb-fail.mp4",
      originalname: "thumb-fail.mp4",
      path: path.join(process.cwd(), "uploads", "videos", "thumb-fail.mp4"),
    } as any;
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await uploadVideo(req as Request, res as Response);

    expect(storageService.saveVideoIfAbsent).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(201);
  });

  it("uploadVideo handles ffprobe failure and file size stat errors", async () => {
    const cp = await import("child_process");
    vi.mocked(cp.execFile).mockImplementation(
      (cmd: string, fileArgs: any, maybeOptionsOrCb: any, maybeCb: any) => {
        const cb =
          typeof maybeOptionsOrCb === "function" ? maybeOptionsOrCb : maybeCb;
        if (typeof cb !== "function") return {} as any;
        const args = Array.isArray(fileArgs) ? fileArgs : [];
        if (cmd === "ffprobe" && args.includes("stream=codec_type")) {
          cb(null, "video\n", "");
        } else if (cmd === "ffprobe" && args.includes("format=duration")) {
          cb(new Error("ffprobe failed"), "", "stderr");
        } else {
          cb(null, "", "");
        }
        return {} as any;
      }
    );

    req.file = {
      filename: "stat-fail.mp4",
      originalname: "stat-fail.mp4",
      path: path.join(process.cwd(), "uploads", "videos", "stat-fail.mp4"),
    } as any;
    vi.mocked(fs.existsSync).mockImplementation((target: any) =>
      String(target).endsWith("stat-fail.mp4")
    );
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error("stat failed");
    });

    await uploadVideo(req as Request, res as Response);

    expect(storageService.saveVideoIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        duration: undefined,
        fileSize: undefined,
      })
    );
  });

  it("uploadVideo skips duplicate uploads by content hash", async () => {
    req.file = {
      filename: "duplicate.mp4",
      originalname: "duplicate.mp4",
      path: path.join(process.cwd(), "uploads", "videos", "duplicate.mp4"),
      contentHash: "same-content",
    } as any;
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "upload-same-content",
      title: "Existing video",
    } as any);
    vi.mocked(fs.existsSync).mockImplementation((target: any) =>
      String(target).endsWith("duplicate.mp4")
    );

    await uploadVideo(req as Request, res as Response);

    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(storageService.saveVideoIfAbsent).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Video already exists. Skipped duplicate upload",
      })
    );
  });

  it("uploadVideo cleans up and returns duplicate when atomic insert loses a race", async () => {
    req.file = {
      filename: "race.mp4",
      originalname: "race.mp4",
      path: path.join(process.cwd(), "uploads", "videos", "race.mp4"),
      contentHash: "race-hash",
    } as any;
    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      const value = String(target);
      return value.endsWith("race.mp4") || value.endsWith("race.jpg");
    });
    vi.mocked(fs.statSync).mockReturnValue({ size: 4096 } as any);
    vi.mocked(storageService.saveVideoIfAbsent).mockReturnValue(false);
    vi.mocked(storageService.getVideoById)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({
        id: "upload-race-hash",
        title: "Winner",
      } as any);

    await uploadVideo(req as Request, res as Response);

    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Video already exists. Skipped duplicate upload",
      })
    );
  });

  it("uploadVideosBatch returns per-file results and summary", async () => {
    req.files = [
      {
        filename: "fresh.mp4",
        originalname: "fresh.mp4",
        path: path.join(process.cwd(), "uploads", "videos", "fresh.mp4"),
        contentHash: "fresh-hash",
      },
      {
        filename: "duplicate.mp4",
        originalname: "duplicate.mp4",
        path: path.join(process.cwd(), "uploads", "videos", "duplicate.mp4"),
        contentHash: "dup-hash",
      },
      {
        filename: "bad.mp4",
        originalname: "bad.mp4",
        validationError: "Uploaded file is empty or has an unsupported video signature.",
      },
    ] as any;
    req.body = { author: "Uploader" };

    vi.mocked(storageService.getVideoById).mockImplementation((id: string) => {
      if (id === "upload-dup-hash") {
        return { id, title: "Already there" } as any;
      }
      return undefined;
    });
    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      const value = String(target);
      return value.endsWith("fresh.mp4") || value.endsWith("fresh.jpg");
    });
    vi.mocked(fs.statSync).mockReturnValue({ size: 1024 } as any);

    await uploadVideosBatch(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          summary: {
            total: 3,
            uploaded: 1,
            duplicates: 1,
            failed: 1,
          },
          results: [
            expect.objectContaining({
              originalName: "fresh.mp4",
              status: "uploaded",
            }),
            expect.objectContaining({
              originalName: "duplicate.mp4",
              status: "duplicate",
            }),
            expect.objectContaining({
              originalName: "bad.mp4",
              status: "failed",
            }),
          ],
        }),
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
