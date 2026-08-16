import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBilibiliCollectionHeadSnapshot,
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
  extractBilibiliVideoId: vi.fn((url: string) => {
    const match = /\/video\/(BV[\w]+|av\d+)/i.exec(url);
    return match ? match[1] : null;
  }),
}));
vi.mock("../../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderScript: vi.fn().mockReturnValue(null),
}));
vi.mock("../../../services/downloadService", () => ({
  getBilibiliCollectionVideos: vi.fn(),
  getBilibiliSeriesVideos: vi.fn(),
  checkBilibiliCollectionOrSeries: vi.fn(),
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

  // Issue #411: the rich inspection also carries media-server export metadata.
  describe("media server export metadata", () => {
    it("captures playlist and channel metadata from the envelope", async () => {
      const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
      vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
        _type: "playlist",
        id: "PL1",
        title: "Space Time",
        description: "Everything about spacetime.",
        channel_id: "UC123",
        channel_url: "https://www.youtube.com/@kurzgesagt",
        channel: "Kurzgesagt",
        channel_description: "Optimistic nihilism.",
        entries: [{ id: "vidA", uploader: "Kurzgesagt" }],
      } as any);

      const inspection = await inspectPlaylist(
        "https://www.youtube.com/playlist?list=PL1"
      );

      expect(inspection).toMatchObject({
        description: "Everything about spacetime.",
        sourceChannelId: "UC123",
        sourceChannelUrl: "https://www.youtube.com/@kurzgesagt",
        sourceChannelName: "Kurzgesagt",
        sourceChannelDescription: "Optimistic nihilism.",
      });
    });

    it("falls back to uploader keys and the first entry for channel identity", async () => {
      const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
      vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
        _type: "playlist",
        id: "PL1",
        title: "Playlist",
        uploader_id: "UC456",
        uploader_url: "https://www.youtube.com/@u",
        entries: [{ id: "vidA", channel: "From Entry" }],
      } as any);

      const inspection = await inspectPlaylist(
        "https://www.youtube.com/playlist?list=PL1"
      );

      expect(inspection).toMatchObject({
        sourceChannelId: "UC456",
        sourceChannelUrl: "https://www.youtube.com/@u",
        sourceChannelName: "From Entry",
      });
    });

    it("leaves the metadata fields undefined when the extractor omits them", async () => {
      const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
      vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
        _type: "playlist",
        id: "PL1",
        title: "Playlist",
        entries: [{ id: "vidA" }],
      } as any);

      const inspection = await inspectPlaylist(
        "https://www.youtube.com/playlist?list=PL1"
      );

      expect(inspection.description).toBeUndefined();
      expect(inspection.sourceChannelId).toBeUndefined();
      expect(inspection.sourceChannelUrl).toBeUndefined();
      expect(inspection.sourceChannelDescription).toBeUndefined();
    });

    it("bounds an unbounded upstream description", async () => {
      const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
      vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
        _type: "playlist",
        id: "PL1",
        title: "Playlist",
        description: "x".repeat(200_000),
        entries: [{ id: "vidA" }],
      } as any);

      const inspection = await inspectPlaylist(
        "https://www.youtube.com/playlist?list=PL1"
      );

      expect(inspection.description).toHaveLength(100_000);
    });
  });

  it("preserves subscription extractor args in playlist probes", async () => {
    const {
      executeYtDlpJson,
      getEffectiveUserYtDlpConfig,
      getNetworkConfigFromUserConfig,
    } = await import("../../../utils/ytDlpUtils");
    const userConfig = {
      extractorArgs: "youtube:player_client=web",
      proxy: "socks5://127.0.0.1:1080",
    };
    vi.mocked(getEffectiveUserYtDlpConfig).mockReturnValueOnce(userConfig);
    vi.mocked(getNetworkConfigFromUserConfig).mockReturnValueOnce({
      proxy: userConfig.proxy,
    });
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      _type: "playlist",
      entries: [{ id: "vidA" }],
    } as any);

    await getPlaylistHeadSnapshot(
      "https://www.youtube.com/playlist?list=PL1",
      "YouTube",
      {
        subscriptionYtdlpConfig:
          "--extractor-args youtube:player_client=web",
      }
    );

    expect(getNetworkConfigFromUserConfig).toHaveBeenCalledWith(userConfig);
    expect(executeYtDlpJson).toHaveBeenCalledWith(
      "https://www.youtube.com/playlist?list=PL1",
      expect.objectContaining({
        extractorArgs: "youtube:player_client=web",
        proxy: "socks5://127.0.0.1:1080",
      })
    );
  });

  it("merges subscription extractor args with the provider script option", async () => {
    const { getProviderScript } = await import(
      "../../../services/downloaders/ytdlp/ytdlpHelpers"
    );
    vi.mocked(getProviderScript).mockReturnValueOnce("/path/to/script.js");
    const {
      executeYtDlpJson,
      getEffectiveUserYtDlpConfig,
    } = await import("../../../utils/ytDlpUtils");
    vi.mocked(getEffectiveUserYtDlpConfig).mockReturnValueOnce({
      extractorArgs: "youtube:max_comments=20",
    });
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      _type: "playlist",
      entries: [{ id: "vidA" }],
    } as any);

    await inspectPlaylist("https://www.youtube.com/playlist?list=PL1", {
      subscriptionYtdlpConfig: "--extractor-args youtube:max_comments=20",
    });

    expect(executeYtDlpJson).toHaveBeenCalledWith(
      "https://www.youtube.com/playlist?list=PL1",
      expect.objectContaining({
        extractorArgs:
          "youtube:max_comments=20;youtubepot-bgutilscript:script_path=/path/to/script.js",
      })
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

describe("getBilibiliCollectionHeadSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches only one Bilibili collection entry for head-only probes", async () => {
    const { getBilibiliCollectionVideos } = await import(
      "../../../services/downloadService"
    );
    vi.mocked(getBilibiliCollectionVideos).mockResolvedValueOnce({
      success: true,
      videos: [{ bvid: "BVhead", title: "Head", aid: 1 }],
    });

    const snap = await getBilibiliCollectionHeadSnapshot(
      "https://www.bilibili.com/video/BVseed",
      {
        type: "collection",
        mid: 12345,
        id: 9988,
      },
      { headOnly: true }
    );

    expect(getBilibiliCollectionVideos).toHaveBeenCalledWith(
      12345,
      9988,
      { pageSize: 1, maxPages: 1 },
      undefined
    );
    expect(snap.headVideoUrl).toBe("https://www.bilibili.com/video/BVhead");
  });

  it("forwards an inspection override down to the archive fetch", async () => {
    // The backfill path (downloadAll on an existing subscription) reaches
    // Bilibili through inspectBilibiliCollectionPlaylist rather than the
    // snapshot directly, so its options have to survive the whole way down.
    const { inspectBilibiliCollectionPlaylist } = await import(
      "../../../services/subscription/playlistFeed"
    );
    const { getBilibiliCollectionVideos } = await import(
      "../../../services/downloadService"
    );
    vi.mocked(getBilibiliCollectionVideos).mockResolvedValue({
      success: true,
      videos: [{ bvid: "BVhead", title: "Head", aid: 1 }],
    });

    await inspectBilibiliCollectionPlaylist(
      "https://www.bilibili.com/video/BVseed",
      { type: "collection", mid: 12345, id: 9988 },
      { subscriptionYtdlpConfig: "--proxy socks5://sub:1080" }
    );

    expect(getBilibiliCollectionVideos).toHaveBeenCalledWith(
      12345,
      9988,
      undefined,
      "--proxy socks5://sub:1080"
    );
  });

  it("detects the collection source through the subscription's proxy override", async () => {
    // Detection runs before the archive fetch, so leaving it unproxied means a
    // proxy-only subscription never gets as far as the archive call at all.
    const { checkBilibiliCollectionOrSeries, getBilibiliCollectionVideos } =
      await import("../../../services/downloadService");
    vi.mocked(checkBilibiliCollectionOrSeries).mockResolvedValueOnce({
      success: true,
      type: "collection",
      mid: 12345,
      id: 9988,
    } as any);
    vi.mocked(getBilibiliCollectionVideos).mockResolvedValueOnce({
      success: true,
      videos: [{ bvid: "BVhead", title: "Head", aid: 1 }],
    });

    // No stored mid/id, so the source has to be resolved from the seed video.
    await getBilibiliCollectionHeadSnapshot(
      "https://www.bilibili.com/video/BVseed",
      { type: "collection" },
      { headOnly: true, subscriptionYtdlpConfig: "--proxy socks5://sub:1080" }
    );

    expect(checkBilibiliCollectionOrSeries).toHaveBeenCalledWith(
      "BVseed",
      "--proxy socks5://sub:1080"
    );
  });

  it("polls a collection through the subscription's own proxy override", async () => {
    // A collection subscription can supply its own --proxy; without this the
    // scheduled poll goes out over the global config and can never see new
    // videos in a proxy-only environment.
    const { getBilibiliCollectionVideos } = await import(
      "../../../services/downloadService"
    );
    vi.mocked(getBilibiliCollectionVideos).mockResolvedValueOnce({
      success: true,
      videos: [{ bvid: "BVhead", title: "Head", aid: 1 }],
    });

    await getBilibiliCollectionHeadSnapshot(
      "https://www.bilibili.com/video/BVseed",
      { type: "collection", mid: 12345, id: 9988 },
      { headOnly: true, subscriptionYtdlpConfig: "--proxy socks5://sub:1080" }
    );

    expect(getBilibiliCollectionVideos).toHaveBeenCalledWith(
      12345,
      9988,
      { pageSize: 1, maxPages: 1 },
      "--proxy socks5://sub:1080"
    );
  });

  it("keeps full Bilibili collection fetches for baseline inspection", async () => {
    const { getBilibiliSeriesVideos } = await import(
      "../../../services/downloadService"
    );
    vi.mocked(getBilibiliSeriesVideos).mockResolvedValueOnce({
      success: true,
      videos: [{ bvid: "BVhead", title: "Head", aid: 1 }],
    });

    await getBilibiliCollectionHeadSnapshot(
      "https://www.bilibili.com/video/BVseed",
      {
        type: "series",
        mid: 12345,
        id: 9988,
      }
    );

    expect(getBilibiliSeriesVideos).toHaveBeenCalledWith(
      12345,
      9988,
      undefined,
      undefined
    );
  });

  it("rejects failed Bilibili collection fetches before seeding a cursor", async () => {
    const { getBilibiliCollectionVideos } = await import(
      "../../../services/downloadService"
    );
    vi.mocked(getBilibiliCollectionVideos).mockResolvedValueOnce({
      success: false,
      videos: [],
    });

    await expect(
      getBilibiliCollectionHeadSnapshot(
        "https://www.bilibili.com/video/BVseed",
        {
          type: "collection",
          mid: 12345,
          id: 9988,
        }
      )
    ).rejects.toMatchObject({
      name: "ValidationError",
      message: "Failed to get videos from Bilibili collection",
      field: "collectionInfo",
    });
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
