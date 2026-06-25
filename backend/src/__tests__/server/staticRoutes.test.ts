/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  staticMock,
  ensureSmallThumbnailForRelativePathMock,
  getThumbnailRelativePathMock,
  pathExistsMock,
} = vi.hoisted(() => ({
  staticMock: vi.fn((dir: string, options?: any) => ({
    dir,
    options,
  })),
  ensureSmallThumbnailForRelativePathMock: vi.fn(),
  getThumbnailRelativePathMock: vi.fn(),
  pathExistsMock: vi.fn(),
}));

vi.mock("express", () => {
  const expressFn: any = () => ({});
  expressFn.static = staticMock;
  return {
    default: expressFn,
    static: staticMock,
  };
});

vi.mock("../../services/thumbnailMirrorService", () => ({
  ensureSmallThumbnailForRelativePath: ensureSmallThumbnailForRelativePathMock,
  getThumbnailRelativePath: getThumbnailRelativePathMock,
}));

vi.mock("fs-extra", () => ({
  default: {
    pathExists: pathExistsMock,
  },
  pathExists: pathExistsMock,
}));

vi.mock("../../middleware/authMiddleware", () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
}));

vi.mock("../../middleware/mediaAuthMiddleware", () => ({
  requireAuthenticatedMediaAccess: vi.fn((_req, _res, next) => next()),
  requireVisibleMediaForVisitors: vi.fn(
    () => (_req: any, _res: any, next: any) => next()
  ),
}));

import {
  registerSpaFallback,
  registerStaticRoutes,
} from "../../server/staticRoutes";

