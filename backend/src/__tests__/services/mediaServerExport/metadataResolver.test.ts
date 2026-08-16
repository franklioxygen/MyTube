import { describe, expect, it } from "vitest";
import {
  buildCollectionMetadataPatch,
  MAX_DESCRIPTION_LENGTH,
  normalizeDescription,
  normalizeRawSourceMetadata,
  resolveSeasonMetadata,
  resolveShowMetadata,
  UNKNOWN_SHOW_TITLE,
} from "../../../services/mediaServerExport/metadataResolver";
import type { Collection, Video } from "../../../services/storageService/types";

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "c1",
    title: "Space Time",
    videos: [],
    ...overrides,
  } as Collection;
}

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "v1",
    title: "Episode",
    sourceUrl: "https://example.com/v",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Video;
}

describe("mediaServerExport metadataResolver", () => {
  describe("normalizeDescription", () => {
    it("trims, drops empty, and preserves Unicode", () => {
      expect(normalizeDescription("  hello  ")).toBe("hello");
      expect(normalizeDescription("   ")).toBeUndefined();
      expect(normalizeDescription(undefined)).toBeUndefined();
      expect(normalizeDescription(123 as never)).toBeUndefined();
      expect(normalizeDescription("宇宙の時間 🌌")).toBe("宇宙の時間 🌌");
    });

    it("bounds the length at a code point boundary", () => {
      const long = "🌌".repeat(MAX_DESCRIPTION_LENGTH + 10);
      const normalized = normalizeDescription(long) as string;

      expect(Array.from(normalized)).toHaveLength(MAX_DESCRIPTION_LENGTH);
      // Truncating by UTF-16 units would split a surrogate pair here.
      expect(normalized.endsWith("🌌")).toBe(true);
    });
  });

  describe("normalizeRawSourceMetadata", () => {
    it("maps only the documented yt-dlp keys", () => {
      expect(
        normalizeRawSourceMetadata({
          extractor: "youtube",
          channel_id: "UC123",
          channel_url: "https://youtube.com/@k",
          channel: "Kurzgesagt",
          channel_description: "Optimistic nihilism.",
          description: "Playlist blurb",
          some_extractor_specific_field: "ignored",
        })
      ).toEqual({
        platform: "youtube",
        channelId: "UC123",
        channelUrl: "https://youtube.com/@k",
        channelName: "Kurzgesagt",
        channelDescription: "Optimistic nihilism.",
        playlistDescription: "Playlist blurb",
      });
    });

    it("falls back to the uploader_* keys", () => {
      expect(
        normalizeRawSourceMetadata({
          uploader_id: "UC456",
          uploader_url: "https://youtube.com/@u",
          uploader: "Uploader",
        })
      ).toMatchObject({
        channelId: "UC456",
        channelUrl: "https://youtube.com/@u",
        channelName: "Uploader",
      });
    });

    it("returns an empty result for non-object input", () => {
      expect(normalizeRawSourceMetadata(undefined)).toEqual({});
      expect(normalizeRawSourceMetadata("string")).toEqual({});
      expect(normalizeRawSourceMetadata([1, 2])).toEqual({});
    });
  });

  describe("resolveShowMetadata", () => {
    it("applies the title precedence order", () => {
      expect(
        resolveShowMetadata({
          persisted: { title: "Persisted" },
          raw: { channelName: "Raw" },
          collection: collection({ sourceChannelName: "Collection" }),
          video: video({ author: "Video" }),
        }).title
      ).toBe("Persisted");

      expect(
        resolveShowMetadata({
          persisted: { title: "Unknown Author" },
          raw: { channelName: "Raw" },
        }).title
      ).toBe("Raw");

      expect(
        resolveShowMetadata({
          collection: collection({ sourceChannelName: "Collection" }),
          video: video({ author: "Video" }),
        }).title
      ).toBe("Collection");

      expect(resolveShowMetadata({ video: video({ author: "Video" }) }).title).toBe(
        "Video"
      );

      expect(resolveShowMetadata({}).title).toBe(UNKNOWN_SHOW_TITLE);
    });

    it("never borrows a video description for the show plot", () => {
      const resolved = resolveShowMetadata({
        video: video({
          author: "Kurzgesagt",
          description: "This particular episode is about ants.",
        }),
      });

      expect(resolved.description).toBe("");
    });

    it("prefers the raw channel description and keeps the persisted one otherwise", () => {
      expect(
        resolveShowMetadata({
          persisted: { description: "Old" },
          raw: { channelDescription: "New" },
        }).description
      ).toBe("New");

      expect(
        resolveShowMetadata({ persisted: { description: "Old" }, raw: {} })
          .description
      ).toBe("Old");
    });

    it("resolves an identity from the strongest available signal", () => {
      expect(
        resolveShowMetadata({ raw: { channelId: "UC1", platform: "youtube" } })
          .identity
      ).toMatchObject({ quality: "channel_id" });

      expect(
        resolveShowMetadata({
          video: video({ channelUrl: "https://youtube.com/@k", source: "youtube" }),
        }).identity
      ).toMatchObject({ quality: "channel_url" });

      expect(
        resolveShowMetadata({ video: video({ author: "Kurzgesagt", source: "youtube" }) })
          .identity
      ).toMatchObject({ quality: "author_fallback" });
    });

    it("does not invent an author identity from the unknown placeholder", () => {
      expect(resolveShowMetadata({}).identity).toBeUndefined();
    });
  });

  describe("resolveSeasonMetadata", () => {
    it("applies the season title precedence order", () => {
      expect(
        resolveSeasonMetadata({
          collection: collection({ title: "Title", name: "Name" }),
          seasonNumber: 3,
        }).title
      ).toBe("Title");

      expect(
        resolveSeasonMetadata({
          collection: collection({ title: undefined, name: "Name" }),
          seasonNumber: 3,
        }).title
      ).toBe("Name");

      expect(
        resolveSeasonMetadata({
          collection: collection({ title: undefined, name: undefined }),
          subscription: { playlistTitle: "Sub Playlist" },
          seasonNumber: 3,
        }).title
      ).toBe("Sub Playlist");

      expect(resolveSeasonMetadata({ seasonNumber: 3 }).title).toBe("Season 03");
      expect(resolveSeasonMetadata({ seasonNumber: 0 }).title).toBe("Season 00");
    });

    it("prefers the collection description over a fresh inspection", () => {
      expect(
        resolveSeasonMetadata({
          collection: collection({ description: "Stored" }),
          inspectedDescription: "Fresh",
          seasonNumber: 1,
        }).plot
      ).toBe("Stored");

      expect(
        resolveSeasonMetadata({
          collection: collection(),
          inspectedDescription: "Fresh",
          seasonNumber: 1,
        }).plot
      ).toBe("Fresh");

      expect(resolveSeasonMetadata({ seasonNumber: 1 }).plot).toBe("");
    });
  });

  describe("buildCollectionMetadataPatch", () => {
    it("fills in missing source metadata on reuse", () => {
      const { patch } = buildCollectionMetadataPatch(collection(), {
        sourceUrl: "https://youtube.com/playlist?list=PL1",
        sourceChannelId: "UC1",
        sourceChannelUrl: "https://youtube.com/@k",
        sourceChannelName: "Kurzgesagt",
        description: "Blurb",
      });

      expect(patch).toEqual({
        sourceUrl: "https://youtube.com/playlist?list=PL1",
        sourceChannelId: "UC1",
        sourceChannelUrl: "https://youtube.com/@k",
        sourceChannelName: "Kurzgesagt",
        description: "Blurb",
      });
    });

    it("refreshes a changed description but never clears one", () => {
      expect(
        buildCollectionMetadataPatch(collection({ description: "Old" }), {
          description: "New",
        }).patch
      ).toEqual({ description: "New" });

      // A head-only poll omits the description entirely.
      expect(
        buildCollectionMetadataPatch(collection({ description: "Old" }), {}).patch
      ).toEqual({});

      expect(
        buildCollectionMetadataPatch(collection({ description: "Old" }), {
          description: "   ",
        }).patch
      ).toEqual({});
    });

    it("reports a conflicting durable channel identity instead of overwriting it", () => {
      const result = buildCollectionMetadataPatch(
        collection({ sourceChannelId: "UC-original" }),
        { sourceChannelId: "UC-other", description: "Blurb" }
      );

      expect(result.conflict).toContain("UC-original");
      expect(result.patch.sourceChannelId).toBeUndefined();
      // Non-conflicting fields in the same candidate are still applied.
      expect(result.patch.description).toBe("Blurb");
    });

    it("is a no-op when the same identity is observed again", () => {
      expect(
        buildCollectionMetadataPatch(collection({ sourceChannelId: "UC1" }), {
          sourceChannelId: "UC1",
        })
      ).toEqual({ patch: {} });
    });
  });
});
