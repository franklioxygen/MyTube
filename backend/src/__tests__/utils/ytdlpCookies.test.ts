import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/security", () => ({
  readFileSafeSync: vi.fn(),
  resolveSafeChildPath: vi.fn(() => "/data/cookies.txt"),
  statSafeSync: vi.fn(() => ({ mtimeMs: 1, size: 2 })),
  writeFileSafeSync: vi.fn(),
}));

import { readFileSafeSync, statSafeSync } from "../../utils/security";
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
    "passport.bilibili.com\tFALSE\t/\tTRUE\t0\tHOST_ONLY\tnope",
    ".youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tzzz",
  ].join("\n") + "\n";

describe("getCookieHeaderForUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCookiesFileCache();
    vi.mocked(statSafeSync).mockReturnValue({ mtimeMs: 1, size: 2 } as never);
    vi.mocked(readFileSafeSync).mockReturnValue(COOKIES_FILE as never);
  });

  it("builds a Cookie header from the domains that match the host", () => {
    // Bilibili's web API answers 412 to cookieless requests, so the stored
    // cookies have to reach the direct API calls, not just yt-dlp.
    expect(getCookieHeaderForUrl(VIEW_URL)).toBe("SESSDATA=abc; buvid3=def");
  });

  it("returns null when nothing in the file applies to the host", () => {
    expect(
      getCookieHeaderForUrl("https://api.twitch.tv/helix/videos"),
    ).toBeNull();
  });

  it("keeps host-only cookies off unrelated subdomains", () => {
    expect(
      getCookieHeaderForUrl(
        "https://passport.bilibili.com/x/passport-login/web/login",
      ),
    ).toContain("HOST_ONLY=nope");
    expect(getCookieHeaderForUrl(VIEW_URL)).not.toContain("HOST_ONLY");
  });

  it("skips a path-scoped cookie that does not cover the request", () => {
    // A path-scoped row must not claim the name, or it both goes where it does
    // not belong and hides the row that actually applies to this endpoint.
    vi.mocked(readFileSafeSync).mockReturnValue(
      ([
        "# Netscape HTTP Cookie File",
        ".bilibili.com\tTRUE\t/foo\tFALSE\t0\tSESSDATA\tscoped",
        ".bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tapplicable",
      ].join("\n") + "\n") as never,
    );

    expect(getCookieHeaderForUrl(VIEW_URL)).toBe("SESSDATA=applicable");
  });

  it("drops an expired cookie and still sends the live one that follows it", () => {
    // Exports routinely carry both, oldest first. Claiming the name for the
    // expired line would have sent a dead credential and hidden the good one.
    vi.mocked(readFileSafeSync).mockReturnValue(
      ([
        "# Netscape HTTP Cookie File",
        `.bilibili.com\tTRUE\t/\tFALSE\t${PAST}\tSESSDATA\tstale`,
        `.bilibili.com\tTRUE\t/\tFALSE\t${FUTURE}\tSESSDATA\tlive`,
      ].join("\n") + "\n") as never,
    );

    expect(getCookieHeaderForUrl(VIEW_URL)).toBe("SESSDATA=live");
  });

  it.each([false, true])(
    "sends every matching scope longest-path first (reverse file: %s)",
    (reverse) => {
      const rows = [
        ".bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\troot",
        ".bilibili.com\tTRUE\t/x\tTRUE\t0\tSESSDATA\tsection",
        ".bilibili.com\tTRUE\t/x/web-interface\tTRUE\t0\tSESSDATA\tendpoint",
      ];
      vi.mocked(readFileSafeSync).mockReturnValue(
        (reverse ? [...rows].reverse() : rows).join("\n"),
      );

      expect(getCookieHeaderForUrl(VIEW_URL)).toBe(
        "SESSDATA=endpoint; SESSDATA=section; SESSDATA=root",
      );
    },
  );

  it("preserves same-name cookies on different matching domains in file order for equal paths", () => {
    vi.mocked(readFileSafeSync).mockReturnValue(
      [
        ".bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tparent",
        "api.bilibili.com\tFALSE\t/\tTRUE\t0\tSESSDATA\thost",
        ".api.bilibili.com\tTRUE\t/x\tTRUE\t0\tOTHER\tscoped",
      ].join("\n"),
    );
    expect(getCookieHeaderForUrl(VIEW_URL)).toBe(
      "OTHER=scoped; SESSDATA=parent; SESSDATA=host",
    );
  });

  it.each([
    ["0", "SESSDATA=replacement"],
    [String(PAST), null],
    ["-1", null],
  ])(
    "uses the last row of an identical domain/path/name (expiry %s)",
    (expiry, expected) => {
      vi.mocked(readFileSafeSync).mockReturnValue(
        [
          ".bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\told",
          `.bilibili.com\tTRUE\t/\tTRUE\t${expiry}\tSESSDATA\treplacement`,
        ].join("\n"),
      );
      expect(getCookieHeaderForUrl(VIEW_URL)).toBe(expected);
    },
  );

  it("excludes expired specific scopes without suppressing the root cookie", () => {
    vi.mocked(readFileSafeSync).mockReturnValue(
      [
        `.bilibili.com\tTRUE\t/x/web-interface\tTRUE\t${PAST}\tSESSDATA\tstale`,
        ".bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tlive",
      ].join("\n"),
    );
    expect(getCookieHeaderForUrl(VIEW_URL)).toBe("SESSDATA=live");
  });

  it("only sends secure cookies over HTTPS", () => {
    expect(getCookieHeaderForUrl(VIEW_URL.replace("https:", "http:"))).toBe(
      "buvid3=def",
    );
    expect(getCookieHeaderForUrl(VIEW_URL)).toContain("SESSDATA=abc");
  });

  it.each([
    ["/foo", "/foo", true],
    ["/foo", "/foo/bar?query=yes", true],
    ["/foo/", "/foo/bar", true],
    ["/foo", "/foobar", false],
    ["/foo/", "/foo", false],
    ["/foo", "/Foo", false],
    ["/foo", "/?next=/foo", false],
    ["/foo", "/foo%2Fbar", false],
  ])("matches cookie path %s against request %s", (path, request, matches) => {
    vi.mocked(readFileSafeSync).mockReturnValue(
      `.bilibili.com\tTRUE\t${path}\tTRUE\t0\tSESSDATA\tscoped\n`,
    );
    expect(getCookieHeaderForUrl(`https://api.bilibili.com${request}`)).toBe(
      matches ? "SESSDATA=scoped" : null,
    );
  });

  it.each(["evilbilibili.com", "bilibili.com.evil.test"])(
    "rejects domain lookalike %s",
    (host) => {
      expect(getCookieHeaderForUrl(`https://${host}/`)).toBeNull();
    },
  );

  it("supports include-subdomains without a leading dot and case-insensitive hosts", () => {
    vi.mocked(readFileSafeSync).mockReturnValue(
      "BILIBILI.COM\tTRUE\t/\tTRUE\t0\tSESSDATA\tparent\n",
    );
    expect(getCookieHeaderForUrl(VIEW_URL)).toBe("SESSDATA=parent");
  });

  it("preserves empty values, embedded equals signs, HttpOnly rows, BOM and CRLF", () => {
    vi.mocked(readFileSafeSync).mockReturnValue(
      "\uFEFF# Netscape HTTP Cookie File\r\n#HttpOnly_.bilibili.com\tTRUE\t/\tTRUE\t0\tEMPTY\t\r\n.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tabc==\r\n",
    );
    expect(getCookieHeaderForUrl(VIEW_URL)).toBe("EMPTY=; SESSDATA=abc==");
  });

  it.each(["not a URL", "ftp://api.bilibili.com/", "file:///cookies.txt"])(
    "rejects unsupported URL %s",
    (url) => {
      expect(getCookieHeaderForUrl(url)).toBeNull();
    },
  );

  it("returns null when the cookie file is missing", () => {
    vi.mocked(statSafeSync).mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    expect(getCookieHeaderForUrl(VIEW_URL)).toBeNull();
  });

  it("skips values that would corrupt the Cookie header", () => {
    vi.mocked(readFileSafeSync).mockReturnValue(
      [
        ".bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tvalid",
        ".bilibili.com\tTRUE\t/x\tTRUE\t0\tSESSDATA\tinjected; name=value",
        ".bilibili.com\tTRUE\t/x\tTRUE\t0\tBAD=NAME\tbad",
        ".bilibili.com\tTRUE\t/x\tTRUE\t0\tCONTROL\tbad\u0001value",
      ].join("\n"),
    );
    expect(getCookieHeaderForUrl(VIEW_URL)).toBe("SESSDATA=valid");
  });
});
