/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { staticMock } = vi.hoisted(() => ({
  staticMock: vi.fn((dir: string, options?: any) => ({
    dir,
    options,
  })),
}));

vi.mock("express", () => {
  const expressFn: any = () => ({});
  expressFn.static = staticMock;
  return {
    default: expressFn,
    static: staticMock,
  };
});

import {
  registerSpaFallback,
  registerStaticRoutes,
} from "../../server/staticRoutes";

describe("server/staticRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should register static mounts and set headers for media files", () => {
    const use = vi.fn();
    const app = { use } as any;
    registerStaticRoutes(app, "/frontend-dist");

    expect(use).toHaveBeenCalledTimes(6);
    const [videosPath, videosStatic] = use.mock.calls[0];
    expect(videosPath).toBe("/videos");
    expect(videosStatic.dir).toContain("/uploads/videos");

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
    const app = { use } as any;
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
});
