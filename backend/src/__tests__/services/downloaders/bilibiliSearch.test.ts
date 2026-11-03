/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  getUserYtDlpConfig: vi.fn(),
  getAxiosProxyConfig: vi.fn(),
  buildSignedBilibiliUrl: vi.fn(),
  headers: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return { ...actual, default: { ...actual.default, get: mocks.axiosGet } };
});
vi.mock("../../../services/downloaders/bilibili/bilibiliHeaders", () => ({ buildBilibiliApiHeaders: mocks.headers }));

vi.mock("../../../utils/logger", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, logger: mocks.logger };
});

// bilibiliConfig reads settings at import time through the storage layer.
vi.mock("../../../services/storageService", () => ({
  getSettings: () => ({}),
}));

vi.mock("../../../utils/ytDlpUtils", async () => {
  const { InvalidProxyError } = await import("../../../utils/ytdlp/proxy");
  return {
    getAxiosProxyConfig: (...args: any[]) => mocks.getAxiosProxyConfig(...args),
    getUserYtDlpConfig: (...args: any[]) => mocks.getUserYtDlpConfig(...args),
    getEffectiveUserYtDlpConfig: (...args: any[]) =>
      mocks.getUserYtDlpConfig(...args),
    getNetworkConfigFromUserConfig: () => ({}),
    InvalidProxyError,
  };
});

// The signing itself has its own suite; here only the params handed to it matter.
vi.mock("../../../services/downloaders/bilibili/bilibiliWbi", () => ({
  buildSignedBilibiliUrl: (...args: any[]) =>
    mocks.buildSignedBilibiliUrl(...args),
}));

import {
  formatSearchEntry,
  parseSearchDuration,
  searchVideos,
  stripSearchHighlight,
} from "../../../services/downloaders/bilibili/bilibiliSearch";

const SIGNED_URL = "https://api.bilibili.com/x/web-interface/wbi/search/type?signed";

const anEntry = (overrides: Record<string, unknown> = {}) => ({
  bvid: "BV1rpWjevEip",
  title: 'A <em class="keyword">Python</em> guide',
  author: "Some UP",
  pic: "//i2.hdslb.com/bfs/archive/cover.jpg",
  duration: "12:34",
  play: 4321,
  ...overrides,
});

const respondWith = (result: unknown[], code = 0) => {
  mocks.axiosGet.mockResolvedValue({ data: { code, data: { result } } });
};

/** The upstream page size the service asks for, so a page counts as full. */
const FULL_PAGE = 50;

const aFullPageOf = (entries: unknown[]) => [
  ...entries,
  ...Array.from({ length: FULL_PAGE - entries.length }, (_, index) =>
    anEntry({ bvid: `BVfill${index}` })
  ),
];

const aFullInvalidPage = () =>
  Array.from({ length: FULL_PAGE }, () => anEntry({ bvid: undefined }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserYtDlpConfig.mockReturnValue({});
  mocks.buildSignedBilibiliUrl.mockResolvedValue(SIGNED_URL);
  mocks.headers.mockReturnValue({ Referer: "https://www.bilibili.com" });
});

describe("stripSearchHighlight", () => {
  it("removes the match highlight markup and decodes entities", () => {
    expect(
      stripSearchHighlight('<em class="keyword">Bob</em> &amp; &quot;Jan&quot;')
    ).toBe('Bob & "Jan"');
  });

  it("returns an empty string for a missing title", () => {
    expect(stripSearchHighlight(undefined)).toBe("");
  });

  it("leaves no tag behind for nested or malformed markup", () => {
    expect(stripSearchHighlight("<<em>script>alert(1)")).toBe("script>alert(1)");
    expect(stripSearchHighlight("<a<b>c</b>")).toBe("c");
    // The property that matters: whatever the nesting, nothing tag-shaped survives.
    for (const input of ["<<em>em>x", "<a<b>>y", "<em><em>z</em></em>"]) {
      expect(stripSearchHighlight(input)).not.toMatch(/<[^>]*>/);
    }
  });

  it("keeps an escaped tag in a real title as visible text", () => {
    // Decoding runs after the strip, so this stays text rather than becoming a
    // tag the strip has already passed over.
    expect(stripSearchHighlight("How &lt;b&gt; works")).toBe("How <b> works");
  });
});

