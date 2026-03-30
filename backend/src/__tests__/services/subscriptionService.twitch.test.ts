import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import { downloadYouTubeVideo } from "../../services/downloadService";
import { getTwitchChannelVideos } from "../../services/downloaders/ytdlp/ytdlpTwitch";
import * as storageService from "../../services/storageService";
import { subscriptionService } from "../../services/subscriptionService";
import { twitchApiService } from "../../services/twitchService";

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../db/schema", () => ({
  subscriptions: {
    id: "id",
    authorUrl: "authorUrl",
  },
}));

vi.mock("../../services/downloadService", () => ({
  downloadYouTubeVideo: vi.fn(),
  downloadSingleBilibiliPart: vi.fn(),
}));

vi.mock("../../services/storageService", () => ({
  addDownloadHistoryItem: vi.fn(),
  checkVideoDownloadBySourceId: vi.fn(),
}));

vi.mock("../../services/twitchService", () => ({
  twitchApiService: {
    isConfigured: vi.fn(),
    ensureConfigured: vi.fn(),
    getChannelByLogin: vi.fn(),
    getChannelById: vi.fn(),
    listVideosByBroadcaster: vi.fn(),
  },
}));

vi.mock("../../services/downloaders/ytdlp/ytdlpTwitch", () => ({
  getTwitchChannelVideos: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  },
}));

