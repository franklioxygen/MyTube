import { Readable } from "node:stream";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bilibiliDanmakuIdentity, extractDanmakuCid, fetchBilibiliDanmaku } from "../../services/danmaku/bilibili";
import { resolveProxiedAxiosConfigForUrl } from "../../services/downloaders/bilibili/bilibiliConfig";
import { getProxyBypassHosts } from "../../utils/ytDlpUtils";
vi.mock("axios", () => ({ default: { get: vi.fn() } }));
vi.mock("../../services/downloaders/bilibili/bilibiliConfig", () => ({ resolveProxiedAxiosConfigForUrl: vi.fn() }));
vi.mock("../../services/downloaders/bilibili/bilibiliHeaders", () => ({ buildBilibiliApiHeaders: () => ({ Referer: "https://www.bilibili.com/" }) }));
vi.mock("../../utils/ytDlpUtils", () => ({ getProxyBypassHosts: vi.fn() }));
const item = { id: "video", title: "Test", createdAt: "now", sourceUrl: "https://www.bilibili.com/video/BV1test?p=2", partNumber: 2 };
const response = (body: string | Buffer) => ({ data: Readable.from([body]) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveProxiedAxiosConfigForUrl).mockReturnValue({ proxy: false });
  vi.mocked(getProxyBypassHosts).mockReturnValue([]);
});
describe("exact-part Bilibili XML adapter", () => {
  it("resolves the requested page instead of the top-level first-part CID", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce(response(JSON.stringify({ code: 0, data: { cid: 111, pages: [{ page: 1, cid: 111 }, { page: 2, cid: 222 }] } })))
      .mockResolvedValueOnce(response("<i><chatid>222</chatid></i>"));
    expect(await fetchBilibiliDanmaku(item, new AbortController().signal)).toMatchObject({ cid: "222" });
    expect(axios.get).toHaveBeenLastCalledWith("https://comment.bilibili.com/222.xml", expect.objectContaining({ maxRedirects: 0, timeout: 15000 }));
  });
  it("uses page one for a collection episode, whose partNumber is its ordinal in the collection", async () => {
    const episode = { ...item, sourceUrl: "https://www.bilibili.com/video/BV1episode", partNumber: 3 };
    vi.mocked(axios.get).mockResolvedValueOnce(response(JSON.stringify({ code: 0, data: { pages: [{ page: 1, cid: 111 }] } })))
      .mockResolvedValueOnce(response("<i><chatid>111</chatid></i>"));
    expect(await fetchBilibiliDanmaku(episode, new AbortController().signal)).toMatchObject({ cid: "111" });
  });
  it("uses a validated metadata hint without requesting video metadata again", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce(response("<i><chatid>222</chatid></i>"));
    await fetchBilibiliDanmaku(item, new AbortController().signal, { cid: "222", subscriptionConfig: "--proxy http://proxy:8080" });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(resolveProxiedAxiosConfigForUrl).toHaveBeenCalledWith("https://comment.bilibili.com/222.xml", "--proxy http://proxy:8080");
  });
  it("does not fall back to the first page when the requested part is absent", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce(response(JSON.stringify({ code: 0, data: { cid: 111, pages: [{ page: 1, cid: 111 }] } })));
    await expect(fetchBilibiliDanmaku(item, new AbortController().signal)).rejects.toThrow("danmakuMissingCid");
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
  it("limits concurrent outbound requests to two", async () => {
    const releases: Array<() => void> = [];
    vi.mocked(axios.get).mockImplementation(() => new Promise(resolve => releases.push(() => resolve(response("<i><chatid>222</chatid></i>")))));
    const jobs = [1, 2, 3].map(() => fetchBilibiliDanmaku(item, new AbortController().signal, { cid: "222" }));
    await vi.waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));
    releases[0]();
    await vi.waitFor(() => expect(axios.get).toHaveBeenCalledTimes(3));
    releases[1](); releases[2]();
    expect(await Promise.all(jobs)).toHaveLength(3);
  });
  it("never sends a request directly when the configured proxy is invalid", async () => {
    vi.mocked(resolveProxiedAxiosConfigForUrl).mockReturnValue(null);
    await expect(fetchBilibiliDanmaku(item, new AbortController().signal, { cid: "222" })).rejects.toThrow("danmakuProxyUnavailable");
    expect(axios.get).not.toHaveBeenCalled();
  });
  it("keeps yt-dlp's proxy bypass list out of its Axios requests", async () => {
    const proxy = { host: "proxy", port: 8080 };
    vi.mocked(getProxyBypassHosts).mockReturnValue(["comment.bilibili.com"]);
    vi.mocked(resolveProxiedAxiosConfigForUrl).mockReturnValue({ proxy });
    vi.mocked(axios.get).mockResolvedValueOnce(response("<i><chatid>222</chatid></i>"));
    await fetchBilibiliDanmaku(item, new AbortController().signal, { cid: "222" });
    expect(axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ proxy }));
  });
  it.each([404, 412, 429])("propagates HTTP %s without repeated retries", async status => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error(`HTTP ${status}`));
    await expect(fetchBilibiliDanmaku(item, new AbortController().signal, { cid: "222" })).rejects.toThrow();
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
  it("bounds decompressed bytes and rejects non-UTF-8 responses", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce(response(Buffer.alloc(8 * 1024 * 1024 + 1)));
    await expect(fetchBilibiliDanmaku(item, new AbortController().signal, { cid: "222" })).rejects.toThrow("danmakuTooLarge");
    vi.mocked(axios.get).mockResolvedValueOnce(response(Buffer.from([0xff])));
    await expect(fetchBilibiliDanmaku(item, new AbortController().signal, { cid: "222" })).rejects.toThrow();
  });
  it("rejects unsupported sources and invalid part numbers", () => {
    expect(bilibiliDanmakuIdentity(item)).toEqual({ id: "BV1test", part: 2 });
    expect(() => bilibiliDanmakuIdentity({ sourceUrl: "https://evil.test/video/BV1test" })).toThrow();
    expect(bilibiliDanmakuIdentity({ sourceUrl: "https://www.bilibili.com/video/BV1test" })).toEqual({ id: "BV1test", part: 1 });
    expect(() => bilibiliDanmakuIdentity({ sourceUrl: "https://www.bilibili.com/video/BV1test?p=-1" })).toThrow();
    expect(() => bilibiliDanmakuIdentity({ sourceUrl: "https://www.bilibili.com/video/BV1test?p=x" })).toThrow();
  });
  it("accepts only exact CID or trusted extractor XML hints", () => {
    expect(extractDanmakuCid({ cid: 123 })).toBe("123");
    expect(extractDanmakuCid({ cid: Number.MAX_SAFE_INTEGER + 1 })).toBeUndefined();
    expect(extractDanmakuCid({ subtitles: { danmaku: [{ url: "https://comment.bilibili.com/456.xml" }] } })).toBe("456");
    expect(extractDanmakuCid({ subtitles: { danmaku: [{ url: "https://evil.test/456.xml" }] } })).toBeUndefined();
  });
});
