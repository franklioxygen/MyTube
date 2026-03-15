/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";

const {
  staticMock,
  jimpReadMock,
  pathExistsMock,
  realpathMock,
  statMock,
} = vi.hoisted(() => ({
  staticMock: vi.fn((dir: string, options?: any) => ({
    dir,
    options,
  })),
  jimpReadMock: vi.fn(),
  pathExistsMock: vi.fn(),
  realpathMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("express", () => {
  const expressFn: any = () => ({});
  expressFn.static = staticMock;
  return {
    default: expressFn,
    static: staticMock,
  };
});

vi.mock("fs-extra", () => ({
  default: {
    pathExists: pathExistsMock,
    realpath: realpathMock,
    stat: statMock,
  },
}));

vi.mock("../../utils/fileSystemAccess", () => ({
  resolveRealPath: realpathMock,
  statPath: statMock,
}));

vi.mock("jimp", () => ({
  Jimp: {
    read: jimpReadMock,
  },
}));

import {
  registerSpaFallback,
  registerStaticRoutes,
} from "../../server/staticRoutes";

describe("server/staticRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathExistsMock.mockResolvedValue(false);
    realpathMock.mockImplementation(async (value: string) => value);
    statMock.mockResolvedValue({
      isFile: () => true,
    });
    jimpReadMock.mockResolvedValue({
      bitmap: { width: 200 },
      scaleToFit: vi.fn(),
      getBuffer: vi.fn().mockResolvedValue(Buffer.from("image")),
    });
  });

  it("should register static mounts and set headers for media files", () => {
    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    expect(use).toHaveBeenCalledTimes(7);
    expect(get).toHaveBeenCalledWith("/images/*", expect.any(Function));
    const [videosPath, videosStatic] = use.mock.calls[0];
    expect(videosPath).toBe("/videos");
    expect(videosStatic.dir).toContain("/uploads/videos");
    expect(videosStatic.options.fallthrough).toBe(false);

    const [imagesPath, imagesStatic] = use.mock.calls[1];
    expect(imagesPath).toBe("/images");
    expect(imagesStatic.options.fallthrough).toBe(false);

    const [assetsPath, assetsStatic] = use.mock.calls[5];
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

    const subtitlesStatic = use.mock.calls[4][1];
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

  it("should reject responsive image traversal attempts before accessing the filesystem", async () => {
    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    const imageHandler = get.mock.calls[0][1];
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    imageHandler(
      {
        path: "/images/../secrets.jpg",
        query: { w: "320" },
      } as any,
      res,
      next,
    );
    await Promise.resolve();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith("Invalid image path");
    expect(pathExistsMock).not.toHaveBeenCalled();
    expect(jimpReadMock).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject responsive image symlink targets that escape the image root", async () => {
    pathExistsMock.mockResolvedValue(true);
    realpathMock.mockResolvedValue("/tmp/escaped.jpg");

    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    const imageHandler = get.mock.calls[0][1];
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    imageHandler(
      {
        path: "/images/posters/cover.jpg",
        query: { q: "80" },
      } as any,
      res,
      next,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith("Invalid image path");
    expect(statMock).not.toHaveBeenCalled();
    expect(jimpReadMock).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should fall through to static image handling when the responsive target is missing", async () => {
    pathExistsMock.mockResolvedValue(false);

    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    const imageHandler = get.mock.calls[0][1];
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    imageHandler(
      {
        path: "/images/posters/cover.jpg",
        query: { w: "320" },
      } as any,
      res,
      next,
    );
    await Promise.resolve();

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(jimpReadMock).not.toHaveBeenCalled();
  });

  it("should use decoded wildcard params for responsive image lookups", async () => {
    pathExistsMock.mockResolvedValue(true);

    const use = vi.fn();
    const get = vi.fn();
    const app = { use, get } as any;
    registerStaticRoutes(app, "/frontend-dist");

    const imageHandler = get.mock.calls[0][1];
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    imageHandler(
      {
        path: "/images/%E4%BD%A0%E5%A5%BD.2024.jpg",
        params: { 0: "你好.2024.jpg" },
        query: { w: "320" },
      } as any,
      res,
      next,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const expectedImageSuffix = path.join("uploads", "images", "你好.2024.jpg");
    expect(pathExistsMock).toHaveBeenCalledWith(expect.stringContaining(expectedImageSuffix));
    expect(jimpReadMock).toHaveBeenCalledWith(expect.stringContaining(expectedImageSuffix));
    expect(res.send).toHaveBeenCalledWith(Buffer.from("image"));
    expect(next).not.toHaveBeenCalled();
  });
});
