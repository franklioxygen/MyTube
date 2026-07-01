import { describe, expect, it } from "vitest";
import {
    detectPlaylistPlatform,
    deriveChannelName,
    extractYouTubePlaylistId,
    sanitizePlaylistTitle,
    toPlaylistsTabUrl,
} from "../../../services/subscription/playlistResolution";

// These helpers reach into storageService / ytDlpUtils only via the heavier
// functions (resolve*/extract*). The pure helpers tested here don't need mocks.

describe("subscription playlistResolution (pure helpers)", () => {
  describe("extractYouTubePlaylistId", () => {
    it("extracts the list= param when present", () => {
      expect(
        extractYouTubePlaylistId("https://youtube.com/playlist?list=PLabc123")
      ).toBe("PLabc123");
      expect(
        extractYouTubePlaylistId("https://youtu.be/x?v=x&list=PL_def-456")
      ).toBe("PL_def-456");
    });

    it("returns null when no list= param is present", () => {
      expect(extractYouTubePlaylistId("https://youtube.com/watch?v=abc")).toBeNull();
    });
  });

  describe("detectPlaylistPlatform", () => {
    it("detects Bilibili URLs", () => {
      expect(detectPlaylistPlatform("https://www.bilibili.com/video/BV1xx")).toBe("Bilibili");
    });

    it("defaults to YouTube for non-Bilibili URLs", () => {
      expect(detectPlaylistPlatform("https://youtube.com/playlist?list=x")).toBe("YouTube");
    });
  });

  describe("toPlaylistsTabUrl", () => {
    it("appends /playlists when missing", () => {
      expect(toPlaylistsTabUrl("https://youtube.com/@chan")).toBe(
        "https://youtube.com/@chan/playlists"
      );
    });

    it("preserves a trailing slash when appending", () => {
      expect(toPlaylistsTabUrl("https://youtube.com/@chan/")).toBe(
        "https://youtube.com/@chan/playlists"
      );
    });

    it("leaves a URL that already targets playlists unchanged", () => {
      expect(toPlaylistsTabUrl("https://youtube.com/@chan/playlists")).toBe(
        "https://youtube.com/@chan/playlists"
      );
    });
  });

  describe("sanitizePlaylistTitle", () => {
    it("replaces filesystem-unsafe characters with dashes", () => {
      expect(sanitizePlaylistTitle('Bad:Name?')).toBe("Bad-Name-");
      expect(sanitizePlaylistTitle('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    });

    it("falls back to Untitled Playlist for empty input", () => {
      expect(sanitizePlaylistTitle("")).toBe("Untitled Playlist");
      expect(sanitizePlaylistTitle(undefined as unknown as string)).toBe("Untitled Playlist");
    });

    it("trims surrounding whitespace", () => {
      expect(sanitizePlaylistTitle("  Hello  ")).toBe("Hello");
    });
  });

  describe("deriveChannelName", () => {
    it("prefers uploader", () => {
      expect(deriveChannelName({ uploader: "Up", channel: "Ch" }, "u")).toBe("Up");
    });

    it("falls back to channel when uploader is absent", () => {
      expect(deriveChannelName({ channel: "Ch" }, "u")).toBe("Ch");
    });

    it("falls back to the first entry's uploader/channel", () => {
      expect(
        deriveChannelName(
          { channel_id: "x", entries: [{ uploader: "EntryUp" }] },
          "u"
        )
      ).toBe("EntryUp");
    });

    it("falls back to the URL handle when nothing else is present", () => {
      expect(
        deriveChannelName({}, "https://youtube.com/@Handle/videos")
      ).toBe("@Handle");
    });

    it("returns Unknown when nothing can be derived", () => {
      expect(deriveChannelName({}, "https://youtube.com/watch?v=x")).toBe("Unknown");
    });
  });
});
