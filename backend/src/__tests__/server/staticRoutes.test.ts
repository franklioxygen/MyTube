/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  staticMock,
  ensureSmallThumbnailForRelativePathMock,
  getThumbnailRelativePathMock,
} = vi.hoisted(() => ({
  staticMock: vi.fn((dir: string, options?: any) => ({
    dir,
    options,
  })),
  ensureSmallThumbnailForRelativePathMock: vi.fn(),
  getThumbnailRelativePathMock: vi.fn(),
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

import {
  registerSpaFallback,
  registerStaticRoutes,
} from "../../server/staticRoutes";

describe("server/staticRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureSmallThumbnailForRelativePathMock.mockResolvedValue(null);
    getThumbnailRelativePathMock.mockImplementation((value: string) => value);
  });

  it("should register static mounts and set headers for media files", () => {
    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    expect(use).toHaveBeenCalledTimes(8);
    expect(get).toHaveBeenCalledWith("/images-small/*", expect.any(Function));

    const [videosPath, videosStatic] = use.mock.calls[0];
    expect(videosPath).toBe("/videos");
    expect(videosStatic.dir).toContain("/uploads/videos");
    expect(videosStatic.options.fallthrough).toBe(false);

    const [imagesPath, imagesStatic] = use.mock.calls[1];
    expect(imagesPath).toBe("/images");
    expect(imagesStatic.options.fallthrough).toBe(false);

    const [smallImagesPath, smallImagesStatic] = use.mock.calls[2];
    expect(smallImagesPath).toBe("/images-small");
    expect(smallImagesStatic.options.fallthrough).toBe(false);

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
    setHeaders(res, "/tmp/unknown.bin");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "video/mp4");
  });

  it("should set subtitle content-type headers by extension", () => {
    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    const subtitlesStatic = use.mock.calls[5][1];
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

    const smallImageHandler = get.mock.calls[0][1];
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

    const smallImageHandler = get.mock.calls[0][1];
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

  it("should register SPA fallback and keep api/cloud paths as 404", () => {
    const get = vi.fn();
    const app = { get } as any;
    registerSpaFallback(app, "/frontend-dist");

    expect(get).toHaveBeenCalledWith("*", expect.any(Function));
    const handler = get.mock.calls[0][1];

    const apiRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      sendFile: vi.fn(),
    };
    handler({ path: "/api/videos" } as any, apiRes);
    expect(apiRes.status).toHaveBeenCalledWith(404);
    expect(apiRes.send).toHaveBeenCalledWith("Not Found");

    const cloudRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      sendFile: vi.fn(),
    };
    handler({ path: "/cloud/file" } as any, cloudRes);
    expect(cloudRes.status).toHaveBeenCalledWith(404);

    const spaRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      sendFile: vi.fn(),
    };
    handler({ path: "/home" } as any, spaRes);
    expect(spaRes.sendFile).toHaveBeenCalledWith("index.html", {
      root: "/frontend-dist"
    });
  });
});