vi.mock("uuid", () => ({
  v4: () => "test-uuid",
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const createMockBuilder = (result: any) => {
  const builder: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };

  return builder;
};

describe("SubscriptionService Twitch support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(twitchApiService.isConfigured).mockReturnValue(true);
  });

  it("creates a Twitch subscription with a seeded marker and disabled shorts", async () => {
    const selectBuilder = createMockBuilder([]);
    const insertBuilder = createMockBuilder([]);

    (db.select as any).mockReturnValue(selectBuilder);
    (db.insert as any).mockReturnValue(insertBuilder);

    vi.mocked(twitchApiService.getChannelByLogin).mockResolvedValue({
      id: "broadcaster-1",
      login: "somechannel",
      displayName: "Some Channel",
      description: "",
      profileImageUrl: null,
      offlineImageUrl: null,
      url: "https://www.twitch.tv/somechannel",
    });
    vi.mocked(twitchApiService.listVideosByBroadcaster).mockResolvedValue({
      videos: [
        {
          id: "highlight-1",
          userId: "broadcaster-1",
          userLogin: "somechannel",
          userName: "Some Channel",
          title: "Highlight",
          description: "",
          url: "https://www.twitch.tv/videos/999",
          thumbnailUrl: null,
          createdAt: "2026-03-30T10:00:00Z",
          publishedAt: "2026-03-30T10:00:00Z",
          viewCount: 1,
          duration: "1h",
          type: "highlight",
        },
        {
          id: "archive-1",
          userId: "broadcaster-1",
          userLogin: "somechannel",
          userName: "Some Channel",
          title: "Archive",
          description: "",
          url: "https://www.twitch.tv/videos/1000",
          thumbnailUrl: null,
          createdAt: "2026-03-30T09:00:00Z",
          publishedAt: "2026-03-30T09:00:00Z",
          viewCount: 10,
          duration: "2h",
          type: "archive",
        },
      ],
    });

    const result = await subscriptionService.subscribe(
      "https://www.twitch.tv/SomeChannel/videos",
      15,
      undefined,
      true
    );

    expect(result).toMatchObject({
      author: "Some Channel",
      authorUrl: "https://www.twitch.tv/somechannel",
      platform: "Twitch",
      interval: 15,
      downloadShorts: 0,
      twitchBroadcasterId: "broadcaster-1",
      twitchBroadcasterLogin: "somechannel",
      lastTwitchVideoId: "archive-1",
      lastVideoLink: "https://www.twitch.tv/videos/1000",
    });
    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        authorUrl: "https://www.twitch.tv/somechannel",
        platform: "Twitch",
        downloadShorts: 0,
        lastTwitchVideoId: "archive-1",
      })
    );
  });

  it("creates a Twitch subscription without credentials using yt-dlp best-effort mode", async () => {
    const selectBuilder = createMockBuilder([]);
    const insertBuilder = createMockBuilder([]);

    (db.select as any).mockReturnValue(selectBuilder);
    (db.insert as any).mockReturnValue(insertBuilder);

    vi.mocked(twitchApiService.isConfigured).mockReturnValue(false);
    vi.mocked(getTwitchChannelVideos).mockResolvedValue({
      channelName: "Fallback Channel",
      channelLogin: "fallbackchannel",
      videos: [
        {
          id: "3001",
          url: "https://www.twitch.tv/videos/3001",
          title: "Newest fallback video",
          author: "Fallback Channel",
          authorLogin: "fallbackchannel",
          uploadDate: "20260330",
          viewCount: 99,
          sourceIndex: 0,
        },
      ],
    });

    const result = await subscriptionService.subscribe(
      "https://www.twitch.tv/FallbackChannel",
      30
    );

    expect(result).toMatchObject({
      author: "Fallback Channel",
      authorUrl: "https://www.twitch.tv/fallbackchannel",
      platform: "Twitch",
      interval: 30,
      downloadShorts: 0,
      twitchBroadcasterId: undefined,
      twitchBroadcasterLogin: "fallbackchannel",
      lastTwitchVideoId: "3001",
      lastVideoLink: "https://www.twitch.tv/videos/3001",
    });
    expect(getTwitchChannelVideos).toHaveBeenCalledWith(
      "https://www.twitch.tv/fallbackchannel",
      {
        startIndex: 0,
        limit: 20,
      }
    );
  });

  it("polls Twitch subscriptions oldest-to-newest, skips existing downloads, and updates both markers together", async () => {
    const sub = {
      id: "sub-twitch",
      author: "Some Channel",
      authorUrl: "https://www.twitch.tv/somechannel",
      interval: 1,
      lastCheck: 0,
      lastVideoLink: "https://www.twitch.tv/videos/1001",
      downloadCount: 0,
      createdAt: Date.now(),
      platform: "Twitch",
      paused: 0,
      twitchBroadcasterId: "broadcaster-1",
      twitchBroadcasterLogin: "somechannel",
      lastTwitchVideoId: "archive-1",
    };

    const selectBuilder = createMockBuilder([sub]);
    const lockBuilder = createMockBuilder([{ id: sub.id }]);
    const channelRefreshBuilder = createMockBuilder([]);
    const existingMarkerBuilder = createMockBuilder([]);
    const firstDownloadMarkerBuilder = createMockBuilder([]);
    const secondDownloadMarkerBuilder = createMockBuilder([]);
    const updateBuilders = [
      lockBuilder,
      channelRefreshBuilder,
      existingMarkerBuilder,
      firstDownloadMarkerBuilder,
      secondDownloadMarkerBuilder,
    ];

    (db.select as any).mockReturnValue(selectBuilder);
    (db.update as any).mockImplementation(() => updateBuilders.shift());

    vi.mocked(twitchApiService.getChannelById).mockResolvedValue({
      id: "broadcaster-1",
      login: "somechannel",
      displayName: "Some Channel",
      description: "",
      profileImageUrl: null,
      offlineImageUrl: null,
      url: "https://www.twitch.tv/somechannel",
    });
    vi.mocked(twitchApiService.listVideosByBroadcaster).mockResolvedValue({
      videos: [
        {
          id: "archive-4",
          userId: "broadcaster-1",
          userLogin: "somechannel",
          userName: "Some Channel",
          title: "Newest",
          description: "",
          url: "https://www.twitch.tv/videos/1004",
          thumbnailUrl: null,
          createdAt: "2026-03-30T13:00:00Z",
          publishedAt: "2026-03-30T13:00:00Z",
          viewCount: 40,
          duration: "2h",
          type: "archive",
        },
        {
          id: "archive-3",
          userId: "broadcaster-1",
          userLogin: "somechannel",
          userName: "Some Channel",
          title: "Middle",
          description: "",
          url: "https://www.twitch.tv/videos/1003",
          thumbnailUrl: null,
          createdAt: "2026-03-30T12:00:00Z",
          publishedAt: "2026-03-30T12:00:00Z",
          viewCount: 30,
          duration: "2h",
          type: "archive",
        },
        {
          id: "archive-2",
          userId: "broadcaster-1",
          userLogin: "somechannel",
          userName: "Some Channel",
          title: "Oldest unseen",
          description: "",
          url: "https://www.twitch.tv/videos/1002",
          thumbnailUrl: null,
          createdAt: "2026-03-30T11:00:00Z",
          publishedAt: "2026-03-30T11:00:00Z",
          viewCount: 20,
          duration: "2h",
          type: "archive",
        },
        {
          id: "archive-1",
          userId: "broadcaster-1",
          userLogin: "somechannel",
          userName: "Some Channel",
          title: "Seed marker",
          description: "",
          url: "https://www.twitch.tv/videos/1001",
          thumbnailUrl: null,
          createdAt: "2026-03-30T10:00:00Z",
          publishedAt: "2026-03-30T10:00:00Z",
          viewCount: 10,
          duration: "2h",
          type: "archive",
        },
      ],
    });
    vi.mocked(storageService.checkVideoDownloadBySourceId).mockImplementation(
      (sourceId: string) => ({ found: sourceId === "archive-2" } as any)
    );
    vi.mocked(downloadYouTubeVideo)
      .mockResolvedValueOnce({
        videoData: {
          id: "video-1003",
          title: "Middle",
          author: "Some Channel",
        },
      } as any)
      .mockResolvedValueOnce({
        videoData: {
          id: "video-1004",
          title: "Newest",
          author: "Some Channel",
        },
      } as any);

    await subscriptionService.checkSubscriptions();

    expect(downloadYouTubeVideo).toHaveBeenNthCalledWith(
      1,
      "https://www.twitch.tv/videos/1003"
    );
    expect(downloadYouTubeVideo).toHaveBeenNthCalledWith(
      2,
      "https://www.twitch.tv/videos/1004"
    );
    expect(storageService.addDownloadHistoryItem).toHaveBeenCalledTimes(2);
    expect(lockBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastCheck: expect.any(Number),
      })
    );
    expect(channelRefreshBuilder.set).toHaveBeenCalledWith({
      author: "Some Channel",
      authorUrl: "https://www.twitch.tv/somechannel",
      twitchBroadcasterId: "broadcaster-1",
      twitchBroadcasterLogin: "somechannel",
    });
    expect(existingMarkerBuilder.set).toHaveBeenCalledWith({
      lastTwitchVideoId: "archive-2",
      lastVideoLink: "https://www.twitch.tv/videos/1002",
    });
    expect(firstDownloadMarkerBuilder.set).toHaveBeenCalledWith({
      lastTwitchVideoId: "archive-3",
      lastVideoLink: "https://www.twitch.tv/videos/1003",
      downloadCount: 1,
    });
    expect(secondDownloadMarkerBuilder.set).toHaveBeenCalledWith({
      lastTwitchVideoId: "archive-4",
      lastVideoLink: "https://www.twitch.tv/videos/1004",
      downloadCount: 2,
    });
  });

  it("falls back to yt-dlp polling when Helix requests fail for configured Twitch subscriptions", async () => {
    const sub = {
      id: "sub-twitch-api-fallback",
      author: "Some Channel",
      authorUrl: "https://www.twitch.tv/somechannel",
      interval: 1,
      lastCheck: 0,
      lastVideoLink: "https://www.twitch.tv/videos/2001",
      downloadCount: 0,
      createdAt: Date.now(),
      platform: "Twitch",
      paused: 0,
      twitchBroadcasterId: "broadcaster-1",
      twitchBroadcasterLogin: "somechannel",
      lastTwitchVideoId: "2001",
    };

    const selectBuilder = createMockBuilder([sub]);
    const lockBuilder = createMockBuilder([{ id: sub.id }]);
    const channelRefreshBuilder = createMockBuilder([]);
    const existingMarkerBuilder = createMockBuilder([]);
    const downloadMarkerBuilder = createMockBuilder([]);
    const updateBuilders = [
      lockBuilder,
      channelRefreshBuilder,
      existingMarkerBuilder,
      downloadMarkerBuilder,
    ];

    (db.select as any).mockReturnValue(selectBuilder);
    (db.update as any).mockImplementation(() => updateBuilders.shift());

    vi.mocked(twitchApiService.getChannelById).mockRejectedValue({
      response: { status: 429 },
    } as any);
    vi.mocked(getTwitchChannelVideos).mockResolvedValue({
      channelName: "Some Channel",
      channelLogin: "somechannel",
      videos: [
        {
          id: "2003",
          url: "https://www.twitch.tv/videos/2003",
          title: "Newest fallback",
          author: "Some Channel",
          authorLogin: "somechannel",
          uploadDate: "20260330",
          viewCount: 44,
          sourceIndex: 0,
        },
        {
          id: "2002",
          url: "https://www.twitch.tv/videos/2002",
          title: "Existing fallback",
          author: "Some Channel",
          authorLogin: "somechannel",
          uploadDate: "20260329",
          viewCount: 33,
          sourceIndex: 1,
        },
        {
          id: "2001",
          url: "https://www.twitch.tv/videos/2001",
          title: "Seed marker fallback",
          author: "Some Channel",
          authorLogin: "somechannel",
          uploadDate: "20260328",
          viewCount: 22,
          sourceIndex: 2,
        },
      ],
    });
    vi.mocked(storageService.checkVideoDownloadBySourceId).mockImplementation(
      (sourceId: string) => ({ found: sourceId === "2002" } as any)
    );
    vi.mocked(downloadYouTubeVideo).mockResolvedValueOnce({
      videoData: {
        id: "video-2003",
        title: "Newest fallback",
        author: "Some Channel",
      },
    } as any);

    await subscriptionService.checkSubscriptions();

    expect(twitchApiService.getChannelById).toHaveBeenCalledWith(
      "broadcaster-1"
    );
    expect(getTwitchChannelVideos).toHaveBeenCalledWith(
      "https://www.twitch.tv/somechannel",
      {
        startIndex: 0,
        limit: 100,
      }
    );
    expect(twitchApiService.listVideosByBroadcaster).not.toHaveBeenCalled();
    expect(downloadYouTubeVideo).toHaveBeenCalledWith(
      "https://www.twitch.tv/videos/2003"
    );
    expect(channelRefreshBuilder.set).toHaveBeenCalledWith({
      author: "Some Channel",
      authorUrl: "https://www.twitch.tv/somechannel",
      twitchBroadcasterLogin: "somechannel",
    });
    expect(existingMarkerBuilder.set).toHaveBeenCalledWith({
      lastTwitchVideoId: "2002",
      lastVideoLink: "https://www.twitch.tv/videos/2002",
    });
    expect(downloadMarkerBuilder.set).toHaveBeenCalledWith({
      lastTwitchVideoId: "2003",
      lastVideoLink: "https://www.twitch.tv/videos/2003",
      downloadCount: 1,
    });
  });

  it("polls Twitch subscriptions without credentials using yt-dlp best-effort mode", async () => {
    const sub = {
      id: "sub-twitch-fallback",
      author: "Fallback Channel",
      authorUrl: "https://www.twitch.tv/fallbackchannel",
      interval: 1,
      lastCheck: 0,
      lastVideoLink: "https://www.twitch.tv/videos/2001",
      downloadCount: 0,
      createdAt: Date.now(),
      platform: "Twitch",
      paused: 0,
      twitchBroadcasterId: undefined,
      twitchBroadcasterLogin: "fallbackchannel",
      lastTwitchVideoId: "2001",
    };

    const selectBuilder = createMockBuilder([sub]);
    const lockBuilder = createMockBuilder([{ id: sub.id }]);
    const channelRefreshBuilder = createMockBuilder([]);
    const existingMarkerBuilder = createMockBuilder([]);
    const firstDownloadMarkerBuilder = createMockBuilder([]);
    const secondDownloadMarkerBuilder = createMockBuilder([]);
    const updateBuilders = [
      lockBuilder,
      channelRefreshBuilder,
      existingMarkerBuilder,
      firstDownloadMarkerBuilder,
      secondDownloadMarkerBuilder,
    ];

    (db.select as any).mockReturnValue(selectBuilder);
    (db.update as any).mockImplementation(() => updateBuilders.shift());

    vi.mocked(twitchApiService.isConfigured).mockReturnValue(false);
    vi.mocked(getTwitchChannelVideos).mockResolvedValue({
      channelName: "Fallback Channel",
      channelLogin: "fallbackchannel",
      videos: [
        {
          id: "2004",
          url: "https://www.twitch.tv/videos/2004",
          title: "Newest fallback",
          author: "Fallback Channel",
          authorLogin: "fallbackchannel",
          uploadDate: "20260330",
          viewCount: 44,
          sourceIndex: 0,
        },
        {
          id: "2003",
          url: "https://www.twitch.tv/videos/2003",
          title: "Middle fallback",
          author: "Fallback Channel",
          authorLogin: "fallbackchannel",
          uploadDate: "20260329",
          viewCount: 33,
          sourceIndex: 1,
        },
        {
          id: "2002",
          url: "https://www.twitch.tv/videos/2002",
          title: "Oldest unseen fallback",
          author: "Fallback Channel",
          authorLogin: "fallbackchannel",
          uploadDate: "20260328",
          viewCount: 22,
          sourceIndex: 2,
        },
        {
          id: "2001",
          url: "https://www.twitch.tv/videos/2001",
          title: "Seed marker fallback",
          author: "Fallback Channel",
          authorLogin: "fallbackchannel",
          uploadDate: "20260327",
          viewCount: 11,
          sourceIndex: 3,
        },
      ],
    });
    vi.mocked(storageService.checkVideoDownloadBySourceId).mockImplementation(
      (sourceId: string) => ({ found: sourceId === "2002" } as any)
    );
    vi.mocked(downloadYouTubeVideo)
      .mockResolvedValueOnce({
        videoData: {
          id: "video-2003",
          title: "Middle fallback",
          author: "Fallback Channel",
        },
      } as any)
      .mockResolvedValueOnce({
        videoData: {
          id: "video-2004",
          title: "Newest fallback",
          author: "Fallback Channel",
        },
      } as any);

    await subscriptionService.checkSubscriptions();

    expect(getTwitchChannelVideos).toHaveBeenCalledWith(
      "https://www.twitch.tv/fallbackchannel",
      {
        startIndex: 0,
        limit: 100,
      }
    );
    expect(downloadYouTubeVideo).toHaveBeenNthCalledWith(
      1,
      "https://www.twitch.tv/videos/2003"
    );
    expect(downloadYouTubeVideo).toHaveBeenNthCalledWith(
      2,
      "https://www.twitch.tv/videos/2004"
    );
    expect(channelRefreshBuilder.set).toHaveBeenCalledWith({
      author: "Fallback Channel",
      authorUrl: "https://www.twitch.tv/fallbackchannel",
      twitchBroadcasterLogin: "fallbackchannel",
    });
    expect(existingMarkerBuilder.set).toHaveBeenCalledWith({
      lastTwitchVideoId: "2002",
      lastVideoLink: "https://www.twitch.tv/videos/2002",
    });
    expect(firstDownloadMarkerBuilder.set).toHaveBeenCalledWith({
      lastTwitchVideoId: "2003",
      lastVideoLink: "https://www.twitch.tv/videos/2003",
      downloadCount: 1,
    });
    expect(secondDownloadMarkerBuilder.set).toHaveBeenCalledWith({
      lastTwitchVideoId: "2004",
      lastVideoLink: "https://www.twitch.tv/videos/2004",
      downloadCount: 2,
    });
  });
});
