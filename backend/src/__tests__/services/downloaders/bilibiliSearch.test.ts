/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  getUserYtDlpConfig: vi.fn(),
  getAxiosProxyConfig: vi.fn(),
  buildSignedBilibiliUrl: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserYtDlpConfig.mockReturnValue({});
  mocks.buildSignedBilibiliUrl.mockResolvedValue(SIGNED_URL);
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

    await expect(searchVideos("python")).resolves.toEqual([]);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("-352")
    );
  });

  it("skips the request rather than exposing the real IP when the proxy is unusable", async () => {
    const { InvalidProxyError } = await import("../../../utils/ytdlp/proxy");
    mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "not-a-proxy" });
    mocks.getAxiosProxyConfig.mockImplementation(() => {
      throw new InvalidProxyError("bad proxy");
    });

    await expect(searchVideos("python")).resolves.toEqual([]);
    expect(mocks.axiosGet).not.toHaveBeenCalled();
  });
});
