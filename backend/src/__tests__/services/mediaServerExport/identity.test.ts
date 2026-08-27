import { describe, expect, it } from "vitest";
import {
  canUpgradeShowIdentity,
  normalizeAuthorIdentity,
  normalizeChannelUrl,
  normalizePlatform,
  resolveShowIdentity,
  buildCollectionShowIdentityKey,
  isCollectionShowIdentityKey,
} from "../../../services/mediaServerExport/identity";

describe("mediaServerExport identity", () => {
  describe("normalizePlatform", () => {
    it("folds MyTube's inconsistent platform casing onto one token", () => {
      for (const value of ["YouTube", "youtube", " YOUTUBE ", "yt"]) {
        expect(normalizePlatform(value)).toBe("youtube");
      }
      for (const value of ["Bilibili", "bilibili", "bili", "b23"]) {
        expect(normalizePlatform(value)).toBe("bilibili");
      }
    });

    it("returns a stable unknown token for unusable input", () => {
      expect(normalizePlatform(undefined)).toBe("unknown");
      expect(normalizePlatform("")).toBe("unknown");
      expect(normalizePlatform("   ")).toBe("unknown");
      expect(normalizePlatform("!!!")).toBe("unknown");
      expect(normalizePlatform("Some Site")).toBe("some_site");
    });
  });

  describe("normalizeChannelUrl", () => {
    it("treats scheme, www/m host, trailing slash, and query as noise", () => {
      const expected = "youtube.com/@kurzgesagt";
      for (const value of [
        "https://www.youtube.com/@kurzgesagt",
        "http://youtube.com/@kurzgesagt",
        "https://m.youtube.com/@kurzgesagt/",
        "https://www.youtube.com/@kurzgesagt?si=abc123",
        "  https://WWW.YouTube.com/@kurzgesagt  ",
      ]) {
        expect(normalizeChannelUrl(value)).toBe(expected);
      }
    });

    it("keeps path case so distinct channels never merge", () => {
      expect(normalizeChannelUrl("https://youtube.com/channel/UCabc")).not.toBe(
        normalizeChannelUrl("https://youtube.com/channel/ucABC")
      );
    });

    it("rejects non-http input", () => {
      expect(normalizeChannelUrl("not a url")).toBeUndefined();
      expect(normalizeChannelUrl("ftp://example.com/x")).toBeUndefined();
      expect(normalizeChannelUrl(undefined)).toBeUndefined();
      expect(normalizeChannelUrl("")).toBeUndefined();
    });
  });

  describe("normalizeAuthorIdentity", () => {
    it("is case- and whitespace-insensitive and Unicode-normalized", () => {
      expect(normalizeAuthorIdentity("  Kurzgesagt   In a  Nutshell ")).toBe(
        "kurzgesagt in a nutshell"
      );
      expect(normalizeAuthorIdentity("ＭyTube")).toBe("mytube");
      expect(normalizeAuthorIdentity("   ")).toBeUndefined();
      expect(normalizeAuthorIdentity(undefined)).toBeUndefined();
    });
  });

  describe("resolveShowIdentity", () => {
    it("prefers channel id over URL over author name", () => {
      expect(
        resolveShowIdentity({
          platform: "YouTube",
          sourceChannelId: "UC123",
          sourceChannelUrl: "https://youtube.com/@x",
          authorName: "X",
        })
      ).toMatchObject({
        identityKey: "youtube:channel-id:UC123",
        quality: "channel_id",
      });

      expect(
        resolveShowIdentity({
          platform: "YouTube",
          sourceChannelUrl: "https://www.youtube.com/@x/",
          authorName: "X",
        })
      ).toMatchObject({
        identityKey: "youtube:channel-url:youtube.com/@x",
        quality: "channel_url",
      });

      expect(
        resolveShowIdentity({ platform: "YouTube", authorName: "Kurzgesagt" })
      ).toMatchObject({
        identityKey: "youtube:author:kurzgesagt",
        quality: "author_fallback",
      });
    });

    it("resolves the same show when only the display title changed", () => {
      const before = resolveShowIdentity({
        platform: "youtube",
        sourceChannelId: "UC123",
        authorName: "Old Name",
      });
      const after = resolveShowIdentity({
        platform: "YouTube",
        sourceChannelId: "UC123",
        authorName: "Brand New Name",
      });

      expect(after?.identityKey).toBe(before?.identityKey);
    });

    it("keeps different channel ids apart even with identical titles", () => {
      const a = resolveShowIdentity({
        platform: "youtube",
        sourceChannelId: "UC1",
        authorName: "Science",
      });
      const b = resolveShowIdentity({
        platform: "youtube",
        sourceChannelId: "UC2",
        authorName: "Science",
      });

      expect(a?.identityKey).not.toBe(b?.identityKey);
    });

    it("keeps the same author apart across platforms", () => {
      expect(
        resolveShowIdentity({ platform: "youtube", authorName: "Same" })
          ?.identityKey
      ).not.toBe(
        resolveShowIdentity({ platform: "bilibili", authorName: "Same" })
          ?.identityKey
      );
    });

    it("returns undefined when nothing usable is available", () => {
      expect(resolveShowIdentity({ platform: "youtube" })).toBeUndefined();
      expect(
        resolveShowIdentity({ platform: "youtube", authorName: "  " })
      ).toBeUndefined();
    });
  });

  describe("canUpgradeShowIdentity", () => {
    const channelIdCandidate = resolveShowIdentity({
      platform: "youtube",
      sourceChannelId: "UC999",
    })!;

    it("upgrades one unambiguous author-fallback show", () => {
      expect(
        canUpgradeShowIdentity(
          { identityKey: "youtube:author:kurzgesagt" },
          channelIdCandidate
        )
      ).toBe(true);
    });

    it("never overwrites an existing channel id", () => {
      expect(
        canUpgradeShowIdentity(
          { identityKey: "youtube:author:kurzgesagt", sourceChannelId: "UC111" },
          channelIdCandidate
        )
      ).toBe(false);
    });

    it("upgrades a URL-backed show when a stable channel id arrives", () => {
      expect(
        canUpgradeShowIdentity(
          { identityKey: "youtube:channel-url:youtube.com/@x" },
          channelIdCandidate
        )
      ).toBe(true);
    });

    it("does not rewrite a channel-id identity", () => {
      expect(
        canUpgradeShowIdentity(
          { identityKey: "youtube:channel-id:UC-old" },
          channelIdCandidate
        )
      ).toBe(false);
    });

    it("is not an upgrade path for weaker candidates", () => {
      const urlCandidate = resolveShowIdentity({
        platform: "youtube",
        sourceChannelUrl: "https://youtube.com/@x",
      })!;
      expect(
        canUpgradeShowIdentity(
          { identityKey: "youtube:author:x" },
          urlCandidate
        )
      ).toBe(false);
    });
  });
});

/**
 * A collection show lives in its own identity namespace so it can never be
 * matched against - or merged with - a real channel.
 */
describe("isCollectionShowIdentityKey", () => {
  it("recognizes only the collection namespace", () => {
    expect(isCollectionShowIdentityKey(buildCollectionShowIdentityKey("c1"))).toBe(
      true
    );
    expect(isCollectionShowIdentityKey("collection:anything")).toBe(true);
    expect(isCollectionShowIdentityKey("youtube:channel-id:UC1")).toBe(false);
    expect(isCollectionShowIdentityKey("youtube:author:someone")).toBe(false);
    expect(isCollectionShowIdentityKey("")).toBe(false);
  });
});
