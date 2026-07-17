import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPlaylistHeadSnapshot,
  inspectPlaylist,
  resolveEntryVideoUrl,
} from "../../../services/subscription/playlistFeed";
import { ValidationError } from "../../../errors/DownloadErrors";

// Mock the yt-dlp utils + helpers so no network/spawn is touched.
vi.mock("../../../utils/ytDlpUtils", () => ({
  executeYtDlpJson: vi.fn(),
  getEffectiveUserYtDlpConfig: vi.fn().mockReturnValue({}),
  getNetworkConfigFromUserConfig: vi.fn().mockReturnValue({}),
}));
vi.mock("../../../utils/helpers", () => ({
  isBilibiliUrl: vi.fn((url: string) => url.includes("bilibili")),
}));
vi.mock("../../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderScript: vi.fn().mockReturnValue(null),
}));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("resolveEntryVideoUrl", () => {
  it("prefers a valid absolute webpage_url", () => {
    expect(
      resolveEntryVideoUrl(
        {
          webpage_url: "https://www.youtube.com/watch?v=abc",
          url: "ignored",
          id: "ignored",
        },
        "YouTube"
      )
    ).toBe("https://www.youtube.com/watch?v=abc");
  });

  it("falls back to a valid absolute url when webpage_url is absent", () => {
    expect(
      resolveEntryVideoUrl(
        { url: "https://www.bilibili.com/video/BV1xx", id: "BV1xx" },
        "Bilibili"
      )
    ).toBe("https://www.bilibili.com/video/BV1xx");
  });

  it("ignores a bare-id-looking webpage_url and falls through to id", () => {
    // A bare id is not a valid absolute URL.
    expect(
      resolveEntryVideoUrl(
        { webpage_url: "dQw4w9WgXcQ", id: "dQw4w9WgXcQ" },
        "YouTube"
      )
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("constructs a YouTube watch URL from a bare id", () => {
    expect(resolveEntryVideoUrl({ id: "abc123" }, "YouTube")).toBe(
      "https://www.youtube.com/watch?v=abc123"
    );
  });

  it("constructs a Bilibili video URL from a bare id", () => {
    expect(resolveEntryVideoUrl({ id: "BV1xx" }, "Bilibili")).toBe(
      "https://www.bilibili.com/video/BV1xx"
    );
  });

  it("returns null when nothing can be derived", () => {
    expect(resolveEntryVideoUrl({}, "YouTube")).toBeNull();
  });
});

describe("getPlaylistHeadSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the canonical head url for a non-empty YouTube playlist", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      _type: "playlist",
      entries: [{ id: "vidA" }],
    } as any);

    const snap = await getPlaylistHeadSnapshot(
      "https://www.youtube.com/playlist?list=PL1",
      "YouTube"
    );

    expect(snap.headVideoUrl).toBe("https://www.youtube.com/watch?v=vidA");
    expect(typeof snap.observedAt).toBe("number");
  });

  it("returns headVideoUrl null for a verified empty playlist", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      _type: "playlist",
      entries: [],
    } as any);

    const snap = await getPlaylistHeadSnapshot(
      "https://www.youtube.com/playlist?list=PL1",
      "YouTube"
    );

    expect(snap.headVideoUrl).toBeNull();
  });

  it("throws ValidationError for a non-playlist result with no entries", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      title: "some video",
    } as any);

    await expect(
      getPlaylistHeadSnapshot(
        "https://www.youtube.com/watch?v=abc",
        "YouTube"
      )
    ).rejects.toThrow(ValidationError);
  });

  it("throws when the leading entry cannot be resolved to a URL", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      _type: "playlist",
      entries: [{}],
    } as any);

    await expect(
      getPlaylistHeadSnapshot(
        "https://www.youtube.com/playlist?list=PL1",
        "YouTube"
      )
    ).rejects.toThrow(ValidationError);
  });

  it("propagates network/extractor errors instead of returning null", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockRejectedValueOnce(new Error("network down"));

    await expect(
      getPlaylistHeadSnapshot(
        "https://www.youtube.com/playlist?list=PL1",
        "YouTube"
      )
    ).rejects.toThrow("network down");
  });

  it("passes the effective subscription yt-dlp config into the probe", async () => {
    const {
      executeYtDlpJson,
      getEffectiveUserYtDlpConfig,
    } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      _type: "playlist",
      entries: [{ id: "vidA" }],
    } as any);

    await getPlaylistHeadSnapshot(
      "https://www.youtube.com/playlist?list=PL1",
      "YouTube",
      { subscriptionYtdlpConfig: "--proxy socks5://127.0.0.1:1080" }
    );

    expect(getEffectiveUserYtDlpConfig).toHaveBeenCalledWith(
      "https://www.youtube.com/playlist?list=PL1",
      "--proxy socks5://127.0.0.1:1080"
    );
    // playlistEnd:1 limits the probe to the leading entry.
    expect(executeYtDlpJson).toHaveBeenCalledWith(
      "https://www.youtube.com/playlist?list=PL1",
      expect.objectContaining({ flatPlaylist: true, playlistEnd: 1 })
    );
  });

  it("retains the provider script option when present", async () => {
    const { getProviderScript } = await import(
      "../../../services/downloaders/ytdlp/ytdlpHelpers"
    );
    vi.mocked(getProviderScript).mockReturnValueOnce("/path/to/script.js");
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      _type: "playlist",
      entries: [{ id: "vidA" }],
    } as any);

    await getPlaylistHeadSnapshot(
      "https://www.youtube.com/playlist?list=PL1",
      "YouTube"
    );

    expect(executeYtDlpJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        extractorArgs:
          "youtubepot-bgutilscript:script_path=/path/to/script.js",
      })
    );
  });
});

