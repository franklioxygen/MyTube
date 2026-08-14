/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  getUserYtDlpConfig: vi.fn(),
  getAxiosProxyConfig: vi.fn(),
  getNetworkConfigFromUserConfig: vi.fn(),
  executeYtDlpJson: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("axios", () => ({
  default: { get: (...args: any[]) => mocks.axiosGet(...args) },
}));

vi.mock("../../../utils/logger", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, logger: mocks.logger };
});

vi.mock("../../../services/storageService", () => ({
  getSettings: () => ({}),
}));

// resolveProxiedAxiosConfig itself is deliberately NOT mocked — this exercises
// the real skip-vs-proxy decision. Only its inputs are stubbed.
vi.mock("../../../utils/ytDlpUtils", async () => {
  const { InvalidProxyError } = await import("../../../utils/ytdlp/proxy");
  return {
    executeYtDlpJson: (...args: any[]) => mocks.executeYtDlpJson(...args),
    getAxiosProxyConfig: (...args: any[]) => mocks.getAxiosProxyConfig(...args),
    getNetworkConfigFromUserConfig: (...args: any[]) =>
      mocks.getNetworkConfigFromUserConfig(...args),
    getUserYtDlpConfig: (...args: any[]) => mocks.getUserYtDlpConfig(...args),
    // Forwards both args so tests can assert a subscription override reached it.
    getEffectiveUserYtDlpConfig: (...args: any[]) =>
      mocks.getUserYtDlpConfig(...args),
    InvalidProxyError,
  };
});

// bilibiliCollection pulls in the whole single-part download chain otherwise.
vi.mock("../../../services/downloaders/bilibili/bilibiliVideo", () => ({
  downloadSinglePart: vi.fn(),
}));

import {
  checkCollectionOrSeries,
  checkVideoParts,
  getVideoInfo,
} from "../../../services/downloaders/bilibili/bilibiliApi";
import {
  getCollectionVideos,
  getSeriesVideos,
} from "../../../services/downloaders/bilibili/bilibiliCollection";
import { InvalidProxyError } from "../../../utils/ytdlp/proxy";

const PROXY_AGENT = { proxy: false, httpsAgent: "agent" };