describe("parseSearchDuration", () => {
  it("folds colon-separated parts into seconds", () => {
    expect(parseSearchDuration("12:34")).toBe(754);
    expect(parseSearchDuration("1:02:03")).toBe(3723);
  });

  it("does not cap the leading part at 60 minutes", () => {
    // Bilibili reports a 39h58m course as "2398:14", not "39:58:14".
    expect(parseSearchDuration("2398:14")).toBe(2398 * 60 + 14);
  });

  it("returns undefined for a value it cannot read", () => {
    expect(parseSearchDuration("")).toBeUndefined();
    expect(parseSearchDuration("live")).toBeUndefined();
    expect(parseSearchDuration(undefined)).toBeUndefined();
  });
});

describe("formatSearchEntry", () => {
  it("maps a hit onto the shape the search endpoint returns for YouTube", () => {
    expect(formatSearchEntry(anEntry())).toEqual({
      id: "BV1rpWjevEip",
      title: "A Python guide",
      author: "Some UP",
      thumbnailUrl: "https://i2.hdslb.com/bfs/archive/cover.jpg",
      duration: 754,
      viewCount: 4321,
      sourceUrl: "https://www.bilibili.com/video/BV1rpWjevEip",
      source: "bilibili",
    });
  });

  it("drops a hit with no bvid, which is not a downloadable video page", () => {
    expect(formatSearchEntry(anEntry({ bvid: undefined }))).toBeNull();
  });
});

