import { describe, expect, it } from "vitest";
import {
  MAX_DESCRIPTION_LENGTH,
  buildExportStem,
  buildSeasonDirectoryName,
  buildShowDirectoryName,
  extractRawChannelMetadata,
  getIdentityKeyQuality,
  isStrongerIdentity,
  normalizeAuthorIdentity,
  normalizeChannelUrl,
  normalizeDescription,
  normalizePlatform,
  resolveShowIdentity,
  sanitizeMirrorSegment,
} from "../../../services/mediaServerExport/identity";

describe("mediaServerExport/identity", () => {
  it("folds platform aliases onto one token", () => {
    expect(normalizePlatform("YouTube")).toBe("youtube");
    expect(normalizePlatform("yt")).toBe("youtube");
    expect(normalizePlatform("Bilibili")).toBe("bilibili");
    expect(normalizePlatform(undefined)).toBe("unknown");
  });

  it("normalizes equivalent channel URLs onto one value", () => {
    expect(normalizeChannelUrl("https://www.youtube.com/channel/UCabc/")).toBe(
      "youtube.com/channel/UCabc"
    );
    expect(
      normalizeChannelUrl("http://m.youtube.com/channel/UCabc?foo=1#x")
    ).toBe("youtube.com/channel/UCabc");
  });

  it("keeps channel URL path case so distinct channel ids never merge", () => {
    expect(normalizeChannelUrl("https://youtube.com/channel/UCabc")).not.toBe(
      normalizeChannelUrl("https://youtube.com/channel/ucABC")
    );
  });

  it("rejects channel URLs that are not http(s)", () => {
    expect(normalizeChannelUrl("ftp://example.com/x")).toBeUndefined();
    expect(normalizeChannelUrl("not a url")).toBeUndefined();
    expect(normalizeChannelUrl("")).toBeUndefined();
  });

  it("resolves identity in channel-id, channel-url, author order", () => {
    expect(
      resolveShowIdentity({
        platform: "YouTube",
        channelId: "UC123",
        channelUrl: "https://youtube.com/channel/UC123",
        author: "Kurzgesagt",
      })
    ).toMatchObject({
      identityKey: "youtube:channel-id:UC123",
      quality: "channel_id",
    });

    expect(
      resolveShowIdentity({
        platform: "YouTube",
        channelUrl: "https://youtube.com/channel/UC123",
        author: "Kurzgesagt",
      })
    ).toMatchObject({
      identityKey: "youtube:channel-url:youtube.com/channel/UC123",
      quality: "channel_url",
    });

    expect(
      resolveShowIdentity({ platform: "YouTube", author: "Kurzgesagt " })
    ).toMatchObject({
      identityKey: "youtube:author:kurzgesagt",
      quality: "author_fallback",
    });

    expect(resolveShowIdentity({ platform: "YouTube" })).toBeNull();
  });

  it("keeps the same identity when only the display title changes", () => {
    const before = resolveShowIdentity({
      platform: "YouTube",
      channelId: "UC123",
      author: "Old Name",
    });
    const after = resolveShowIdentity({
      platform: "YouTube",
      channelId: "UC123",
      author: "New Name",
    });
    expect(before?.identityKey).toBe(after?.identityKey);
  });

  it("ranks identity strength for later upgrades", () => {
    expect(getIdentityKeyQuality("youtube:channel-id:UC1")).toBe("channel_id");
    expect(getIdentityKeyQuality("youtube:channel-url:x")).toBe("channel_url");
    expect(getIdentityKeyQuality("youtube:author:x")).toBe("author_fallback");
    expect(isStrongerIdentity("channel_id", "author_fallback")).toBe(true);
    expect(isStrongerIdentity("author_fallback", "channel_url")).toBe(false);
    expect(isStrongerIdentity("channel_id", "channel_id")).toBe(false);
  });

  it("sanitizes mirror segments without leaking a directory level", () => {
    expect(sanitizeMirrorSegment("AC/DC: Live?")).toBe("AC DC Live");
    expect(sanitizeMirrorSegment("../etc")).toBe("etc");
    expect(sanitizeMirrorSegment("  ")).toBe("");
    expect(sanitizeMirrorSegment("Ünïcödé 频道")).toBe("Ünïcödé 频道");
  });

  it("builds padded season directories and episode stems", () => {
    expect(buildSeasonDirectoryName(0)).toBe("Season 00");
    expect(buildSeasonDirectoryName(3)).toBe("Season 03");
    expect(buildSeasonDirectoryName(12)).toBe("Season 12");
    expect(buildExportStem(3, 12, "The Egg")).toBe("S03E012 - The Egg");
    expect(buildExportStem(1, 1000, "Big")).toBe("S01E1000 - Big");
    expect(buildExportStem(0, 1, "  ")).toBe("S00E001");
  });

  it("suffixes a colliding show directory with a stable identity hash", () => {
    const taken = new Set(["Kurzgesagt"]);
    const first = buildShowDirectoryName(
      "Kurzgesagt",
      "youtube:channel-id:UC1",
      (candidate) => taken.has(candidate)
    );
    const again = buildShowDirectoryName(
      "Kurzgesagt",
      "youtube:channel-id:UC1",
      (candidate) => taken.has(candidate)
    );
    expect(first).not.toBe("Kurzgesagt");
    expect(first).toMatch(/^Kurzgesagt \([0-9a-f]{8}\)$/);
    expect(again).toBe(first);
  });

  it("falls back to a placeholder directory for an unusable title", () => {
    expect(
      buildShowDirectoryName("///", "youtube:author:x", () => false)
    ).toBe("Unknown Author");
  });

  it("bounds a persisted description on a code point boundary", () => {
    const long = "😀".repeat(MAX_DESCRIPTION_LENGTH + 10);
    const bounded = normalizeDescription(long);
    expect(Array.from(bounded)).toHaveLength(MAX_DESCRIPTION_LENGTH);
    expect(bounded.endsWith("😀")).toBe(true);
    expect(normalizeDescription(undefined)).toBe("");
  });

  it("maps only the documented yt-dlp channel keys", () => {
    expect(
      extractRawChannelMetadata({
        channel_id: "UC1",
        uploader_id: "ignored",
        uploader_url: "https://youtube.com/@x",
        uploader: "Uploader",
        channel_description: "About",
        some_extractor_field: "nope",
      })
    ).toEqual({
      channelId: "UC1",
      channelUrl: "https://youtube.com/@x",
      channelName: "Uploader",
      channelDescription: "About",
    });
    expect(extractRawChannelMetadata(undefined)).toEqual({});
    expect(extractRawChannelMetadata([1, 2])).toEqual({});
  });

  it("normalizes author names for the fallback identity", () => {
    expect(normalizeAuthorIdentity("  Kurz   Gesagt ")).toBe("kurz gesagt");
    expect(normalizeAuthorIdentity("   ")).toBeUndefined();
  });
});