describe("checkVideoParts proxy handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserYtDlpConfig.mockReturnValue({});
    mocks.getAxiosProxyConfig.mockReturnValue({});
  });

  it("routes the parts lookup through the configured proxy", async () => {
    mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "socks5://127.0.0.1:1080" });
    mocks.getAxiosProxyConfig.mockReturnValue(PROXY_AGENT);
    mocks.axiosGet.mockResolvedValue({
      data: { data: { videos: 3, title: "Multipart" } },
    });

    await expect(checkVideoParts("BV1x")).resolves.toEqual({
      success: true,
      videosNumber: 3,
      title: "Multipart",
    });
    expect(mocks.axiosGet).toHaveBeenCalledWith(
      expect.stringContaining("api.bilibili.com"),
      expect.objectContaining(PROXY_AGENT),
    );
  });

  it("skips the lookup rather than sending it directly when the proxy is unusable", async () => {
    mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "not-a-proxy" });
    mocks.getAxiosProxyConfig.mockImplementation(() => {
      throw new InvalidProxyError("not-a-proxy");
    });

    // Reported as a failed check, not as a bogus single-part answer.
    await expect(checkVideoParts("BV1x")).resolves.toEqual({
      success: false,
      videosNumber: 1,
    });
    expect(mocks.axiosGet).not.toHaveBeenCalled();
  });

  it("routes the collection preflight through the configured proxy", async () => {
    mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "socks5://127.0.0.1:1080" });
    mocks.getAxiosProxyConfig.mockReturnValue(PROXY_AGENT);
    mocks.axiosGet.mockResolvedValue({
      data: { data: { owner: { mid: 42 } } },
    });

    await checkCollectionOrSeries("BV1x");

    expect(mocks.axiosGet).toHaveBeenCalledWith(
      expect.stringContaining("api.bilibili.com"),
      expect.objectContaining(PROXY_AGENT),
    );
  });

  it("skips the collection preflight when the proxy is unusable", async () => {
    mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "not-a-proxy" });
    mocks.getAxiosProxyConfig.mockImplementation(() => {
      throw new InvalidProxyError("not-a-proxy");
    });

    await expect(checkCollectionOrSeries("BV1x")).resolves.toEqual({
      success: false,
      type: "none",
    });
    expect(mocks.axiosGet).not.toHaveBeenCalled();
  });

  // A resolved short link routes the queued title lookup through the Bilibili
  // id-specific path, whose yt-dlp failure falls back to this API request.
  describe("getVideoInfo API fallback", () => {
    beforeEach(() => {
      mocks.executeYtDlpJson.mockRejectedValue(new Error("yt-dlp unavailable"));
    });

    it("routes the fallback through the configured proxy", async () => {
      mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "socks5://127.0.0.1:1080" });
      mocks.getAxiosProxyConfig.mockReturnValue(PROXY_AGENT);
      mocks.axiosGet.mockResolvedValue({
        data: { data: { title: "T", owner: { name: "A" }, pubdate: 0 } },
      });

      await expect(getVideoInfo("BV1x")).resolves.toMatchObject({ title: "T" });
      expect(mocks.axiosGet).toHaveBeenCalledWith(
        expect.stringContaining("api.bilibili.com"),
        expect.objectContaining(PROXY_AGENT),
      );
    });

    it("skips the fallback when the proxy is unusable", async () => {
      mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "not-a-proxy" });
      mocks.getAxiosProxyConfig.mockImplementation(() => {
        throw new InvalidProxyError("not-a-proxy");
      });

      // Same placeholder a failed lookup produces, without any request.
      await expect(getVideoInfo("BV1x")).resolves.toMatchObject({
        title: "Bilibili Video",
        author: "Bilibili User",
      });
      expect(mocks.axiosGet).not.toHaveBeenCalled();
    });
  });

  // Selecting a collection from a resolved short link fetches its member pages,
  // so those have to be proxied too.
  describe("collection member page fetches", () => {
    const archivePage = {
      data: {
        code: 0,
        data: {
          archives: [{ bvid: "BV1a", title: "One", aid: 1 }],
          page: { total: 1 },
        },
      },
    };

    it("routes collection and series pages through the configured proxy", async () => {
      mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "socks5://127.0.0.1:1080" });
      mocks.getAxiosProxyConfig.mockReturnValue(PROXY_AGENT);
      mocks.axiosGet.mockResolvedValue(archivePage);

      await expect(getCollectionVideos(42, 7)).resolves.toMatchObject({
        success: true,
      });
      await expect(getSeriesVideos(42, 9)).resolves.toMatchObject({
        success: true,
      });

      for (const call of mocks.axiosGet.mock.calls) {
        expect(call[1]).toMatchObject(PROXY_AGENT);
      }
    });

    it("skips the page fetches when the proxy is unusable", async () => {
      mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "not-a-proxy" });
      mocks.getAxiosProxyConfig.mockImplementation(() => {
        throw new InvalidProxyError("not-a-proxy");
      });

      await expect(getCollectionVideos(42, 7)).resolves.toEqual({
        success: false,
        videos: [],
      });
      await expect(getSeriesVideos(42, 9)).resolves.toEqual({
        success: false,
        videos: [],
      });
      expect(mocks.axiosGet).not.toHaveBeenCalled();
    });

    it("passes a subscription override to the config lookup", async () => {
      mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "socks5://127.0.0.1:1080" });
      mocks.getAxiosProxyConfig.mockReturnValue(PROXY_AGENT);
      mocks.axiosGet.mockResolvedValue(archivePage);

      await getCollectionVideos(42, 7, undefined, "--proxy socks5://sub:1080");

      expect(mocks.getUserYtDlpConfig).toHaveBeenCalledWith(
        "https://space.bilibili.com/42",
        "--proxy socks5://sub:1080",
      );
    });
  });

  it("sends the lookup directly when no proxy is configured", async () => {
    mocks.axiosGet.mockResolvedValue({ data: { data: { videos: 1 } } });

    await checkVideoParts("BV1x");

    expect(mocks.getAxiosProxyConfig).not.toHaveBeenCalled();
    expect(mocks.axiosGet).toHaveBeenCalledWith(
      expect.stringContaining("api.bilibili.com"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });
});
