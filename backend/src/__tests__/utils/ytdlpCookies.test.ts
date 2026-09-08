import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/security", () => ({
  readFileSafeSync: vi.fn(),
  resolveSafeChildPath: vi.fn(() => "/data/cookies.txt"),
  statSafeSync: vi.fn(() => ({ mtimeMs: 1, size: 2 })),
  writeFileSafeSync: vi.fn(),
}));

import { readFileSafeSync } from "../../utils/security";
import {
  getCookieHeaderForHost,
  resetCookiesFileCache,
} from "../../utils/ytdlp/cookies";

const COOKIES_FILE =
  [
    "# Netscape HTTP Cookie File",
    "#HttpOnly_.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tabc",
    ".bilibili.com\tTRUE\t/\tFALSE\t0\tbuvid3\tdef",
    ".bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tstale-duplicate",
    "passport.bilibili.com\tFALSE\t/\tTRUE\t0\tHOST_ONLY\tnope",
    ".youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tzzz",
  ].join("\n") + "\n";

describe("getCookieHeaderForHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCookiesFileCache();
    vi.mocked(readFileSafeSync).mockReturnValue(COOKIES_FILE as never);
  });

  it("builds a Cookie header from the domains that match the host", () => {
    // Bilibili's web API answers 412 to cookieless requests, so the stored
    // cookies have to reach the direct API calls, not just yt-dlp.
    expect(getCookieHeaderForHost("api.bilibili.com")).toBe(
      "SESSDATA=abc; buvid3=def"
    );
  });

  it("returns null when nothing in the file applies to the host", () => {
    expect(getCookieHeaderForHost("api.twitch.tv")).toBeNull();
  });

  it("keeps host-only cookies off unrelated subdomains", () => {
    expect(getCookieHeaderForHost("passport.bilibili.com")).toContain(
      "HOST_ONLY=nope"
    );
    expect(getCookieHeaderForHost("api.bilibili.com")).not.toContain(
      "HOST_ONLY"
    );
  });
});
