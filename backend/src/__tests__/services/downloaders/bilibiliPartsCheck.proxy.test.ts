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
    getEffectiveUserYtDlpConfig: (url: any) => mocks.getUserYtDlpConfig(url),
    InvalidProxyError,
  };
});

import {
  checkCollectionOrSeries,
  checkVideoParts,
} from "../../../services/downloaders/bilibili/bilibiliApi";
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
