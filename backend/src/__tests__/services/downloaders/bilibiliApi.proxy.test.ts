/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  executeYtDlpJson: vi.fn(),
  getUserYtDlpConfig: vi.fn(),
  getAxiosProxyConfig: vi.fn(),
  getNetworkConfigFromUserConfig: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("axios", () => ({
  default: { get: (...args: any[]) => mocks.axiosGet(...args) },
}));

vi.mock("../../../utils/logger", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, logger: mocks.logger };
});

// bilibiliConfig reads settings at import time through the storage layer.
vi.mock("../../../services/storageService", () => ({
  getSettings: () => ({}),
}));

// resolveProxiedAxiosConfig itself is deliberately NOT mocked — these tests
// exercise the real skip-vs-proxy decision. Only its inputs are stubbed.
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
  getAuthorInfo,
  getLatestVideoUrl,
} from "../../../services/downloaders/bilibili/bilibiliApi";
import { InvalidProxyError } from "../../../utils/ytdlp/proxy";

const PROXY_AGENT = { proxy: false, httpsAgent: "agent" };

/** Configure a working socks proxy for the request under test. */
const withWorkingProxy = () => {
  mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "socks5://127.0.0.1:1080" });
  mocks.getAxiosProxyConfig.mockReturnValue(PROXY_AGENT);
};

/** Configure a proxy that getAxiosProxyConfig rejects. */
const withBrokenProxy = () => {
  mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "not-a-proxy" });
  mocks.getAxiosProxyConfig.mockImplementation(() => {
    throw new InvalidProxyError("not-a-proxy");
  });
};

const expectProxiedRequest = () => {
  expect(mocks.axiosGet).toHaveBeenCalledWith(
    expect.stringContaining("api.bilibili.com"),
    expect.objectContaining(PROXY_AGENT),
  );
};

describe("Bilibili API proxy handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserYtDlpConfig.mockReturnValue({});
    mocks.getAxiosProxyConfig.mockReturnValue({});
    mocks.getNetworkConfigFromUserConfig.mockReturnValue({});
    // Every API-fallback path below is reached by yt-dlp failing first.
    mocks.executeYtDlpJson.mockRejectedValue(new Error("yt-dlp unavailable"));
  });

  describe("getAuthorInfo", () => {
    it("routes through the configured proxy", async () => {
      withWorkingProxy();
      mocks.axiosGet.mockResolvedValue({
        data: { data: { card: { name: "Author" } } },
      });

      await expect(getAuthorInfo("123")).resolves.toEqual({
        name: "Author",
        mid: "123",
      });
      expectProxiedRequest();
    });

    it("skips the request when the proxy is unusable", async () => {
      withBrokenProxy();

      await expect(getAuthorInfo("123")).resolves.toEqual({
        name: "Bilibili User",
        mid: "123",
      });
      expect(mocks.axiosGet).not.toHaveBeenCalled();
    });

    it("uses the subscription's own proxy while the subscription is being created", async () => {
      // Runs during subscribe(), before the subscription's settings are
      // persisted, so the override has to be passed in rather than looked up.
      withWorkingProxy();
      mocks.axiosGet.mockResolvedValue({
        data: { data: { card: { name: "Author" } } },
      });

      await getAuthorInfo("123", "--proxy socks5://sub:1080");

      expect(mocks.getUserYtDlpConfig).toHaveBeenCalledWith(
        "https://space.bilibili.com/123",
        "--proxy socks5://sub:1080",
      );
      expectProxiedRequest();
    });
  });

  describe("getLatestVideoUrl API fallback", () => {
    it("routes through the configured proxy", async () => {
      withWorkingProxy();
      mocks.axiosGet.mockResolvedValue({
        data: { data: { list: { vlist: [{ bvid: "BV9z" }] } } },
      });

      await expect(
        getLatestVideoUrl("https://space.bilibili.com/123"),
      ).resolves.toBe("https://www.bilibili.com/video/BV9z");
      expectProxiedRequest();
    });

    it("fails rather than reporting an empty space when the proxy is unusable", async () => {
      // Resolving null would make the subscription check read this as "no new
      // video", update lastCheck and record a successful check, leaving the
      // broken proxy invisible. Only a space that was actually read may be
      // reported as empty.
      withBrokenProxy();

      await expect(
        getLatestVideoUrl("https://space.bilibili.com/123"),
      ).rejects.toThrow(/proxy is configured but unusable/);
      expect(mocks.axiosGet).not.toHaveBeenCalled();
    });

    it("propagates a failed API fallback instead of reporting an empty space", async () => {
      withWorkingProxy();
      mocks.axiosGet.mockRejectedValue(new Error("proxy connection reset"));

      await expect(
        getLatestVideoUrl("https://space.bilibili.com/123"),
      ).rejects.toThrow("proxy connection reset");
    });

    it("still reports a genuinely empty space as null", async () => {
      withWorkingProxy();
      mocks.axiosGet.mockResolvedValue({
        data: { data: { list: { vlist: [] } } },
      });

      await expect(
        getLatestVideoUrl("https://space.bilibili.com/123"),
      ).resolves.toBeNull();
    });
  });

  it("sends requests directly when no proxy is configured", async () => {
    mocks.getUserYtDlpConfig.mockReturnValue({});
    mocks.axiosGet.mockResolvedValue({
      data: { data: { card: { name: "Author" } } },
    });

    await getAuthorInfo("123");

    expect(mocks.getAxiosProxyConfig).not.toHaveBeenCalled();
    expect(mocks.axiosGet).toHaveBeenCalledWith(
      expect.stringContaining("api.bilibili.com"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });
});
