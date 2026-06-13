/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  getCookieHeader: vi.fn(),
  bccToVtt: vi.fn(),
  extractBilibiliVideoId: vi.fn(),
  ensureDirSafeSync: vi.fn(),
  resolveSafeChildPath: vi.fn(),
  resolveSafePathInDirectories: vi.fn(),
  writeFileSafeSync: vi.fn(),
  buildAllowlistedHttpUrl: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("axios", () => ({
  default: { get: (...args: any[]) => mocks.axiosGet(...args) },
}));
vi.mock("../../../config/paths", () => ({
  VIDEOS_DIR: "/data/videos",
  SUBTITLES_DIR: "/data/subtitles",
}));
vi.mock("../../../utils/bccToVtt", () => ({
  bccToVtt: (...args: any[]) => mocks.bccToVtt(...args),
}));
vi.mock("../../../utils/helpers", () => ({
  extractBilibiliVideoId: (...args: any[]) => mocks.extractBilibiliVideoId(...args),
}));
vi.mock("../../../utils/logger", () => ({ logger: mocks.logger }));
vi.mock("../../../utils/security", () => ({
  buildAllowlistedHttpUrl: (...args: any[]) => mocks.buildAllowlistedHttpUrl(...args),
  ensureDirSafeSync: (...args: any[]) => mocks.ensureDirSafeSync(...args),
  resolveSafeChildPath: (...args: any[]) => mocks.resolveSafeChildPath(...args),
  resolveSafePathInDirectories: (...args: any[]) =>
    mocks.resolveSafePathInDirectories(...args),
  writeFileSafeSync: (...args: any[]) => mocks.writeFileSafeSync(...args),
}));
vi.mock("../../../services/downloaders/bilibili/bilibiliCookie", () => ({
  getCookieHeader: (...args: any[]) => mocks.getCookieHeader(...args),
}));

import { downloadSubtitles } from "../../../services/downloaders/bilibili/bilibiliSubtitle";

describe("bilibiliSubtitle.downloadSubtitles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractBilibiliVideoId.mockReturnValue("BV1xx");
    mocks.getCookieHeader.mockReturnValue("SESSDATA=abc");
    mocks.buildAllowlistedHttpUrl.mockImplementation((u: string) => u);
    mocks.bccToVtt.mockReturnValue("WEBVTT\n\n00:00.000 --> 00:01.000\nhi");
    // Pass-through path helpers that preserve the provided directory.
    mocks.resolveSafePathInDirectories.mockImplementation((p: string) => p);
    mocks.resolveSafeChildPath.mockImplementation(
      (dir: string, name: string) => `${dir}/${name}`
    );
    mocks.axiosGet.mockImplementation((url: string) => {
      if (url.includes("/x/web-interface/view")) {
        return Promise.resolve({ data: { data: { cid: 123 } } });
      }
      if (url.includes("/x/player/wbi/v2")) {
        return Promise.resolve({
          data: {
            data: {
              subtitle: {
                subtitles: [{ lan: "zh-CN", subtitle_url: "//cdn/sub.json" }],
              },
            },
          },
        });
      }
      // subtitle CDN
      return Promise.resolve({ data: { body: [] } });
    });
  });

  it("writes subtitles into the provided video directory, not the storage root (issue #295)", async () => {
    const result = await downloadSubtitles(
      "https://www.bilibili.com/video/BV1xx",
      "My Video-Author-2026",
      "/data/videos/Author A/Season 1",
      "/videos/Author A/Season 1"
    );

    expect(mocks.writeFileSafeSync).toHaveBeenCalledTimes(1);
    const [writtenPath, allowedRoot] = mocks.writeFileSafeSync.mock.calls[0];
    expect(writtenPath).toBe(
      "/data/videos/Author A/Season 1/My Video-Author-2026.zh-CN.vtt"
    );
    // Allowed write boundary is the storage root that the subdir lives under.
    expect(allowedRoot).toBe("/data/videos");
    // Returned web path preserves the subdirectory rather than collapsing to /videos.
    expect(result).toEqual([
      {
        language: "zh-CN",
        filename: "My Video-Author-2026.zh-CN.vtt",
        path: "/videos/Author A/Season 1/My Video-Author-2026.zh-CN.vtt",
      },
    ]);
    expect(mocks.ensureDirSafeSync).toHaveBeenCalledWith(
      "/data/videos/Author A/Season 1",
      "/data/videos"
    );
  });

  it("preserves a collection subdirectory under the subtitles root", async () => {
    const result = await downloadSubtitles(
      "https://www.bilibili.com/video/BV1xx",
      "Ep01-Author-2026",
      "/data/subtitles/Series",
      "/subtitles/Series"
    );

    expect(result[0].path).toBe("/subtitles/Series/Ep01-Author-2026.zh-CN.vtt");
    expect(mocks.writeFileSafeSync.mock.calls[0][1]).toBe("/data/subtitles");
  });

  it("falls back to the root when the provided directory is outside it", async () => {
    mocks.resolveSafePathInDirectories.mockImplementation(() => {
      throw new Error("Path traversal detected");
    });

    const result = await downloadSubtitles(
      "https://www.bilibili.com/video/BV1xx",
      "Ep01-Author-2026",
      "/etc/evil",
      "/videos/Author A"
    );

    // Wrote to the root, not the rejected directory.
    expect(mocks.writeFileSafeSync.mock.calls[0][0]).toBe(
      "/data/videos/Ep01-Author-2026.zh-CN.vtt"
    );
    // Web prefix still reflects the requested subdirectory string.
    expect(result[0].path).toBe("/videos/Author A/Ep01-Author-2026.zh-CN.vtt");
    expect(mocks.logger.warn).toHaveBeenCalled();
  });
});
