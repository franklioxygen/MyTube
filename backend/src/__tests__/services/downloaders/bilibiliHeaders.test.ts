import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCookieHeaderForUrl: vi.fn(),
}));

vi.mock("../../../utils/ytdlp/cookies", () => ({
  getCookieHeaderForUrl: (...args: any[]) => mocks.getCookieHeaderForUrl(...args),
}));

import { buildBilibiliApiHeaders } from "../../../services/downloaders/bilibili/bilibiliHeaders";

const API_URL = "https://api.bilibili.com/x/web-interface/view?bvid=BV1xx";

describe("buildBilibiliApiHeaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches the cookies selected for that exact request URL", () => {
    // Cookieless x/web-interface/view answers 412, so every Bilibili API call
    // has to go through here rather than hand-rolling a header pair.
    mocks.getCookieHeaderForUrl.mockReturnValue("SESSDATA=abc");

    const headers = buildBilibiliApiHeaders(API_URL);

    expect(mocks.getCookieHeaderForUrl).toHaveBeenCalledWith(API_URL);
    expect(headers).toMatchObject({
      Referer: "https://www.bilibili.com",
      Cookie: "SESSDATA=abc",
    });
    expect(headers["User-Agent"]).toContain("Chrome/120.0.0.0 Safari/537.36");
  });

  it("omits the Cookie header when no cookie applies", () => {
    mocks.getCookieHeaderForUrl.mockReturnValue(null);

    expect(buildBilibiliApiHeaders(API_URL)).not.toHaveProperty("Cookie");
  });
});