describe("server/staticRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureSmallThumbnailForRelativePathMock.mockResolvedValue(null);
    getThumbnailRelativePathMock.mockImplementation((value: string) => value);
    pathExistsMock.mockResolvedValue(false);
  });

  it("should register static mounts and set headers for media files", () => {
    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    expect(use).toHaveBeenCalledTimes(8);
    // /images-small/* now carries the media auth stack + visibility guard
    // before its handler.
    expect(get).toHaveBeenCalledWith(
      "/images-small/*",
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );

    // Media mounts carry the auth stack (authMiddleware,
    // requireAuthenticatedMediaAccess) and the per-video visibility guard
    // before the express.static() result, which is always the last argument.
    const lastArg = (call: any[]) => call[call.length - 1];

    const videosCall = use.mock.calls[0];
    const videosStatic = lastArg(videosCall);
    expect(videosCall[0]).toBe("/videos");
    expect(videosStatic.dir).toContain("/uploads/videos");
    expect(videosStatic.options.fallthrough).toBe(false);

    const imagesCall = use.mock.calls[1];
    const imagesStatic = lastArg(imagesCall);
    expect(imagesCall[0]).toBe("/images");
    expect(imagesStatic.options.fallthrough).toBe(false);

    const smallImagesCall = use.mock.calls[2];
    const smallImagesStatic = lastArg(smallImagesCall);
    expect(smallImagesCall[0]).toBe("/images-small");
    expect(smallImagesStatic.options.fallthrough).toBe(false);

    // /assets is the frontend bundle (login page assets) and stays unguarded.
    const [assetsPath, assetsStatic] = use.mock.calls[6];
    expect(assetsPath).toBe("/assets");
    expect(assetsStatic.dir).toBe("/frontend-dist/assets");
    expect(assetsStatic.options.fallthrough).toBe(false);

    const setHeaders = videosStatic.options.setHeaders as (
      res: any,
      filePath: string
    ) => void;
    const res = { setHeader: vi.fn() };

    setHeaders(res, "/tmp/movie.webm");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "video/webm");

    res.setHeader.mockClear();
    setHeaders(res, "/tmp/movie.vtt");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/vtt");

    res.setHeader.mockClear();
    setHeaders(res, "/tmp/thumb.webp");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/webp");

    res.setHeader.mockClear();
    setHeaders(res, "/tmp/unknown.bin");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "video/mp4");
  });

  it("should gate media mounts behind the media auth stack", () => {
    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    // The first six use() calls are media routes (videos, images, images-small,
    // avatars, api/cloud/thumbnail-cache, subtitles) and must carry the two auth
    // middlewares (authMiddleware + requireAuthenticatedMediaAccess) before the
    // static result. Per-video media (videos/images/images-small/subtitles) also
    // carries the requireVisibleMediaForVisitors guard; avatars and the cloud
    // thumbnail cache are not per-video so they keep just the auth stack.
    const mediaPaths: Array<{ path: string; hasVisibilityGuard: boolean }> = [
      { path: "/videos", hasVisibilityGuard: true },
      { path: "/images", hasVisibilityGuard: true },
      { path: "/images-small", hasVisibilityGuard: true },
      { path: "/avatars", hasVisibilityGuard: false },
      { path: "/api/cloud/thumbnail-cache", hasVisibilityGuard: false },
      { path: "/subtitles", hasVisibilityGuard: true },
    ];
    mediaPaths.forEach(({ path: expectedPath, hasVisibilityGuard }, index) => {
      const call = use.mock.calls[index];
      expect(call[0]).toBe(expectedPath);
      // path + authMiddleware + requireAuthenticatedMediaAccess (+ visibility
      // guard) + static result.
      expect(call).toHaveLength(hasVisibilityGuard ? 5 : 4);
      expect(typeof call[1]).toBe("function");
      expect(typeof call[2]).toBe("function");
      // The static result is always the last argument.
      expect(call[call.length - 1]).toBeTruthy();
    });

    // /assets (index 6) and the SPA dist (index 7) are NOT auth-gated.
    expect(use.mock.calls[6][0]).toBe("/assets");
    expect(use.mock.calls[6]).toHaveLength(2);
  });

  it("should set subtitle content-type headers by extension", () => {
    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    // /subtitles is media call index 5; its static result is the last argument.
    const subtitlesCall = use.mock.calls[5];
    const subtitlesStatic = subtitlesCall[subtitlesCall.length - 1];
    const setHeaders = subtitlesStatic.options.setHeaders as (
      res: any,
      filePath: string
    ) => void;
    const res = { setHeader: vi.fn() };

    setHeaders(res, "/tmp/subtitle.srt");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/x-subrip"
    );
    expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");

    res.setHeader.mockClear();
    setHeaders(res, "/tmp/subtitle.ass");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/x-ssa");
  });

  it("should ensure missing small thumbnails before falling through to static serving", async () => {
    getThumbnailRelativePathMock.mockReturnValue("folder/poster.jpg");

    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    // The /images-small/* GET carries [authMiddleware, requireMedia, handler];
    // the handler is the 4th argument (index 3).
    const smallImageHandler = get.mock.calls[0][get.mock.calls[0].length - 1];
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    smallImageHandler(
      {
        path: "/images-small/folder/poster.jpg",
        params: { 0: "folder/poster.jpg" },
      } as any,
      res,
      next,
    );

    await Promise.resolve();

    expect(getThumbnailRelativePathMock).toHaveBeenCalledWith("folder/poster.jpg");
    expect(ensureSmallThumbnailForRelativePathMock).toHaveBeenCalledWith(
      "folder/poster.jpg",
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should reject invalid small thumbnail paths before touching the filesystem", async () => {
    getThumbnailRelativePathMock.mockReturnValue(null);

    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    const smallImageHandler = get.mock.calls[0][get.mock.calls[0].length - 1];
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    smallImageHandler(
      {
        path: "/images-small/../secret.jpg",
        params: { 0: "../secret.jpg" },
      } as any,
      res,
      next,
    );

    await Promise.resolve();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith("Invalid image path");
    expect(ensureSmallThumbnailForRelativePathMock).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should fall back to the original thumbnail when images-small generation fails", async () => {
    getThumbnailRelativePathMock.mockReturnValue("folder/poster.jpg");
    ensureSmallThumbnailForRelativePathMock.mockRejectedValue(
      new Error("EACCES: permission denied")
    );
    pathExistsMock.mockImplementation(async (target: string) =>
      String(target).includes("/uploads/images/folder/poster.jpg")
    );

    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    const smallImageHandler = get.mock.calls[0][get.mock.calls[0].length - 1];
    const sendFile = vi.fn((_path: string, cb?: (err?: Error | null) => void) => {
      cb?.(null);
    });
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
      sendFile,
    };
    const next = vi.fn();

    smallImageHandler(
      {
        path: "/images-small/folder/poster.jpg",
        params: { 0: "folder/poster.jpg" },
      } as any,
      res,
      next,
    );

    await vi.waitFor(() => {
      expect(sendFile).toHaveBeenCalled();
    });

    expect(sendFile).toHaveBeenCalledWith(
      expect.stringContaining("/uploads/images/folder/poster.jpg"),
      expect.any(Function),
    );
    expect(res.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    expect(next).not.toHaveBeenCalled();
  });

  it("should register SPA fallback and return correct 404 responses without breaking SPA routes", () => {
    const get = vi.fn();
    const app = { get } as any;
    registerSpaFallback(app, "/frontend-dist");

    expect(get).toHaveBeenCalledWith("*", expect.any(Function));
    const handler = get.mock.calls[0][1];

    const apiRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      json: vi.fn(),
      sendFile: vi.fn(),
    };
    handler({ path: "/api/videos" } as any, apiRes);
    expect(apiRes.status).toHaveBeenCalledWith(404);
    expect(apiRes.json).toHaveBeenCalledWith({ error: "Not Found" });
    expect(apiRes.send).not.toHaveBeenCalled();

    const cloudRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      json: vi.fn(),
      sendFile: vi.fn(),
    };
    handler({ path: "/cloud/file" } as any, cloudRes);
    expect(cloudRes.status).toHaveBeenCalledWith(404);
    expect(cloudRes.json).toHaveBeenCalledWith({ error: "Not Found" });

    const feedRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      json: vi.fn(),
      sendFile: vi.fn(),
    };
    handler({ path: "/feed/not-a-real-token" } as any, feedRes);
    expect(feedRes.status).toHaveBeenCalledWith(404);
    expect(feedRes.json).toHaveBeenCalledWith({ error: "Not Found" });
    expect(feedRes.sendFile).not.toHaveBeenCalled();

    const faviconRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      json: vi.fn(),
      sendFile: vi.fn(),
    };
    handler({ path: "/favicon-missing.ico" } as any, faviconRes);
    expect(faviconRes.status).toHaveBeenCalledWith(404);
    expect(faviconRes.send).toHaveBeenCalledWith("Not Found");
    expect(faviconRes.sendFile).not.toHaveBeenCalled();

    const spaRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      json: vi.fn(),
      sendFile: vi.fn(),
    };
    handler({ path: "/author/jane.doe" } as any, spaRes);
    expect(spaRes.sendFile).toHaveBeenCalledWith("index.html", {
      root: "/frontend-dist"
    });
  });
});
