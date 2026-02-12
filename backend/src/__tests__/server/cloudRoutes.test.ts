import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCloudRoutes, startCloudflaredIfEnabled } from "../../server/cloudRoutes";
import { CLOUD_THUMBNAIL_CACHE_DIR } from "../../config/paths";
import { cloudflaredService } from "../../services/cloudflaredService";
import { getCachedThumbnail } from "../../services/cloudStorage/cloudThumbnailCache";
import { CloudStorageService } from "../../services/CloudStorageService";
import * as storageService from "../../services/storageService";
import {
  validateCloudThumbnailCachePath,
  validateRedirectUrl,
} from "../../utils/security";

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
}));

vi.mock("../../services/cloudStorage/cloudThumbnailCache", () => ({
  getCachedThumbnail: vi.fn(),
}));

vi.mock("../../services/CloudStorageService", () => ({
  CloudStorageService: {
    getSignedUrl: vi.fn(),
  },
}));

vi.mock("../../services/cloudflaredService", () => ({
  cloudflaredService: {
    start: vi.fn(),
  },
}));

vi.mock("../../utils/security", () => ({
  validateCloudThumbnailCachePath: vi.fn((p: string) => p),
  validateRedirectUrl: vi.fn((url: string) => url),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("server/cloudRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageService.getSettings).mockReturnValue({
      cloudDriveEnabled: true,
      openListApiUrl: "https://openlist.example/api/fs/put",
      openListToken: "token",
      openListPublicUrl: "https://cdn.example",
    } as any);
  });

  const createRes = () => {
    const res: Partial<Response> = {};
    const status = vi.fn().mockReturnValue(res);
    const send = vi.fn().mockReturnValue(res);
    const sendFile = vi.fn().mockReturnValue(res);
    const redirect = vi.fn().mockReturnValue(res);
    Object.assign(res, {
      status,
      send,
      sendFile,
      redirect,
      headersSent: false,
    });
    return res as Response & {
      status: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      sendFile: ReturnType<typeof vi.fn>;
      redirect: ReturnType<typeof vi.fn>;
    };
  };

  const registerAndGetHandlers = () => {
    const handlers: Record<string, any> = {};
    const app = {
      get: vi.fn((route: string, handler: any) => {
        handlers[route] = handler;
      }),
    } as any;
    registerCloudRoutes(app);
    return handlers;
  };

  const createReq = (filename: string): Request =>
    ({ params: { filename } } as unknown as Request);

  it("should register cloud video/image routes", () => {
    const handlers = registerAndGetHandlers();
    expect(Object.keys(handlers)).toEqual([
      "/cloud/videos/:filename",
      "/cloud/images/:filename",
    ]);
  });

  it("should return 404 when cloud storage is not configured", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      cloudDriveEnabled: false,
    } as any);
    const handlers = registerAndGetHandlers();
    const req = createReq("a.mp4");
    const res = createRes();

    handlers["/cloud/videos/:filename"](req, res);
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith("Cloud storage not configured");
  });

  it("should serve cached thumbnail file when image cache exists", async () => {
    vi.mocked(getCachedThumbnail).mockReturnValue(
      `${CLOUD_THUMBNAIL_CACHE_DIR}/abc123.jpg`
    );
    vi.mocked(validateCloudThumbnailCachePath).mockReturnValue(
      `${CLOUD_THUMBNAIL_CACHE_DIR}/abc123.jpg`
    );

    const handlers = registerAndGetHandlers();
    const req = createReq("abc.jpg");
    const res = createRes();

    handlers["/cloud/images/:filename"](req, res);
    await flushAsync();

    expect(res.sendFile).toHaveBeenCalledWith("abc123.jpg", {
      root: CLOUD_THUMBNAIL_CACHE_DIR,
    });
    expect(CloudStorageService.getSignedUrl).not.toHaveBeenCalled();
  });

  it("should reject suspicious cached thumbnail relative path", async () => {
    vi.mocked(getCachedThumbnail).mockReturnValue(
      `${CLOUD_THUMBNAIL_CACHE_DIR}/safe.jpg`
    );
    vi.mocked(validateCloudThumbnailCachePath).mockReturnValue("/tmp/other/safe.jpg");

    const handlers = registerAndGetHandlers();
    const req = createReq("safe.jpg");
    const res = createRes();

    handlers["/cloud/images/:filename"](req, res);
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith("Invalid file path");
  });

  it("should return 404 when signed url is missing", async () => {
    vi.mocked(getCachedThumbnail).mockReturnValue(null);
    (CloudStorageService.getSignedUrl as any).mockResolvedValue(null);

    const handlers = registerAndGetHandlers();
    const req = createReq("video.mp4");
    const res = createRes();
    handlers["/cloud/videos/:filename"](req, res);
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith("File not found in cloud storage");
  });

  it("should return 500 when redirect url validation fails", async () => {
    vi.mocked(getCachedThumbnail).mockReturnValue(null);
    (CloudStorageService.getSignedUrl as any).mockResolvedValue(
      "https://cdn.example/file.mp4?sign=1"
    );
    vi.mocked(validateRedirectUrl).mockImplementation(() => {
      throw new Error("bad redirect");
    });

    const handlers = registerAndGetHandlers();
    const req = createReq("video.mp4");
    const res = createRes();
    handlers["/cloud/videos/:filename"](req, res);
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith("Invalid cloud storage URL");
  });

  it("should return 500 when validated origin mismatches allowed origin", async () => {
    (CloudStorageService.getSignedUrl as any).mockResolvedValue(
      "https://evil.example/file.mp4"
    );
    vi.mocked(validateRedirectUrl).mockReturnValue("https://evil.example/file.mp4");

    const handlers = registerAndGetHandlers();
    const req = createReq("video.mp4");
    const res = createRes();
    handlers["/cloud/videos/:filename"](req, res);
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith("Invalid cloud storage URL");
  });

  it("should redirect to validated cloud signed url", async () => {
    (CloudStorageService.getSignedUrl as any).mockResolvedValue(
      "https://cdn.example/file.mp4?sign=ok"
    );
    vi.mocked(validateRedirectUrl).mockReturnValue(
      "https://cdn.example/file.mp4?sign=ok"
    );

    const handlers = registerAndGetHandlers();
    const req = createReq("video.mp4");
    const res = createRes();
    handlers["/cloud/videos/:filename"](req, res);
    await flushAsync();

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      "https://cdn.example/file.mp4?sign=ok"
    );
  });

  it("should send 500 in outer catch when unexpected errors happen", async () => {
    vi.mocked(storageService.getSettings).mockImplementation(() => {
      throw new Error("settings broken");
    });

    const handlers = registerAndGetHandlers();
    const req = createReq("x.mp4");
    const res = createRes();
    handlers["/cloud/videos/:filename"](req, res);
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith("Error fetching video from cloud storage");
  });

  it("should start cloudflared only when enabled and with right args", () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      cloudflaredTunnelEnabled: false,
    } as any);
    startCloudflaredIfEnabled(5551);
    expect(cloudflaredService.start).not.toHaveBeenCalled();

    vi.mocked(storageService.getSettings).mockReturnValue({
      cloudflaredTunnelEnabled: true,
      cloudflaredToken: "token-123",
    } as any);
    startCloudflaredIfEnabled(5551);
    expect(cloudflaredService.start).toHaveBeenCalledWith("token-123");

    vi.mocked(storageService.getSettings).mockReturnValue({
      cloudflaredTunnelEnabled: true,
      cloudflaredToken: "",
    } as any);
    startCloudflaredIfEnabled(5551);
    expect(cloudflaredService.start).toHaveBeenCalledWith(undefined, 5551);
  });
});
