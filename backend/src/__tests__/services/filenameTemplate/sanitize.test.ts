import { describe, expect, it } from "vitest";

import {
  enforcePathLengthLimit,
  replaceSegmentSeparators,
  sanitizeRelativePath,
  sanitizeSegment,
} from "../../../services/filenameTemplate/sanitize";

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

describe("replaceSegmentSeparators", () => {
  it("replaces forward and back slashes with spaces", () => {
    expect(replaceSegmentSeparators("a/b\\c")).toBe("a b c");
  });

  it("leaves a normal string unchanged", () => {
    expect(replaceSegmentSeparators("hello world")).toBe("hello world");
  });
});

describe("sanitizeSegment", () => {
  it("removes illegal filesystem characters", () => {
    expect(sanitizeSegment('foo<>:"|?*bar')).toBe("foobar");
  });

  it("strips NUL bytes", () => {
    expect(sanitizeSegment("foo\u0000bar")).toBe("foobar");
  });

  it("collapses repeated whitespace", () => {
    expect(sanitizeSegment("a   b\t\tc")).toBe("a b c");
  });

  it("trims trailing dots and spaces (Windows)", () => {
    expect(sanitizeSegment("filename...   ")).toBe("filename");
  });

  it("truncates ASCII segments to 180 bytes max", () => {
    const long = "a".repeat(300);
    const result = sanitizeSegment(long);
    expect(result.length).toBe(180);
  });

  it("truncates by UTF-8 bytes for multi-byte characters", () => {
    const longCjk = "你".repeat(200); // 600 bytes
    const result = sanitizeSegment(longCjk);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(180);
  });
});

describe("sanitizeRelativePath", () => {
  it("returns null for path containing '..' segment", () => {
    expect(sanitizeRelativePath("foo/../bar.mp4")).toBeNull();
  });

  it("returns null for path containing '.' segment", () => {
    expect(sanitizeRelativePath("./bar.mp4")).toBeNull();
  });

  it("returns null when sanitized path is empty", () => {
    expect(sanitizeRelativePath("")).toBeNull();
  });

  it("drops segments that sanitize to empty string", () => {
    // "<>" sanitizes to empty and is dropped, leaving "dir" as the filename.
    const result = sanitizeRelativePath("dir/<>");
    expect(result?.segments).toEqual(["dir"]);
  });

  it("sanitizes each segment independently", () => {
    const result = sanitizeRelativePath("a<b/c>d.mp4");
    expect(result?.sanitized).toBe("ab/cd.mp4");
    expect(result?.segments).toEqual(["ab", "cd.mp4"]);
  });

  it("preserves valid nested paths", () => {
    const result = sanitizeRelativePath("Channel/Season 1/file.mp4");
    expect(result?.sanitized).toBe("Channel/Season 1/file.mp4");
  });

  it("drops empty segments from repeated slashes", () => {
    const result = sanitizeRelativePath("a//b.mp4");
    expect(result?.segments).toEqual(["a", "b.mp4"]);
  });

  it("preserves the final extension when truncating a long filename segment", () => {
    const result = sanitizeRelativePath(`dir/${"你".repeat(120)}.webm`);
    expect(result).not.toBeNull();
    expect(result?.segments).toHaveLength(2);
    expect(result?.segments[1].endsWith(".webm")).toBe(true);
    expect(utf8ByteLength(result?.segments[1] || "")).toBeLessThanOrEqual(180);
  });
});

describe("enforcePathLengthLimit", () => {
  it("returns the segments unchanged when under the limit", () => {
    const segments = ["short", "file.mp4"];
    expect(enforcePathLengthLimit(segments)).toEqual(segments);
  });

  it("truncates the basename stem when over the limit, preserving extension", () => {
    const longStem = "a".repeat(300);
    const segments = ["dir", `${longStem}.mp4`];
    const result = enforcePathLengthLimit(segments);
    expect(result.length).toBe(2);
    const last = result[result.length - 1];
    expect(last.endsWith(".mp4")).toBe(true);
    expect(utf8ByteLength(result.join("/"))).toBeLessThanOrEqual(240);
  });

  it("truncates whole basename when there is no extension", () => {
    const longSegment = "a".repeat(300);
    const result = enforcePathLengthLimit(["dir", longSegment]);
    expect(result.length).toBe(2);
    expect(utf8ByteLength(result.join("/"))).toBeLessThanOrEqual(240);
  });

  it("keeps CJK-heavy filenames under the full path limit", () => {
    const longCjkStem = "字幕測試".repeat(90);
    const result = enforcePathLengthLimit(["dir", `${longCjkStem}.mp4`]);
    const candidate = result.join("/");
    expect(utf8ByteLength(candidate)).toBeLessThanOrEqual(240);
    expect(
      utf8ByteLength(`${result[result.length - 1]}.en-US.vtt.part`)
    ).toBeLessThan(255);
  });

  it("trims leading directory segments when prefix alone exceeds budget", () => {
    const result = enforcePathLengthLimit([
      "你".repeat(60),
      "你".repeat(60),
      "a.mp4",
    ]);
    expect(utf8ByteLength(result.join("/"))).toBeLessThanOrEqual(240);
    expect(result[result.length - 1]).toBe("a.mp4");
  });

  it("falls back to minimal filename when prefix leaves no stem budget", () => {
    const result = enforcePathLengthLimit([
      "你".repeat(60),
      "你".repeat(60),
      "你".repeat(60),
      "verylongfilename.mp4",
    ]);
    expect(utf8ByteLength(result.join("/"))).toBeLessThanOrEqual(240);
    expect(result[result.length - 1].endsWith(".mp4")).toBe(true);
  });

  it("keeps a non-empty stem when the remaining byte budget cannot fit a multibyte char", () => {
    const result = enforcePathLengthLimit([
      "a".repeat(117),
      "b".repeat(116),
      "你.mp4",
    ]);
    expect(utf8ByteLength(result.join("/"))).toBeLessThanOrEqual(240);
    expect(result[result.length - 1]).toBe("x.mp4");
  });

  it("does not truncate a valid path that exceeds only the old headroom-reduced budget", () => {
    const segments = [
      "A".repeat(50),
      "B".repeat(50),
      `${"C".repeat(90)}.mp4`,
    ];
    expect(utf8ByteLength(segments.join("/"))).toBe(196);
    expect(enforcePathLengthLimit(segments)).toEqual(segments);
  });

  it("keeps a short extensionless path unchanged when already under 240 bytes", () => {
    const result = enforcePathLengthLimit(["a".repeat(191), "z"]);
    expect(utf8ByteLength(result.join("/"))).toBeLessThanOrEqual(240);
    expect(result).toEqual(["a".repeat(191), "z"]);
  });

  it("keeps a longer extensionless path unchanged when already under 240 bytes", () => {
    const result = enforcePathLengthLimit(["a".repeat(191), "longname"]);
    expect(utf8ByteLength(result.join("/"))).toBeLessThanOrEqual(240);
    expect(result).toEqual(["a".repeat(191), "longname"]);
  });

  it("returns empty array for empty input", () => {
    expect(enforcePathLengthLimit([])).toEqual([]);
  });
});