describe("searchVideos", () => {
  it("requests the first page by default", async () => {
    respondWith([]);

    await searchVideos("python");

    expect(mocks.buildSignedBilibiliUrl).toHaveBeenCalledWith(
      "https://api.bilibili.com/x/web-interface/wbi/search/type",
      { search_type: "video", keyword: "python", page: 1, page_size: FULL_PAGE },
      expect.anything()
    );
  });

  it("counts the offset in kept results, not in raw hits", async () => {
    // Two dropped hits in the first three: without this, an offset of 2 would
    // land on the second raw hit, which is one the caller never received.
    respondWith([
      anEntry({ bvid: "BV1" }),
      anEntry({ bvid: undefined }),
      anEntry({ bvid: undefined }),
      anEntry({ bvid: "BV2" }),
      anEntry({ bvid: "BV3" }),
    ]);

    const results = await searchVideos("python", 8, 2);

    expect(results.map((result: any) => result.id)).toEqual(["BV2", "BV3"]);
  });

  it("reads a further page when the first cannot fill the request", async () => {
    mocks.axiosGet
      .mockResolvedValueOnce({
        data: { code: 0, data: { result: aFullPageOf([]) } },
      })
      .mockResolvedValueOnce({
        data: { code: 0, data: { result: [anEntry({ bvid: "BVnext" })] } },
      });

    const results = await searchVideos("python", 8, FULL_PAGE + 1);

    expect(mocks.axiosGet).toHaveBeenCalledTimes(2);
    expect(mocks.buildSignedBilibiliUrl).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ page: 2 }),
      expect.anything()
    );
    expect(results.map((result: any) => result.id)).toEqual(["BVnext"]);
  });

  it("keeps reading past four raw pages when filtered entries leave the requested window empty", async () => {
    mocks.axiosGet
      .mockResolvedValueOnce({
        data: { code: 0, data: { result: aFullInvalidPage() } },
      })
      .mockResolvedValueOnce({
        data: { code: 0, data: { result: aFullInvalidPage() } },
      })
      .mockResolvedValueOnce({
        data: { code: 0, data: { result: aFullInvalidPage() } },
      })
      .mockResolvedValueOnce({
        data: { code: 0, data: { result: aFullInvalidPage() } },
      })
      .mockResolvedValueOnce({
        data: { code: 0, data: { result: [anEntry({ bvid: "BVpage5" })] } },
      });

    const results = await searchVideos("python", 1, 1);

    expect(mocks.axiosGet).toHaveBeenCalledTimes(5);
    expect(results.map((result: any) => result.id)).toEqual(["BVpage5"]);
  });

  it("stops at a short page rather than asking for one past the end", async () => {
    respondWith([anEntry({ bvid: "BV1" })]);

    const results = await searchVideos("python", 8, 1);

    expect(mocks.axiosGet).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it("returns no more than the requested number of results", async () => {
    respondWith(aFullPageOf([]));

    const results = await searchVideos("python", 8, 1);

    expect(results).toHaveLength(8);
  });

  it("stops at the request ceiling instead of walking to an uncapped offset", async () => {
    // The controller does not cap `offset`, so without a ceiling one request
    // carrying a huge one is amplified into as many upstream requests as it
    // takes to reach it.
    respondWith(aFullPageOf([]));

    const results = await searchVideos("python", 8, 10_000_000);

    expect(mocks.axiosGet).toHaveBeenCalledTimes(8);
    expect(results).toEqual([]);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("request ceiling")
    );
  });

  it("returns the formatted hits, skipping ones without a bvid", async () => {
    respondWith([anEntry(), anEntry({ bvid: undefined }), anEntry({ bvid: "BV2" })]);

    const results = await searchVideos("python");

    expect(results.map((result: any) => result.id)).toEqual([
      "BV1rpWjevEip",
      "BV2",
    ]);
  });

  it("reports an application-level failure rather than passing it off as no results", async () => {
    // Risk control answers HTTP 200 with a non-zero code, so nothing throws.
    respondWith([anEntry()], -352);

    await expect(searchVideos("python")).rejects.toMatchObject({ code: "BILIBILI_SEARCH_RISK_CONTROLLED" });
    expect(mocks.logger.warn).toHaveBeenCalledWith("Bilibili video search was blocked by upstream risk control", {
      page: 1, httpStatus: undefined, apiCode: -352,
    });
  });

  it("skips the request rather than exposing the real IP when the proxy is unusable", async () => {
    const { InvalidProxyError } = await import("../../../utils/ytdlp/proxy");
    mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "not-a-proxy" });
    mocks.getAxiosProxyConfig.mockImplementation(() => {
      throw new InvalidProxyError("bad proxy");
    });

    await expect(searchVideos("python")).rejects.toMatchObject({ code: "BILIBILI_SEARCH_UNAVAILABLE" });
    expect(mocks.axiosGet).not.toHaveBeenCalled();
  });
  it.each([{ code: 0, data: { v_voucher: "challenge" } }, { code: -352 }, { code: -412 }])("retries a cookie rejection anonymously with the same proxy: %j", async (data) => {
    const headers = { Referer: "https://www.bilibili.com", Cookie: "stored-cookie" };
    const proxy = { proxy: { host: "proxy.example", port: 8080 } };
    mocks.headers.mockReturnValue(headers);
    mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "http://proxy.example:8080" });
    mocks.getAxiosProxyConfig.mockReturnValue(proxy);
    mocks.axiosGet.mockResolvedValueOnce({ data }).mockResolvedValueOnce({ data: { code: 0, data: { result: [anEntry()] } } });
    expect(await searchVideos("python")).toHaveLength(1);
    expect(mocks.axiosGet).toHaveBeenCalledTimes(2);
    const [endpoint, first] = mocks.axiosGet.mock.calls[0];
    const [retryEndpoint, retry] = mocks.axiosGet.mock.calls[1];
    expect(endpoint).toBe("https://api.bilibili.com/x/web-interface/wbi/search/type");
    expect(retryEndpoint).toBe(endpoint);
    expect(first.headers.Cookie).toBe("stored-cookie");
    expect(retry.headers).toEqual({ Referer: "https://www.bilibili.com" });
    const { default: axios } = await vi.importActual<typeof import("axios")>("axios");
    expect(axios.getUri({ ...retry, url: retryEndpoint })).toBe(axios.getUri({ ...first, url: endpoint }));
    expect(retry.proxy).toBe(proxy.proxy);
    expect(retry.maxRedirects).toBe(0);
    expect(headers.Cookie).toBe("stored-cookie");
  });
  it("recovers from HTTP 412 and keeps later pages anonymous", async () => {
    mocks.headers.mockReturnValue({ Cookie: "stored-cookie" });
    mocks.axiosGet.mockRejectedValueOnce({ isAxiosError: true, response: { status: 412, data: {} } })
      .mockResolvedValueOnce({ data: { code: 0, data: { result: aFullPageOf([]) } } })
      .mockResolvedValueOnce({ data: { code: 0, data: { result: [anEntry({ bvid: "BVnext" })] } } });
    const results = await searchVideos("python", 1, FULL_PAGE + 1);
    expect(results[0].id).toBe("BVnext");
    expect(mocks.axiosGet).toHaveBeenCalledTimes(3);
    for (const [, config] of mocks.axiosGet.mock.calls.slice(1)) expect(config.headers.Cookie).toBeUndefined();
  });
  it.each([false, true])("bounds persistent risk control and reports an error (cookie: %s)", async (withCookie) => {
    mocks.headers.mockReturnValue(withCookie ? { Cookie: "stored-cookie" } : {});
    mocks.axiosGet.mockResolvedValue({ data: { code: 0, data: { v_voucher: "challenge" } } });
    await expect(searchVideos("python")).rejects.toMatchObject({ code: "BILIBILI_SEARCH_RISK_CONTROLLED" });
    expect(mocks.axiosGet).toHaveBeenCalledTimes(withCookie ? 2 : 1);
    expect(mocks.logger.warn.mock.calls.filter(([message]) => message === "Bilibili video search was blocked by upstream risk control")).toHaveLength(1);
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain("challenge");
  });
  it("allows only one additional anonymous request across the bounded page walk", async () => {
    mocks.headers.mockReturnValue({ Cookie: "stored-cookie" });
    mocks.axiosGet.mockResolvedValueOnce({ data: { code: -352 } })
      .mockResolvedValue({ data: { code: 0, data: { result: aFullPageOf([]) } } });
    await expect(searchVideos("python", 8, 10_000_000)).resolves.toEqual([]);
    expect(mocks.axiosGet).toHaveBeenCalledTimes(9);
    expect(mocks.buildSignedBilibiliUrl).toHaveBeenCalledTimes(8);
    for (const [, config] of mocks.axiosGet.mock.calls.slice(1)) expect(config.headers.Cookie).toBeUndefined();
  });
  it.each([
    { code: 0, data: {} }, { code: -500 }, undefined,
  ])("does not report malformed or rejected responses as empty results: %j", async (data) => {
    mocks.axiosGet.mockResolvedValue({ data });
    await expect(searchVideos("python")).rejects.toMatchObject({ code: "BILIBILI_SEARCH_UNAVAILABLE" });
    expect(mocks.axiosGet).toHaveBeenCalledTimes(1);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      data?.code === 0 ? "Bilibili video search response had no result array" : "Bilibili video search returned an unexpected API response",
      expect.objectContaining({ page: 1 }),
    );
  });
  it("accepts an explicitly empty result without a result array", async () => {
    mocks.axiosGet.mockResolvedValue({ data: { code: 0, data: { numResults: 0 } } });
    await expect(searchVideos("python")).resolves.toEqual([]);
  });
  it("preserves signed query encoding with a fixed destination", async () => {
    const keyword = "极客 湾 + & https://127.0.0.1/private";
    const query = `keyword=${encodeURIComponent(keyword)}&w_rid=signature`;
    mocks.buildSignedBilibiliUrl.mockResolvedValue(`https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`);
    respondWith([]);
    await searchVideos(keyword);
    const { default: axios } = await vi.importActual<typeof import("axios")>("axios");
    const [url, config] = mocks.axiosGet.mock.calls[0];
    expect(axios.getUri({ ...config, url })).toBe(`https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`);
  });
  it("keeps network failures separate from risk control and never retries them anonymously", async () => {
    mocks.headers.mockReturnValue({ Cookie: "stored-cookie" });
    mocks.axiosGet.mockRejectedValue(new Error("timeout"));
    await expect(searchVideos("python")).rejects.toMatchObject({ code: "BILIBILI_SEARCH_UNAVAILABLE" });
    expect(mocks.axiosGet).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["ECONNABORTED", undefined], ["ERR_BAD_RESPONSE", 503], ["ERR_BAD_RESPONSE", 302],
  ])("logs safe transport diagnostics for %s/%s without exception contents", async (code, status) => {
    mocks.axiosGet.mockRejectedValue({
      isAxiosError: true, code, message: "sensitive-exception-message",
      config: { headers: { Cookie: "private-cookie" }, proxy: { auth: { password: "proxy-password" } } },
      response: status ? { status, data: { message: "private-response" } } : undefined,
    });
    await expect(searchVideos("private-query")).rejects.toMatchObject({ code: "BILIBILI_SEARCH_UNAVAILABLE" });
    expect(mocks.logger.warn).toHaveBeenCalledExactlyOnceWith("Bilibili video search request failed", {
      page: 1, errorCode: code, httpStatus: status,
    });
  });
});
