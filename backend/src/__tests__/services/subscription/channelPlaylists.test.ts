import { describe, expect, it, vi } from "vitest";
import { checkChannelPlaylistsForWatcher } from "../../../services/subscription/channelPlaylists";
import type { Subscription } from "../../../services/subscription/types";

// Mock the dynamic-imported yt-dlp utils + helpers so no network/fs is touched.
vi.mock("../../../utils/ytDlpUtils", () => ({
  executeYtDlpJson: vi.fn(),
  getNetworkConfigFromUserConfig: vi.fn().mockReturnValue({}),
  getUserYtDlpConfig: vi.fn().mockReturnValue({}),
  getEffectiveUserYtDlpConfig: vi.fn().mockReturnValue({}),
}));
vi.mock("../../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderScript: vi.fn().mockReturnValue(null),
}));
vi.mock("../../../db", () => {
  const chain = {
    set: () => chain,
    where: () => chain,
  };
  return { db: { update: () => chain } };
});
vi.mock("../../../db/schema", () => ({ subscriptions: { id: "id" } }));

// storageService is used for collection lookups; mock the relevant surface.
vi.mock("../../../services/storageService", () => ({
  getCollectionByName: vi.fn().mockReturnValue(null),
  getCollectionById: vi.fn(),
  generateUniqueCollectionName: vi.fn().mockImplementation((name: string) => `${name}-unique`),
  saveCollection: vi.fn(),
  deleteCollection: vi.fn(),
}));

const makeSub = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: "sub-1",
  authorUrl: "https://youtube.com/@channel/playlists",
  author: "ChannelName",
  platform: "YouTube",
  interval: 60,
  type: "channel_playlists",
  ...overrides,
} as Subscription);

describe("subscription channelPlaylists", () => {
  it("returns 0 when yt-dlp reports no entries", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({ entries: [] } as any);

    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([]),
      subscribePlaylist: vi.fn(),
    };

    const count = await checkChannelPlaylistsForWatcher(makeSub(), deps);

    expect(count).toBe(0);
    expect(deps.subscribePlaylist).not.toHaveBeenCalled();
  });

  it("skips playlists already subscribed and subscribes to new ones", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    // 1st call: channel listing. 2nd call: head baseline probe for PL_new.
    vi.mocked(executeYtDlpJson)
      .mockResolvedValueOnce({
        entries: [
          { id: "PL_existing", title: "Existing", url: "https://youtube.com/playlist?list=PL_existing" },
          { id: "PL_new", title: "New Playlist", url: "https://youtube.com/playlist?list=PL_new" },
        ],
      } as any)
      .mockResolvedValueOnce({
        _type: "playlist",
        entries: [{ id: "vid-new-head" }],
      } as any);

    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([
        { authorUrl: "https://youtube.com/playlist?list=PL_existing" },
      ]),
      subscribePlaylist: vi.fn().mockResolvedValue(undefined),
    };

    const count = await checkChannelPlaylistsForWatcher(makeSub(), deps);

    expect(count).toBe(1);
    expect(deps.subscribePlaylist).toHaveBeenCalledTimes(1);
    // Watcher now passes an options object including the captured baseline
    // (design §8.2).
    expect(deps.subscribePlaylist).toHaveBeenCalledWith(
      expect.objectContaining({
        playlistUrl: "https://youtube.com/playlist?list=PL_new",
        interval: 60,
        playlistTitle: "New Playlist",
        playlistId: "PL_new",
        author: "ChannelName",
        platform: "YouTube",
        collectionId: expect.any(String),
        initialHeadVideoUrl: "https://www.youtube.com/watch?v=vid-new-head",
        baselineObservedAt: expect.any(Number),
        filenameTemplate: null,
      })
    );
  });

  it("threads the per-subscription yt-dlp override into the playlist listing", async () => {
    const { executeYtDlpJson, getEffectiveUserYtDlpConfig } = await import(
      "../../../utils/ytDlpUtils"
    );
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({ entries: [] } as any);

    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([]),
      subscribePlaylist: vi.fn(),
    };

    await checkChannelPlaylistsForWatcher(
      makeSub({ ytdlpConfig: "--format bestaudio" } as Partial<Subscription>),
      deps
    );

    expect(getEffectiveUserYtDlpConfig).toHaveBeenCalledWith(
      "https://youtube.com/@channel/playlists",
      "--format bestaudio"
    );
  });

  it("continues past a subscribePlaylist failure and still counts successes", async () => {
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    // Channel listing, then a head probe per new playlist (two probes).
    vi.mocked(executeYtDlpJson)
      .mockResolvedValueOnce({
        entries: [
          { id: "PL_fail", title: "Fail", url: "https://youtube.com/playlist?list=PL_fail" },
          { id: "PL_ok", title: "Ok", url: "https://youtube.com/playlist?list=PL_ok" },
        ],
      } as any)
      .mockResolvedValueOnce({ _type: "playlist", entries: [{ id: "vf" }] } as any)
      .mockResolvedValueOnce({ _type: "playlist", entries: [{ id: "vo" }] } as any);

    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([]),
      subscribePlaylist: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(undefined),
    };
    const { getCollectionById, deleteCollection } = await import(
      "../../../services/storageService"
    );
    vi.mocked(getCollectionById).mockImplementation((id: string) => ({
      id,
      name: "Fail - ChannelName-unique",
      videos: [],
    }) as any);
    vi.mocked(deleteCollection).mockReturnValue(true);

    const count = await checkChannelPlaylistsForWatcher(makeSub(), deps);

    expect(count).toBe(1);
    expect(deps.subscribePlaylist).toHaveBeenCalledTimes(2);
    expect(deleteCollection).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe and retries next interval when the baseline probe fails", async () => {
    // Design §8.2: a failed baseline creates no child; the URL is not added to
    // the subscribed set so the next watcher interval retries.
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson)
      .mockResolvedValueOnce({
        entries: [
          { id: "PL_probe_fail", title: "Probe Fail", url: "https://youtube.com/playlist?list=PL_probe_fail" },
        ],
      } as any)
      .mockRejectedValueOnce(new Error("probe failed"));

    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([]),
      subscribePlaylist: vi.fn().mockResolvedValue(undefined),
    };

    const count = await checkChannelPlaylistsForWatcher(makeSub(), deps);

    expect(count).toBe(0);
    expect(deps.subscribePlaylist).not.toHaveBeenCalled();
  });

  it("captures a verified-empty baseline and still creates the child", async () => {
    // Design §4.5 / §8.2: a verified empty playlist is a valid subscription
    // with an empty cursor; its first future item is treated as new.
    const { executeYtDlpJson } = await import("../../../utils/ytDlpUtils");
    vi.mocked(executeYtDlpJson)
      .mockResolvedValueOnce({
        entries: [
          { id: "PL_empty", title: "Empty", url: "https://youtube.com/playlist?list=PL_empty" },
        ],
      } as any)
      .mockResolvedValueOnce({ _type: "playlist", entries: [] } as any);

    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([]),
      subscribePlaylist: vi.fn().mockResolvedValue(undefined),
    };

    const count = await checkChannelPlaylistsForWatcher(makeSub(), deps);

    expect(count).toBe(1);
    expect(deps.subscribePlaylist).toHaveBeenCalledWith(
      expect.objectContaining({
        initialHeadVideoUrl: null,
      })
    );
  });
});
