import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/security", () => ({
  readFileSafeSync: vi.fn(),
  resolveSafeChildPath: vi.fn(() => "/data/cookies.txt"),
  statSafeSync: vi.fn(() => ({ mtimeMs: 1, size: 2 })),
  writeFileSafeSync: vi.fn(),
}));

import { readFileSafeSync } from "../../utils/security";
import {
  getCookieHeaderForUrl,
  resetCookiesFileCache,
} from "../../utils/ytdlp/cookies";

const VIEW_URL = "https://api.bilibili.com/x/web-interface/view?bvid=BV1";
const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const PAST = Math.floor(Date.now() / 1000) - 86400;

const COOKIES_FILE =
  [
    "# Netscape HTTP Cookie File",
    "#HttpOnly_.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tabc",
    `.bilibili.com\tTRUE\t/\tFALSE\t${FUTURE}\tbuvid3\tdef`,
    ".bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tstale-duplicate",
    "passport.bilibili.com\tFALSE\t/\tTRUE\t0\tHOST_ONLY\tnope",
    ".youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tzzz",
  ].join("\n") + "\n";

describe("getCookieHeaderForUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCookiesFileCache();
    vi.mocked(readFileSafeSync).mockReturnValue(COOKIES_FILE as never);
  });

  it("builds a Cookie header from the domains that match the host", () => {
    // Bilibili's web API answers 412 to cookieless requests, so the stored
    // cookies have to reach the direct API calls, not just yt-dlp.
    expect(getCookieHeaderForUrl(VIEW_URL)).toBe(
      "SESSDATA=abc; buvid3=def"
    );
  });

  it("returns null when nothing in the file applies to the host", () => {
    expect(getCookieHeaderForUrl("https://api.twitch.tv/helix/videos")).toBeNull();
  });

  it("keeps host-only cookies off unrelated subdomains", () => {
    expect(getCookieHeaderForUrl("https://passport.bilibili.com/x/passport-login/web/login")).toContain(
      "HOST_ONLY=nope"
    );
    expect(getCookieHeaderForUrl(VIEW_URL)).not.toContain(
      "HOST_ONLY"
    );
  });

  it("skips a path-scoped cookie that does not cover the request", () => {
    // A path-scoped row must not claim the name, or it both goes where it does
    // not belong and hides the row that actually applies to this endpoint.
    vi.mocked(readFileSafeSync).mockReturnValue(
      [
        "# Netscape HTTP Cookie File",
        ".bilibili.com\tTRUE\t/foo\tFALSE\t0\tSESSDATA\tscoped",
        ".bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tapplicable",
      ].join("\n") + "\n" as never
    );

    expect(getCookieHeaderForUrl(VIEW_URL)).toBe("SESSDATA=applicable");
  });

  it("drops an expired cookie and still sends the live one that follows it", () => {
    // Exports routinely carry both, oldest first. Claiming the name for the
    // expired line would have sent a dead credential and hidden the good one.
    vi.mocked(readFileSafeSync).mockReturnValue(
      [
        "# Netscape HTTP Cookie File",
        `.bilibili.com\tTRUE\t/\tFALSE\t${PAST}\tSESSDATA\tstale`,
        `.bilibili.com\tTRUE\t/\tFALSE\t${FUTURE}\tSESSDATA\tlive`,
      ].join("\n") + "\n" as never
    );

    expect(getCookieHeaderForUrl(VIEW_URL)).toBe("SESSDATA=live");
  });
});
