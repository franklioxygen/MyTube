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
  generateUniqueCollectionName: vi.fn().mockImplementation((name: string) => `${name}-unique`),
  saveCollection: vi.fn(),
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
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      entries: [
        { id: "PL_existing", title: "Existing", url: "https://youtube.com/playlist?list=PL_existing" },
        { id: "PL_new", title: "New Playlist", url: "https://youtube.com/playlist?list=PL_new" },
      ],
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
    // Should be called with the new playlist's details and the channel name.
    expect(deps.subscribePlaylist).toHaveBeenCalledWith(
      "https://youtube.com/playlist?list=PL_new",
      60,
      "New Playlist",
      "PL_new",
      "ChannelName",
      "YouTube",
      expect.any(String),
      null,
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
    vi.mocked(executeYtDlpJson).mockResolvedValueOnce({
      entries: [
        { id: "PL_fail", title: "Fail", url: "https://youtube.com/playlist?list=PL_fail" },
        { id: "PL_ok", title: "Ok", url: "https://youtube.com/playlist?list=PL_ok" },
      ],
    } as any);

    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([]),
      subscribePlaylist: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(undefined),
    };

    const count = await checkChannelPlaylistsForWatcher(makeSub(), deps);

    expect(count).toBe(1);
    expect(deps.subscribePlaylist).toHaveBeenCalledTimes(2);
  });
});
