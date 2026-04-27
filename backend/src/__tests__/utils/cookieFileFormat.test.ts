import { describe, expect, it } from "vitest";
import {
  UnsupportedCookieFormatError,
  isValidNetscapeCookiesFile,
  normalizeCookiesFileContent,
} from "../../utils/cookieFileFormat";

describe("cookieFileFormat", () => {
  it("accepts Netscape-format cookie files", () => {
    const content =
      "# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n.youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tf4=4000000\n";

    expect(isValidNetscapeCookiesFile(content)).toBe(true);
    expect(normalizeCookiesFileContent(content)).toBe(content);
  });

  it("accepts lowercase Netscape boolean fields without converting the file", () => {
    const content =
      "# Netscape HTTP Cookie File\n.youtube.com\ttrue\t/\tfalse\t1893456000\tPREF\tf4=4000000\n";

    expect(isValidNetscapeCookiesFile(content)).toBe(true);
    expect(normalizeCookiesFileContent(content)).toBe(content);
  });

  it("converts YouTube Cookie header content to Netscape format", () => {
    const normalized = normalizeCookiesFileContent(
      "Cookie: VISITOR_INFO1_LIVE=abc; PREF=f4=4000000; __Secure-ROLLOUT_TOKEN=tok"
    );

    expect(normalized).toContain("# Netscape HTTP Cookie File");
    expect(normalized).toContain(
      ".youtube.com\tTRUE\t/\tFALSE\t0\tVISITOR_INFO1_LIVE\tabc"
    );
    expect(normalized).toContain(
      ".youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tf4=4000000"
    );
    expect(normalized).toContain(
      ".youtube.com\tTRUE\t/\tTRUE\t0\t__Secure-ROLLOUT_TOKEN\ttok"
    );
  });

  it("uses Host header when converting request headers", () => {
    const normalized = normalizeCookiesFileContent(
      "Host: www.bilibili.com\nCookie: SESSDATA=secret; bili_jct=csrf"
    );

    expect(normalized).toContain(
      ".bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tsecret"
    );
    expect(normalized).toContain(
      ".bilibili.com\tTRUE\t/\tFALSE\t0\tbili_jct\tcsrf"
    );
  });

  it("uses HTTP/2 :authority header when converting request headers", () => {
    const normalized = normalizeCookiesFileContent(
      ":authority: media.example.com\nCookie: foo=bar; baz=qux"
    );

    expect(normalized).toContain(".media.example.com\tTRUE\t/\tFALSE\t0\tfoo\tbar");
    expect(normalized).toContain(".media.example.com\tTRUE\t/\tFALSE\t0\tbaz\tqux");
  });

  it("rejects unsupported content", () => {
    expect(() => normalizeCookiesFileContent("cookie-data")).toThrow(
      UnsupportedCookieFormatError
    );
  });

  it("rejects generic Cookie header content when the domain cannot be inferred", () => {
    expect(() => normalizeCookiesFileContent("foo=bar; baz=qux")).toThrow(
      UnsupportedCookieFormatError
    );
  });
});