describe("inspectPlaylist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns metadata plus the canonical head for a non-empty playlist", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      _type: "playlist",
      title: "My Playlist",
      id: "PL1",
      playlist_count: 5,
      entries: [{ id: "vidA", uploader: "Uploader" }],
    } as any);

    const inspection = await inspectPlaylist(
      "https://www.youtube.com/playlist?list=PL1"
    );

    expect(inspection.headVideoUrl).toBe(
      "https://www.youtube.com/watch?v=vidA"
    );
    expect(inspection.title).toBe("My Playlist");
    expect(inspection.videoCount).toBe(5);
    expect(inspection.playlistId).toBe("PL1");
    expect(inspection.author).toBe("Uploader");
    expect(inspection.platform).toBe("YouTube");
  });

  it("returns headVideoUrl null and count 0 for a verified empty playlist", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      _type: "playlist",
      title: "Empty",
      entries: [],
      uploader: "Some Channel",
    } as any);

    const inspection = await inspectPlaylist(
      "https://www.youtube.com/playlist?list=PL1"
    );

    expect(inspection.headVideoUrl).toBeNull();
    expect(inspection.videoCount).toBe(0);
    expect(inspection.author).toBe("Some Channel");
  });

  it("detects Bilibili platform", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      _type: "playlist",
      title: "Bili List",
      entries: [{ id: "BV1xx", webpage_url: "https://www.bilibili.com/video/BV1xx" }],
    } as any);

    const inspection = await inspectPlaylist(
      "https://www.bilibili.com/list/ml123"
    );

    expect(inspection.platform).toBe("Bilibili");
    expect(inspection.headVideoUrl).toBe("https://www.bilibili.com/video/BV1xx");
  });

  it("throws ValidationError for a non-playlist result", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({ title: "a video" } as any);

    await expect(
      inspectPlaylist("https://www.youtube.com/watch?v=abc")
    ).rejects.toThrow(ValidationError);
  });

  it("propagates extractor errors", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockRejectedValueOnce(new Error("boom"));

    await expect(
      inspectPlaylist("https://www.youtube.com/playlist?list=PL1")
    ).rejects.toThrow("boom");
  });
});
