import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
    cancelContinuousDownloadTask,
    clearFinishedTasks,
    createPlaylistSubscription,
    createPlaylistTask,
    createSubscription,
    deleteContinuousDownloadTask,
    deleteSubscription,
    getContinuousDownloadTasks,
    getSubscriptions,
    pauseContinuousDownloadTask,
    pauseSubscription,
    resumeContinuousDownloadTask,
    resumeSubscription,
    subscribeChannelPlaylists,
    updateSubscription,
} from "../../controllers/subscriptionController";
import { NotFoundError, ValidationError } from "../../errors/DownloadErrors";
import { continuousDownloadService } from "../../services/continuousDownloadService";
import {
  checkPlaylist,
  getBilibiliCollectionVideos,
  getBilibiliSeriesVideos,
} from "../../services/downloadService";
import * as storageService from "../../services/storageService";
import { subscriptionService } from "../../services/subscriptionService";
import { logger } from "../../utils/logger";
import {
    executeYtDlpJson,
    getEffectiveUserYtDlpConfig,
    getNetworkConfigFromUserConfig,
    getUserYtDlpConfig,
} from "../../utils/ytDlpUtils";

vi.mock("../../services/subscriptionService", () => ({
  subscriptionService: {
    subscribe: vi.fn(),
    listSubscriptions: vi.fn(),
    unsubscribe: vi.fn(),
    pauseSubscription: vi.fn(),
    resumeSubscription: vi.fn(),
    updateSubscriptionSettings: vi.fn(),
    getSubscriptionById: vi.fn(),
    subscribePlaylist: vi.fn(),
    updatePlaylistSubscriptionCollection: vi.fn(),
    updatePlaylistSubscriptionCursor: vi.fn(),
    subscribeChannelPlaylistsWatcher: vi.fn(),
  },
}));

vi.mock("../../services/continuousDownloadService", () => ({
  continuousDownloadService: {
    createTask: vi.fn(),
    getAllTasks: vi.fn(),
    cancelTask: vi.fn(),
    deleteTask: vi.fn(),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    clearFinishedTasks: vi.fn(),
    createPlaylistTask: vi.fn(),
    getTaskByAuthorUrl: vi.fn(),
    getBlockingPlaylistTaskByDestination: vi.fn(),
  },
}));

vi.mock("../../services/downloadService", () => ({
  checkPlaylist: vi.fn(),
  checkBilibiliCollectionOrSeries: vi.fn(),
  getBilibiliCollectionVideos: vi.fn(),
  getBilibiliSeriesVideos: vi.fn(),
}));

vi.mock("../../services/storageService", () => ({
  getCollectionByName: vi.fn(),
  getCollectionById: vi.fn(),
  getCollectionBySourceKey: vi.fn(),
  generateUniqueCollectionName: vi.fn((name: string) => `${name}-unique`),
  saveCollection: vi.fn(),
  deleteCollection: vi.fn(),
  getSettings: vi.fn(() => ({})),
}));

vi.mock("../../utils/helpers", () => ({
  isBilibiliUrl: vi.fn((url: string) => url.includes("bilibili")),
  isTwitchChannelUrl: vi.fn((url: string) => url.includes("twitch.tv")),
  isYouTubeUrl: vi.fn((url: string) => url.includes("youtube")),
  extractBilibiliVideoId: vi.fn((url: string) => {
    const match = url.match(/\/video\/([^/?#]+)/);
    return match?.[1] ?? null;
  }),
  normalizeTwitchChannelUrl: vi.fn((url: string) => url.replace(/\/+$/, "").toLowerCase()),
  normalizeYouTubeAuthorUrl: vi.fn((url: string) => url.replace(/\/+$/, "")),
}));

vi.mock("../../utils/ytDlpUtils", () => ({
  executeYtDlpJson: vi.fn(),
  getNetworkConfigFromUserConfig: vi.fn(() => ({})),
  getUserYtDlpConfig: vi.fn(() => ({})),
  getEffectiveUserYtDlpConfig: vi.fn(() => ({})),
}));

vi.mock("../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderScript: vi.fn(() => "/tmp/provider.js"),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SubscriptionController", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: Mock<(body?: any) => Response>;
  let status: Mock<(code: number) => Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn<(body?: any) => Response>();
    status = vi
      .fn<(code: number) => Response>()
      .mockReturnValue({ json } as unknown as Response);
    req = { body: {}, params: {} };
    res = { json, status };
    (subscriptionService.listSubscriptions as any).mockResolvedValue([]);
  });

  describe("createSubscription", () => {
    it("should create a subscription", async () => {
      req.body = {
        url: "https://www.youtube.com/@testuser/",
        interval: 60,
        downloadShorts: true,
      };
      const mockSubscription = {
        id: "sub-123",
        author: "@testuser",
        platform: "YouTube",
      };
      (subscriptionService.subscribe as any).mockResolvedValue(mockSubscription);

      await createSubscription(req as Request, res as Response);

      expect(subscriptionService.subscribe).toHaveBeenCalledWith(
        "https://www.youtube.com/@testuser",
        60,
        undefined,
        true,
        null,
        null
      );
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(mockSubscription);
    });

    it("should create backfill tasks when downloadAllPrevious and downloadShorts are true", async () => {
      req.body = {
        url: "https://www.youtube.com/@testuser",
        interval: 60,
        downloadAllPrevious: true,
        downloadShorts: true,
      };
      (subscriptionService.subscribe as any).mockResolvedValue({
        id: "sub-123",
        author: "@testuser",
        platform: "YouTube",
      });

      await createSubscription(req as Request, res as Response);

      expect(continuousDownloadService.createTask).toHaveBeenCalledTimes(2);
      expect(continuousDownloadService.createTask).toHaveBeenNthCalledWith(
        1,
        "https://www.youtube.com/@testuser",
        "@testuser",
        "YouTube",
        "sub-123",
        "dateDesc"
      );
      expect(continuousDownloadService.createTask).toHaveBeenNthCalledWith(
        2,
        "https://www.youtube.com/@testuser/shorts",
        "@testuser (Shorts)",
        "YouTube",
        "sub-123",
        "dateDesc"
      );
    });

    it("should only create one backfill task for non-youtube platforms", async () => {
      req.body = {
        url: "https://space.bilibili.com/12345",
        interval: 30,
        downloadAllPrevious: true,
        downloadShorts: true,
      };
      (subscriptionService.subscribe as any).mockResolvedValue({
        id: "sub-bili-1",
        author: "UP 主",
        platform: "Bilibili",
      });

      await createSubscription(req as Request, res as Response);

      expect(continuousDownloadService.createTask).toHaveBeenCalledTimes(1);
      expect(continuousDownloadService.createTask).toHaveBeenCalledWith(
        "https://space.bilibili.com/12345",
        "UP 主",
        "Bilibili",
        "sub-bili-1",
        "dateDesc"
      );
    });

    it("should pass explicit valid downloadOrder to both main and shorts tasks", async () => {
      req.body = {
        url: "https://www.youtube.com/@ordered",
        interval: 15,
        downloadAllPrevious: true,
        downloadShorts: true,
        downloadOrder: "viewsAsc",
      };
      (subscriptionService.subscribe as any).mockResolvedValue({
        id: "sub-ordered-1",
        author: "@ordered",
        platform: "YouTube",
      });

      await createSubscription(req as Request, res as Response);

      expect(continuousDownloadService.createTask).toHaveBeenNthCalledWith(
        1,
        "https://www.youtube.com/@ordered",
        "@ordered",
        "YouTube",
        "sub-ordered-1",
        "viewsAsc"
      );
      expect(continuousDownloadService.createTask).toHaveBeenNthCalledWith(
        2,
        "https://www.youtube.com/@ordered/shorts",
        "@ordered (Shorts)",
        "YouTube",
        "sub-ordered-1",
        "viewsAsc"
      );
    });

    it("should ignore downloadOrder when downloadAllPrevious is not true", async () => {
      req.body = {
        url: "https://www.youtube.com/@ignore-order",
        interval: 20,
        downloadAllPrevious: false,
        downloadOrder: "viewsDesc",
      };
      (subscriptionService.subscribe as any).mockResolvedValue({
        id: "sub-ignore-order-1",
        author: "@ignore-order",
        platform: "YouTube",
      });

      await createSubscription(req as Request, res as Response);

      expect(continuousDownloadService.createTask).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(201);
    });

    it("should reject invalid downloadOrder when backfill is enabled", async () => {
      req.body = {
        url: "https://www.youtube.com/@bad-order",
        interval: 10,
        downloadAllPrevious: true,
        downloadOrder: "randomOrder",
      };

      await expect(
        createSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);
      expect(subscriptionService.subscribe).not.toHaveBeenCalled();
    });

    it("should not fail when task creation throws", async () => {
      req.body = {
        url: "https://www.youtube.com/@testuser",
        interval: 60,
        downloadAllPrevious: true,
      };
      const mockSubscription = {
        id: "sub-123",
        author: "@testuser",
        platform: "YouTube",
      };
      (subscriptionService.subscribe as any).mockResolvedValue(mockSubscription);
      (continuousDownloadService.createTask as any).mockRejectedValue(
        new Error("task failed")
      );

      await createSubscription(req as Request, res as Response);

      expect(logger.error).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(mockSubscription);
    });

    it("should throw ValidationError when required fields are missing", async () => {
      req.body = { interval: 60 };
      await expect(
        createSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("simple subscription and task endpoints", () => {
    it("should return all subscriptions", async () => {
      const mockSubscriptions = [
        { id: "sub-1", url: "https://www.youtube.com/@test1", interval: 60 },
      ];
      (subscriptionService.listSubscriptions as any).mockResolvedValue(
        mockSubscriptions
      );

      await getSubscriptions(req as Request, res as Response);

      expect(subscriptionService.listSubscriptions).toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(mockSubscriptions);
    });

    it("should redact ytdlp config overrides for visitor subscription reads", async () => {
      req.user = { role: "visitor" } as any;
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        {
          id: "sub-1",
          author: "private-channel",
          interval: 60,
          ytdlpConfig: "--proxy http://user:pass@example.test:8080",
        },
      ]);

      await getSubscriptions(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith([
        {
          id: "sub-1",
          author: "private-channel",
          interval: 60,
        },
      ]);
    });

    it("should return ytdlp config overrides for trusted admin subscription reads", async () => {
      req.user = { role: "admin" } as any;
      const mockSubscriptions = [
        {
          id: "sub-1",
          author: "private-channel",
          interval: 60,
          ytdlpConfig: "--cookies /config/cookies.txt",
        },
      ];
      (subscriptionService.listSubscriptions as any).mockResolvedValue(
        mockSubscriptions
      );

      await getSubscriptions(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(mockSubscriptions);
    });

    it("should redact ytdlp config overrides when container trust is disabled", async () => {
      const originalTrustLevel = process.env.MYTUBE_ADMIN_TRUST_LEVEL;
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = "application";
      req.user = { role: "admin" } as any;
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        {
          id: "sub-1",
          author: "private-channel",
          interval: 60,
          ytdlpConfig: "--username secret-user",
        },
      ]);

      try {
        await getSubscriptions(req as Request, res as Response);
      } finally {
        if (originalTrustLevel === undefined) {
          delete process.env.MYTUBE_ADMIN_TRUST_LEVEL;
        } else {
          process.env.MYTUBE_ADMIN_TRUST_LEVEL = originalTrustLevel;
        }
      }

      expect(json).toHaveBeenCalledWith([
        {
          id: "sub-1",
          author: "private-channel",
          interval: 60,
        },
      ]);
    });

    it("should delete/pause/resume subscription", async () => {
      req.params = { id: "sub-123" };

      await deleteSubscription(req as Request, res as Response);
      await pauseSubscription(req as Request, res as Response);
      await resumeSubscription(req as Request, res as Response);

      expect(subscriptionService.unsubscribe).toHaveBeenCalledWith("sub-123");
      expect(subscriptionService.pauseSubscription).toHaveBeenCalledWith("sub-123");
      expect(subscriptionService.resumeSubscription).toHaveBeenCalledWith(
        "sub-123"
      );
    });

    it("should update subscription interval", async () => {
      req.params = { id: "sub-123" };
      req.body = { interval: 90 };

      await updateSubscription(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "sub-123",
        { interval: 90 }
      );
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        success: true,
        message: "Subscription updated",
      });
    });

    it("should update subscription retention", async () => {
      req.params = { id: "sub-123" };
      req.body = { retentionDays: 30 };

      await updateSubscription(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "sub-123",
        { retentionDays: 30 }
      );
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should disable subscription retention with null", async () => {
      req.params = { id: "sub-123" };
      req.body = { retentionDays: null };

      await updateSubscription(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "sub-123",
        { retentionDays: null }
      );
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should update subscription interval and retention atomically", async () => {
      req.params = { id: "sub-123" };
      req.body = { interval: 45, retentionDays: 14 };

      await updateSubscription(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "sub-123",
        { interval: 45, retentionDays: 14 }
      );
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should update per-subscription ytdlp config override", async () => {
      req.params = { id: "sub-123" };
      req.body = { ytdlpConfig: "-f bestaudio" };
      (subscriptionService.getSubscriptionById as any).mockResolvedValue({
        id: "sub-123",
        ytdlpConfig: null,
      });

      await updateSubscription(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "sub-123",
        { ytdlpConfig: "-f bestaudio" }
      );
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should clear the ytdlp config override when passed an empty string", async () => {
      req.params = { id: "sub-123" };
      req.body = { ytdlpConfig: "   " };
      (subscriptionService.getSubscriptionById as any).mockResolvedValue({
        id: "sub-123",
        ytdlpConfig: "-f bestaudio",
      });

      await updateSubscription(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "sub-123",
        { ytdlpConfig: null }
      );
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should no-op an unchanged ytdlp config override without a DB write", async () => {
      req.params = { id: "sub-123" };
      req.body = { ytdlpConfig: "-f bestaudio" };
      (subscriptionService.getSubscriptionById as any).mockResolvedValue({
        id: "sub-123",
        ytdlpConfig: "-f bestaudio",
      });

      await updateSubscription(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
    });

    it("should reject an over-length ytdlp config override", async () => {
      req.params = { id: "sub-123" };
      req.body = { ytdlpConfig: "x".repeat(4097) };

      await expect(
        updateSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);
      expect(subscriptionService.updateSubscriptionSettings).not.toHaveBeenCalled();
    });

    it("should reject invalid subscription interval updates", async () => {
      req.params = { id: "sub-123" };
      req.body = { interval: 0 };

      await expect(
        updateSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);
      expect(subscriptionService.updateSubscriptionSettings).not.toHaveBeenCalled();
    });

    it("should reject invalid subscription retention updates", async () => {
      req.params = { id: "sub-123" };
      req.body = { retentionDays: 0 };

      await expect(
        updateSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);
      expect(subscriptionService.updateSubscriptionSettings).not.toHaveBeenCalled();
    });

    it("should reject non-integer subscription interval updates", async () => {
      req.params = { id: "sub-123" };

      for (const interval of ["1.5", "1e2", "90abc"]) {
        req.body = { interval };

        await expect(
          updateSubscription(req as Request, res as Response)
        ).rejects.toThrow(ValidationError);
      }

      expect(subscriptionService.updateSubscriptionSettings).not.toHaveBeenCalled();
    });

    it("should handle task management endpoints", async () => {
      req.params = { id: "task-1" };
      (continuousDownloadService.getAllTasks as any).mockResolvedValue([
        { id: "task-1", author: "author" },
      ]);

      await getContinuousDownloadTasks(req as Request, res as Response);
      await cancelContinuousDownloadTask(req as Request, res as Response);
      await deleteContinuousDownloadTask(req as Request, res as Response);
      await pauseContinuousDownloadTask(req as Request, res as Response);
      await resumeContinuousDownloadTask(req as Request, res as Response);
      await clearFinishedTasks(req as Request, res as Response);

      expect(continuousDownloadService.getAllTasks).toHaveBeenCalled();
      expect(continuousDownloadService.cancelTask).toHaveBeenCalledWith("task-1");
      expect(continuousDownloadService.deleteTask).toHaveBeenCalledWith("task-1");
      expect(continuousDownloadService.pauseTask).toHaveBeenCalledWith("task-1");
      expect(continuousDownloadService.resumeTask).toHaveBeenCalledWith("task-1");
      expect(continuousDownloadService.clearFinishedTasks).toHaveBeenCalled();
    });
  });

  describe("createPlaylistSubscription", () => {
    it("should throw when required fields are missing", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=abc",
        interval: 60,
      };
      await expect(
        createPlaylistSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);
    });

    it("should throw for invalid youtube playlist url", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/watch?v=abc",
        interval: 60,
        collectionName: "My Collection",
      };
      await expect(
        createPlaylistSubscription(req as Request, res as Response)
      ).rejects.toThrow("playlist parameter");
    });

    it("rejects non-boolean downloadAll values (strings/numbers/objects)", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: "false",
      };
      await expect(
        createPlaylistSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);
    });

    it("creates subscribe-only subscription with baseline and no task when downloadAll is false", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: false,
      };
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Playlist Title",
        id: "PL123",
        playlist_count: 12,
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionByName as any).mockReturnValue(null);
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-playlist-1",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      // No historical task created in subscribe-only mode.
      expect(continuousDownloadService.createPlaylistTask).not.toHaveBeenCalled();
      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        expect.objectContaining({
          playlistUrl: "https://www.youtube.com/playlist?list=PL123",
          interval: 60,
          initialHeadVideoUrl: "https://www.youtube.com/watch?v=vidA",
          baselineObservedAt: expect.any(Number),
        })
      );
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription: { id: "sub-playlist-1" },
          taskId: null,
          downloadAll: false,
          backfillStatus: "not_requested",
        })
      );
    });

    it("creates subscription and a linked task when downloadAll is true", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
      };
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Playlist Title",
        id: "PL123",
        playlist_count: 12,
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionByName as any).mockReturnValue(null);
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-playlist-1",
      });
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "task-123",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      // The historical task is linked to the subscription id (design §7.4).
      expect(
        continuousDownloadService.createPlaylistTask
      ).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123",
        "Uploader Name",
        "YouTube",
        expect.any(String),
        "sub-playlist-1"
      );
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription: { id: "sub-playlist-1" },
          taskId: "task-123",
          downloadAll: true,
          backfillStatus: "started",
        })
      );
    });

    it("returns backfillStatus failed (taskId null) when task creation errors", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
      };
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Playlist Title",
        id: "PL123",
        playlist_count: 12,
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionByName as any).mockReturnValue(null);
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-playlist-1",
      });
      (continuousDownloadService.createPlaylistTask as any).mockRejectedValue(
        new Error("task create failed")
      );

      await createPlaylistSubscription(req as Request, res as Response);

      expect(logger.error).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: null,
          backfillStatus: "failed",
        })
      );
    });

    it("uses Bilibili collectionInfo and API videos for a video URL baseline", async () => {
      req.body = {
        playlistUrl: "https://www.bilibili.com/video/BV1xx",
        interval: 30,
        collectionName: "Bili List",
        collectionInfo: {
          type: "collection",
          id: 9988,
          mid: 12345,
          title: "合集标题",
          count: 88,
        },
      };
      (storageService.getCollectionByName as any).mockReturnValue({
        id: "existing-col",
        name: "Bili List",
      });
      (getBilibiliCollectionVideos as any).mockResolvedValue({
        success: true,
        videos: [{ bvid: "BV1head", title: "Head", aid: 1 }],
      });
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-bili-1",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        expect.objectContaining({
          playlistUrl: "https://www.bilibili.com/video/BV1xx",
          interval: 30,
          playlistTitle: "合集标题",
          playlistId: "9988",
          author: "Bilibili 12345",
          platform: "Bilibili",
          collectionId: "existing-col",
          initialHeadVideoUrl: "https://www.bilibili.com/video/BV1head",
        })
      );
      expect(executeYtDlpJson).not.toHaveBeenCalled();
      expect(getBilibiliSeriesVideos).not.toHaveBeenCalled();
    });

    it("creates a separate collection when a Bilibili name matches another source key", async () => {
      req.body = {
        playlistUrl: "https://www.bilibili.com/video/BV1xx",
        interval: 30,
        collectionName: "Bili List",
        collectionInfo: {
          type: "collection",
          id: 9988,
          mid: 12345,
          title: "合集标题",
          count: 88,
        },
      };
      (storageService.getCollectionBySourceKey as any).mockReturnValue(
        undefined
      );
      (storageService.getCollectionByName as any).mockReturnValue({
        id: "other-source-col",
        name: "Bili List",
        videos: [],
        sourcePlatform: "bilibili",
        sourceType: "collection",
        sourceMid: "999",
        sourceId: "111",
      });
      (storageService.generateUniqueCollectionName as any).mockReturnValue(
        "Bili List (2)"
      );
      (getBilibiliCollectionVideos as any).mockResolvedValue({
        success: true,
        videos: [{ bvid: "BV1head", title: "Head", aid: 1 }],
      });
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-bili-1",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      const savedCollection = (storageService.saveCollection as Mock).mock
        .calls[0][0];
      expect(savedCollection).toEqual(
        expect.objectContaining({
          name: "Bili List (2)",
          sourcePlatform: "bilibili",
          sourceType: "collection",
          sourceMid: "12345",
          sourceId: "9988",
        })
      );
      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionId: savedCollection.id,
        })
      );
    });

    it("starts Bilibili collection backfill when API inspection finds videos despite a zero client count", async () => {
      req.body = {
        playlistUrl: "https://www.bilibili.com/video/BV1xx",
        interval: 30,
        collectionName: "Bili List",
        downloadAll: true,
        collectionInfo: {
          type: "collection",
          id: 9988,
          mid: 12345,
          title: "合集标题",
          count: 0,
        },
      };
      (storageService.getCollectionByName as any).mockReturnValue({
        id: "existing-col",
        name: "Bili List",
      });
      (getBilibiliCollectionVideos as any).mockResolvedValue({
        success: true,
        videos: [{ bvid: "BV1head", title: "Head", aid: 1 }],
      });
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-bili-1",
      });
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "task-bili",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.bilibili.com/video/BV1xx",
        "Bilibili 12345",
        "Bilibili",
        "existing-col",
        "sub-bili-1"
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-bili",
          backfillStatus: "started",
        })
      );
    });

    it("returns backfillStatus not_needed_empty for a verified empty playlist with downloadAll", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
      };
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Empty",
        id: "PL123",
        entries: [],
      });
      (storageService.getCollectionByName as any).mockReturnValue(null);
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-empty",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      // Empty playlist omits the zero-length task (design §4.5).
      expect(
        continuousDownloadService.createPlaylistTask
      ).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: null,
          backfillStatus: "not_needed_empty",
        })
      );
    });

    it("creates no subscription/collection/task when the baseline probe fails (fail-closed)", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: false,
      };
      (executeYtDlpJson as any).mockRejectedValue(new Error("probe failed"));
      (storageService.getCollectionByName as any).mockReturnValue(null);

      await expect(
        createPlaylistSubscription(req as Request, res as Response)
      ).rejects.toThrow("probe failed");

      // No persistent side effects created before the baseline (design §7.5).
      expect(subscriptionService.subscribePlaylist).not.toHaveBeenCalled();
      expect(storageService.saveCollection).not.toHaveBeenCalled();
      expect(
        continuousDownloadService.createPlaylistTask
      ).not.toHaveBeenCalled();
    });

    it("rejects a direct duplicate before creating a collection/task", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
      };
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        { authorUrl: "https://www.youtube.com/playlist?list=PL123" },
      ]);
      (storageService.getCollectionByName as any).mockReturnValue(null);

      await expect(
        createPlaylistSubscription(req as Request, res as Response)
      ).rejects.toThrow(/already exists/);

      // Duplicate is rejected before any probe or collection creation.
      expect(executeYtDlpJson).not.toHaveBeenCalled();
      expect(storageService.saveCollection).not.toHaveBeenCalled();
    });

    it("queues backfill for a direct duplicate when downloadAll is true", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
      };
      const existingSubscription = {
        id: "existing-sub",
        authorUrl: "https://www.youtube.com/playlist?list=PL123",
        collectionId: "existing-col",
        ytdlpConfig: "--cookies /config/cookies.txt",
        filenameTemplate: "{{ source_custom_name }}/{{ title }}.{{ ext }}",
      };
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        existingSubscription,
      ]);
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Playlist Title",
        id: "PL123",
        playlist_count: 12,
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionById as any).mockReturnValue({
        id: "existing-col",
        name: "My Playlist",
      });
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue(null);
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "task-existing",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      expect(subscriptionService.subscribePlaylist).not.toHaveBeenCalled();
      expect(subscriptionService.updateSubscriptionSettings).not.toHaveBeenCalled();
      expect(storageService.getCollectionByName).not.toHaveBeenCalled();
      expect(getEffectiveUserYtDlpConfig).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123",
        "--cookies /config/cookies.txt"
      );
      expect(
        continuousDownloadService.getBlockingPlaylistTaskByDestination
      ).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123",
        "existing-sub",
        "existing-col"
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123",
        "Uploader Name",
        "YouTube",
        "existing-col",
        "existing-sub"
      );
      expect(
        subscriptionService.updatePlaylistSubscriptionCursor
      ).toHaveBeenCalledWith(
        "existing-sub",
        "https://www.youtube.com/watch?v=vidA",
        expect.any(Number)
      );
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription: expect.objectContaining({
            id: "existing-sub",
            lastVideoLink: "https://www.youtube.com/watch?v=vidA",
            lastCheck: expect.any(Number),
          }),
          collectionId: "existing-col",
          taskId: "task-existing",
          downloadAll: true,
          backfillStatus: "started",
        })
      );
    });

    it("updates an existing duplicate playlist filenameTemplate before backfill", async () => {
      const filenameTemplate = "{{ source_custom_name }}/{{ title }}.{{ ext }}";
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
        filenameTemplate,
      };
      const existingSubscription = {
        id: "existing-sub",
        authorUrl: "https://www.youtube.com/playlist?list=PL123",
        collectionId: "existing-col",
        filenameTemplate: null,
      };
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        existingSubscription,
      ]);
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Playlist Title",
        id: "PL123",
        playlist_count: 12,
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionById as any).mockReturnValue({
        id: "existing-col",
        name: "My Playlist",
      });
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue(null);
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "task-existing",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "existing-sub",
        { filenameTemplate }
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123",
        "Uploader Name",
        "YouTube",
        "existing-col",
        "existing-sub"
      );
      const updateOrder = (
        subscriptionService.updateSubscriptionSettings as Mock
      ).mock.invocationCallOrder[0];
      const createTaskOrder = (
        continuousDownloadService.createPlaylistTask as Mock
      ).mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(createTaskOrder);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription: expect.objectContaining({
            id: "existing-sub",
            filenameTemplate,
            lastVideoLink: "https://www.youtube.com/watch?v=vidA",
            lastCheck: expect.any(Number),
          }),
          taskId: "task-existing",
          backfillStatus: "started",
        })
      );
    });

    it("links a resolved collection to a legacy direct duplicate before backfill", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
      };
      const existingSubscription = {
        id: "legacy-sub",
        authorUrl: "https://www.youtube.com/playlist?list=PL123",
        collectionId: null,
      };
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        existingSubscription,
      ]);
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Playlist Title",
        id: "PL123",
        playlist_count: 12,
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionByName as any).mockReturnValue({
        id: "resolved-col",
        name: "My Playlist",
      });
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue(null);
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "task-legacy",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      expect(
        subscriptionService.updatePlaylistSubscriptionCollection
      ).toHaveBeenCalledWith("legacy-sub", "resolved-col");
      expect(
        subscriptionService.updatePlaylistSubscriptionCursor
      ).toHaveBeenCalledWith(
        "legacy-sub",
        "https://www.youtube.com/watch?v=vidA",
        expect.any(Number)
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123",
        "Uploader Name",
        "YouTube",
        "resolved-col",
        "legacy-sub"
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription: expect.objectContaining({
            id: "legacy-sub",
            collectionId: "resolved-col",
            lastVideoLink: "https://www.youtube.com/watch?v=vidA",
            lastCheck: expect.any(Number),
          }),
          collectionId: "resolved-col",
          taskId: "task-legacy",
          backfillStatus: "started",
        })
      );
    });

    it("does not queue a duplicate direct backfill task when one already exists", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
      };
      const existingSubscription = {
        id: "existing-sub",
        authorUrl: "https://www.youtube.com/playlist?list=PL123",
        collectionId: "existing-col",
      };
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        existingSubscription,
      ]);
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Playlist Title",
        id: "PL123",
        playlist_count: 12,
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionById as any).mockReturnValue({
        id: "existing-col",
        name: "My Playlist",
      });
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue({
        id: "existing-task",
        status: "active",
        subscriptionId: "existing-sub",
        collectionId: "existing-col",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      expect(subscriptionService.subscribePlaylist).not.toHaveBeenCalled();
      expect(continuousDownloadService.createPlaylistTask).not.toHaveBeenCalled();
      expect(
        subscriptionService.updatePlaylistSubscriptionCursor
      ).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription: existingSubscription,
          collectionId: "existing-col",
          taskId: "existing-task",
          downloadAll: true,
          backfillStatus: "already_exists",
        })
      );
    });

    it("queues a replacement direct backfill when no blocking task belongs to the same destination", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
      };
      const existingSubscription = {
        id: "existing-sub",
        authorUrl: "https://www.youtube.com/playlist?list=PL123",
        collectionId: "existing-col",
      };
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        existingSubscription,
      ]);
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Playlist Title",
        id: "PL123",
        playlist_count: 12,
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionById as any).mockReturnValue({
        id: "existing-col",
        name: "My Playlist",
      });
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue(null);
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "replacement-task",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123",
        "Uploader Name",
        "YouTube",
        "existing-col",
        "existing-sub"
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "replacement-task",
          backfillStatus: "started",
        })
      );
    });

    it("queues a replacement direct backfill when the previous task is terminal", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
      };
      const existingSubscription = {
        id: "existing-sub",
        authorUrl: "https://www.youtube.com/playlist?list=PL123",
        collectionId: "existing-col",
      };
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        existingSubscription,
      ]);
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Playlist Title",
        id: "PL123",
        playlist_count: 12,
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionById as any).mockReturnValue({
        id: "existing-col",
        name: "My Playlist",
      });
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue(null);
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "replacement-task",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123",
        "Uploader Name",
        "YouTube",
        "existing-col",
        "existing-sub"
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "replacement-task",
          backfillStatus: "started",
        })
      );
    });

    it("removes a fresh empty collection when subscription insertion fails", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
      };
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "Playlist Title",
        id: "PL123",
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionByName as any).mockReturnValue(null);
      (storageService.getCollectionById as any).mockImplementation((id: string) => ({
        id,
        name: "My Playlist-unique",
        videos: [],
      }));
      (subscriptionService.subscribePlaylist as any).mockRejectedValue(
        new Error("insert failed")
      );
      (subscriptionService.listSubscriptions as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      (storageService.deleteCollection as any).mockReturnValue(true);

      await expect(
        createPlaylistSubscription(req as Request, res as Response)
      ).rejects.toThrow("insert failed");

      expect(storageService.deleteCollection).toHaveBeenCalledWith(
        expect.any(String)
      );
    });

    it("rejects malformed Bilibili collectionInfo instead of silently ignoring it", async () => {
      req.body = {
        playlistUrl: "https://www.bilibili.com/list/ml123",
        interval: 60,
        collectionName: "Bili List",
        collectionInfo: { type: "unknown", id: "123" },
      };

      await expect(
        createPlaylistSubscription(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);
      expect(executeYtDlpJson).not.toHaveBeenCalled();
    });
  });


  describe("subscribeChannelPlaylists", () => {
    it("should throw when required fields are missing", async () => {
      req.body = { url: "https://www.youtube.com/@channel" };
      await expect(
        subscribeChannelPlaylists(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);
    });

    it("should throw when no playlists are found", async () => {
      req.body = { url: "https://www.youtube.com/@channel", interval: 60 };
      (executeYtDlpJson as any).mockResolvedValue({ entries: [] });

      await expect(
        subscribeChannelPlaylists(req as Request, res as Response)
      ).rejects.toThrow("No playlists found");
    });

    // Models the new two-phase flow (design §8.1): one listing call feeds the
    // candidate list and the duplicate set, then each new candidate gets a
    // head-snapshot probe before a sequential collection+subscription insert.
    function setupChannelPlaylistsMocks() {
      req.body = {
        url: "https://www.youtube.com/@channel",
        interval: 60,
        downloadAllPrevious: true,
      };
      // 1st call: channel listing. PL_TWO is already subscribed (in the set).
      // Then one head probe for PL_ONE.
      (executeYtDlpJson as any)
        .mockResolvedValueOnce({
          uploader: "My Channel",
          entries: [
            { id: "PL_ONE", url: "https://www.youtube.com/playlist?list=PL_ONE", title: "Playlist One" },
            { id: "PL_TWO", url: "https://www.youtube.com/playlist?list=PL_TWO", title: "Playlist Two" },
          ],
        })
        .mockResolvedValueOnce({
          _type: "playlist",
          entries: [{ id: "headOne" }],
        })
        .mockResolvedValueOnce({
          _type: "playlist",
          entries: [{ id: "headTwo" }],
        });
      (storageService.getSettings as any).mockReturnValue({ saveAuthorFilesToCollection: false });
      (storageService.getCollectionByName as any).mockReturnValue({
        id: "col-one",
        name: "Playlist One",
      });
      // Single listSubscriptions call; PL_TWO is already in the set.
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        {
          id: "existing-sub-two",
          authorUrl: "https://www.youtube.com/playlist?list=PL_TWO",
          collectionId: "existing-col-two",
        },
      ]);
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "new-sub-one",
      });
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue(null);
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "created-task-1",
      });
    }

    it("should subscribe new playlists with a baseline and skip duplicates", async () => {
      setupChannelPlaylistsMocks();
      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledTimes(1);
      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        expect.objectContaining({
          playlistUrl: "https://www.youtube.com/playlist?list=PL_ONE",
          interval: 60,
          playlistTitle: "Playlist One",
          playlistId: "PL_ONE",
          author: "My Channel",
          platform: "YouTube",
          initialHeadVideoUrl: "https://www.youtube.com/watch?v=headOne",
          baselineObservedAt: expect.any(Number),
          filenameTemplate: null,
        })
      );
      // Backfill task linked to the newly created subscription (design §7.4).
      expect(
        continuousDownloadService.createPlaylistTask
      ).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL_ONE",
        "My Channel",
        "YouTube",
        "col-one",
        "new-sub-one"
      );
    });

    it("should create watcher and respond with counts", async () => {
      setupChannelPlaylistsMocks();
      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.subscribeChannelPlaylistsWatcher).toHaveBeenCalledWith(
        "https://www.youtube.com/@channel/playlists", 60, "My Channel", "YouTube",
        undefined
      );
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ subscribedCount: 1, skippedCount: 1, errorCount: 0 })
      );
    });

    it("should pass null to the watcher when filenameTemplate is explicitly cleared", async () => {
      setupChannelPlaylistsMocks();
      req.body.filenameTemplate = "   ";

      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.subscribeChannelPlaylistsWatcher).toHaveBeenCalledWith(
        "https://www.youtube.com/@channel/playlists", 60, "My Channel", "YouTube",
        null
      );
    });

    it("updates existing bulk playlist filenameTemplate when backfill is not requested", async () => {
      const filenameTemplate = "{{ source_custom_name }}/{{ title }}.{{ ext }}";
      req.body = {
        url: "https://www.youtube.com/@channel",
        interval: 60,
        filenameTemplate,
      };
      (executeYtDlpJson as any).mockResolvedValueOnce({
        uploader: "My Channel",
        entries: [
          {
            id: "PL_EXISTING",
            url: "https://www.youtube.com/playlist?list=PL_EXISTING",
            title: "Existing Playlist",
          },
        ],
      });
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        {
          id: "existing-sub",
          authorUrl: "https://www.youtube.com/playlist?list=PL_EXISTING",
          collectionId: "existing-col",
          filenameTemplate: null,
        },
      ]);

      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "existing-sub",
        { filenameTemplate }
      );
      expect(subscriptionService.subscribePlaylist).not.toHaveBeenCalled();
      expect(continuousDownloadService.createPlaylistTask).not.toHaveBeenCalled();
      expect(subscriptionService.subscribeChannelPlaylistsWatcher).toHaveBeenCalledWith(
        "https://www.youtube.com/@channel/playlists",
        60,
        "My Channel",
        "YouTube",
        filenameTemplate
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ subscribedCount: 0, skippedCount: 1 })
      );
    });

    it("creates a backfill task for an already subscribed playlist when requested", async () => {
      req.body = {
        url: "https://www.youtube.com/@channel",
        interval: 60,
        downloadAllPrevious: true,
      };
      (executeYtDlpJson as any)
        .mockResolvedValueOnce({
          uploader: "My Channel",
          entries: [
            {
              id: "PL_EXISTING",
              url: "https://www.youtube.com/playlist?list=PL_EXISTING",
              title: "Existing Playlist",
            },
          ],
        })
        .mockResolvedValueOnce({
          _type: "playlist",
          entries: [{ id: "existingHead" }],
        });
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        {
          id: "existing-sub",
          authorUrl: "https://www.youtube.com/playlist?list=PL_EXISTING",
          collectionId: "existing-col",
          ytdlpConfig: "--cookies /bulk-cookies.txt",
        },
      ]);
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue(null);
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "backfill-task",
      });

      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.subscribePlaylist).not.toHaveBeenCalled();
      expect(getEffectiveUserYtDlpConfig).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL_EXISTING",
        "--cookies /bulk-cookies.txt"
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL_EXISTING",
        "My Channel",
        "YouTube",
        "existing-col",
        "existing-sub"
      );
      expect(
        subscriptionService.updatePlaylistSubscriptionCursor
      ).toHaveBeenCalledWith(
        "existing-sub",
        "https://www.youtube.com/watch?v=existingHead",
        expect.any(Number)
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ subscribedCount: 0, skippedCount: 1 })
      );
    });

    it("updates existing bulk playlist filenameTemplate before linked backfill", async () => {
      const filenameTemplate = "{{ source_custom_name }}/{{ title }}.{{ ext }}";
      req.body = {
        url: "https://www.youtube.com/@channel",
        interval: 60,
        downloadAllPrevious: true,
        filenameTemplate,
      };
      (executeYtDlpJson as any)
        .mockResolvedValueOnce({
          uploader: "My Channel",
          entries: [
            {
              id: "PL_EXISTING",
              url: "https://www.youtube.com/playlist?list=PL_EXISTING",
              title: "Existing Playlist",
            },
          ],
        })
        .mockResolvedValueOnce({
          _type: "playlist",
          entries: [{ id: "existingHead" }],
        });
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        {
          id: "existing-sub",
          authorUrl: "https://www.youtube.com/playlist?list=PL_EXISTING",
          collectionId: "existing-col",
          filenameTemplate: null,
        },
      ]);
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue(null);
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "backfill-task",
      });

      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "existing-sub",
        { filenameTemplate }
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL_EXISTING",
        "My Channel",
        "YouTube",
        "existing-col",
        "existing-sub"
      );
      const updateOrder = (
        subscriptionService.updateSubscriptionSettings as Mock
      ).mock.invocationCallOrder[0];
      const createTaskOrder = (
        continuousDownloadService.createPlaylistTask as Mock
      ).mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(createTaskOrder);
    });

    it("updates concurrently discovered duplicate playlist filenameTemplate before backfill", async () => {
      const filenameTemplate = "{{ source_custom_name }}/{{ title }}.{{ ext }}";
      req.body = {
        url: "https://www.youtube.com/@channel",
        interval: 60,
        downloadAllPrevious: true,
        filenameTemplate,
      };
      (executeYtDlpJson as any)
        .mockResolvedValueOnce({
          uploader: "My Channel",
          entries: [
            {
              id: "PL_RACE",
              url: "https://www.youtube.com/playlist?list=PL_RACE",
              title: "Raced Playlist",
            },
          ],
        })
        .mockResolvedValueOnce({
          _type: "playlist",
          entries: [{ id: "racedHead" }],
        });
      (subscriptionService.listSubscriptions as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "concurrent-sub",
            authorUrl: "https://www.youtube.com/playlist?list=PL_RACE",
            collectionId: "concurrent-col",
            filenameTemplate: null,
          },
        ]);
      (storageService.getCollectionByName as any).mockReturnValue({
        id: "request-col",
        name: "Raced Playlist - My Channel",
      });
      const duplicate = new Error("already subscribed");
      duplicate.name = "DuplicateError";
      (subscriptionService.subscribePlaylist as any).mockRejectedValue(duplicate);
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue(null);
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "raced-backfill-task",
      });

      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "concurrent-sub",
        { filenameTemplate }
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL_RACE",
        "My Channel",
        "YouTube",
        "concurrent-col",
        "concurrent-sub"
      );
      const updateOrder = (
        subscriptionService.updateSubscriptionSettings as Mock
      ).mock.invocationCallOrder[0];
      const createTaskOrder = (
        continuousDownloadService.createPlaylistTask as Mock
      ).mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(createTaskOrder);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ subscribedCount: 0, skippedCount: 1 })
      );
    });

    it("resolves a collection for already subscribed playlist backfill when the row has none", async () => {
      req.body = {
        url: "https://www.youtube.com/@channel",
        interval: 60,
        downloadAllPrevious: true,
      };
      (executeYtDlpJson as any)
        .mockResolvedValueOnce({
          uploader: "My Channel",
          entries: [
            {
              id: "PL_LEGACY",
              url: "https://www.youtube.com/playlist?list=PL_LEGACY",
              title: "Legacy Playlist",
            },
          ],
        })
        .mockResolvedValueOnce({
          _type: "playlist",
          entries: [{ id: "legacyHead" }],
        });
      (subscriptionService.listSubscriptions as any).mockResolvedValue([
        {
          id: "legacy-sub",
          authorUrl: "https://www.youtube.com/playlist?list=PL_LEGACY",
          collectionId: null,
        },
      ]);
      (storageService.getCollectionByName as any).mockReturnValue({
        id: "resolved-legacy-col",
        name: "Legacy Playlist - My Channel",
      });
      (
        continuousDownloadService.getBlockingPlaylistTaskByDestination as any
      ).mockResolvedValue(null);
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "legacy-backfill-task",
      });

      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.subscribePlaylist).not.toHaveBeenCalled();
      expect(storageService.getCollectionByName).toHaveBeenCalledWith(
        "Legacy Playlist - My Channel"
      );
      expect(
        subscriptionService.updatePlaylistSubscriptionCollection
      ).toHaveBeenCalledWith("legacy-sub", "resolved-legacy-col");
      expect(
        subscriptionService.updatePlaylistSubscriptionCursor
      ).toHaveBeenCalledWith(
        "legacy-sub",
        "https://www.youtube.com/watch?v=legacyHead",
        expect.any(Number)
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL_LEGACY",
        "My Channel",
        "YouTube",
        "resolved-legacy-col",
        "legacy-sub"
      );
    });

    it("counts a failed baseline probe as an error, not a skip", async () => {
      req.body = {
        url: "https://www.youtube.com/@channel",
        interval: 60,
      };
      (executeYtDlpJson as any)
        .mockResolvedValueOnce({
          uploader: "My Channel",
          entries: [
            { id: "PL_BAD", url: "https://www.youtube.com/playlist?list=PL_BAD", title: "Bad" },
          ],
        })
        // Head probe fails.
        .mockRejectedValueOnce(new Error("probe failed"));
      (subscriptionService.listSubscriptions as any).mockResolvedValue([]);

      await subscribeChannelPlaylists(req as Request, res as Response);

      // Failed baseline => error, no subscription created.
      expect(subscriptionService.subscribePlaylist).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ subscribedCount: 0, errorCount: 1 })
      );
    });

    it("should fallback channel name from url when uploader is missing", async () => {
      req.body = {
        url: "https://www.youtube.com/@MyChannel",
        interval: 60,
      };
      (executeYtDlpJson as any)
        .mockResolvedValueOnce({
          channel_id: "id-1",
          entries: [{ id: "PL1", title: "P1" }],
        })
        .mockResolvedValueOnce({ _type: "playlist", entries: [{ id: "h1" }] });
      (subscriptionService.listSubscriptions as any).mockResolvedValue([]);
      (storageService.getCollectionByName as any).mockReturnValue(null);
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({ id: "s1" });

      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        expect.objectContaining({
          playlistUrl: "https://www.youtube.com/playlist?list=PL1",
          interval: 60,
          playlistTitle: "P1",
          playlistId: "PL1",
          author: "@MyChannel",
          platform: "YouTube",
          collectionId: expect.any(String),
          initialHeadVideoUrl: "https://www.youtube.com/watch?v=h1",
          baselineObservedAt: expect.any(Number),
          filenameTemplate: null,
        })
      );
      expect(storageService.saveCollection).toHaveBeenCalled();
    });
  });

  describe("createPlaylistTask", () => {
    it("should throw validation errors for bad input", async () => {
      req.body = { playlistUrl: "https://www.youtube.com/playlist?list=abc" };
      await expect(
        createPlaylistTask(req as Request, res as Response)
      ).rejects.toThrow(ValidationError);

      req.body = {
        playlistUrl: "https://www.youtube.com/watch?v=abc",
        collectionName: "Collection",
      };
      await expect(
        createPlaylistTask(req as Request, res as Response)
      ).rejects.toThrow("playlist parameter");
    });

    it("should throw when checkPlaylist fails", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=abc",
        collectionName: "Collection",
      };
      (checkPlaylist as any).mockResolvedValue({
        success: false,
        error: "playlist invalid",
      });

      await expect(
        createPlaylistTask(req as Request, res as Response)
      ).rejects.toThrow("playlist invalid");
    });

    it("should create playlist task and collection with extracted author", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=abc",
        collectionName: "Collection",
      };
      (checkPlaylist as any).mockResolvedValue({ success: true });
      (executeYtDlpJson as any).mockResolvedValue({
        entries: [{ uploader: "Author A" }],
      });
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "task-1",
      });

      await createPlaylistTask(req as Request, res as Response);

      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=abc",
        "Author A",
        "YouTube",
        expect.any(String)
      );
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          collectionId: expect.any(String),
        })
      );
    });

    it("should continue with default author when extract author fails", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=abc",
        collectionName: "Collection",
      };
      (checkPlaylist as any).mockResolvedValue({ success: true });
      (executeYtDlpJson as any).mockRejectedValue(new Error("extract failed"));
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "task-2",
      });

      await createPlaylistTask(req as Request, res as Response);

      expect(logger.warn).toHaveBeenCalled();
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=abc",
        "Playlist Author",
        "YouTube",
        expect.any(String)
      );
    });
  });

  it("should keep utility mocks wired for network config helpers", () => {
    expect(getUserYtDlpConfig).toBeDefined();
    expect(getNetworkConfigFromUserConfig).toBeDefined();
  });

  describe("filename template override", () => {
    it("createSubscription passes filenameTemplate to subscribe", async () => {
      req.body = {
        url: "https://www.youtube.com/@testuser/",
        interval: 60,
        filenameTemplate: "{{ source_custom_name }}/{{ title }}.{{ ext }}",
      };
      (subscriptionService.subscribe as any).mockResolvedValue({
        id: "sub-123",
        author: "@testuser",
        platform: "YouTube",
      });
      await createSubscription(req as Request, res as Response);
      expect(subscriptionService.subscribe).toHaveBeenCalledWith(
        "https://www.youtube.com/@testuser",
        60,
        undefined,
        false,
        null,
        "{{ source_custom_name }}/{{ title }}.{{ ext }}"
      );
    });

    it("createSubscription rejects an invalid filenameTemplate", async () => {
      req.body = {
        url: "https://www.youtube.com/@testuser/",
        interval: 60,
        filenameTemplate: "../escape.{{ ext }}",
      };
      (subscriptionService.subscribe as any).mockResolvedValue({
        id: "sub-123",
        author: "@testuser",
        platform: "YouTube",
      });
      await expect(createSubscription(req as Request, res as Response)).rejects.toThrow(
        ValidationError
      );
      expect(subscriptionService.subscribe).not.toHaveBeenCalled();
    });

    it("createPlaylistSubscription passes filenameTemplate to subscribePlaylist", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        filenameTemplate: "{{ title }}.{{ ext }}",
      };
      (executeYtDlpJson as any).mockResolvedValue({
        _type: "playlist",
        title: "My Playlist",
        id: "PL123",
        playlist_count: 5,
        entries: [{ id: "vidA", uploader: "Uploader Name" }],
      });
      (storageService.getCollectionByName as any).mockReturnValue(null);
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-playlist-1",
        author: "My Playlist - author",
        platform: "YouTube",
      });
      await createPlaylistSubscription(req as Request, res as Response);
      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        expect.objectContaining({
          playlistUrl: "https://www.youtube.com/playlist?list=PL123",
          interval: 60,
          playlistTitle: "My Playlist",
          playlistId: "PL123",
          author: "Uploader Name",
          platform: "YouTube",
          collectionId: expect.any(String),
          initialHeadVideoUrl: "https://www.youtube.com/watch?v=vidA",
          baselineObservedAt: expect.any(Number),
          filenameTemplate: "{{ title }}.{{ ext }}",
        })
      );
    });

    it("updateSubscription persists a valid filenameTemplate", async () => {
      req.params = { id: "sub-123" };
      req.body = { filenameTemplate: "{{ title }}.{{ ext }}" };
      (subscriptionService.getSubscriptionById as any).mockResolvedValue({
        id: "sub-123",
        subscriptionType: "author",
        filenameTemplate: null,
      });
      await updateSubscription(req as Request, res as Response);
      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "sub-123",
        { filenameTemplate: "{{ title }}.{{ ext }}" }
      );
    });

    it("updateSubscription clears filenameTemplate to null", async () => {
      req.params = { id: "sub-123" };
      req.body = { filenameTemplate: "   " };
      (subscriptionService.getSubscriptionById as any).mockResolvedValue({
        id: "sub-123",
        subscriptionType: "author",
        filenameTemplate: "{{ title }}.{{ ext }}",
      });
      await updateSubscription(req as Request, res as Response);
      expect(subscriptionService.updateSubscriptionSettings).toHaveBeenCalledWith(
        "sub-123",
        { filenameTemplate: null }
      );
    });

    it("updateSubscription rejects an invalid filenameTemplate", async () => {
      req.params = { id: "sub-123" };
      req.body = { filenameTemplate: "no-extension-placeholder" };
      (subscriptionService.getSubscriptionById as any).mockResolvedValue({
        id: "sub-123",
        subscriptionType: "author",
        filenameTemplate: null,
      });
      await expect(updateSubscription(req as Request, res as Response)).rejects.toThrow(
        ValidationError
      );
      expect(subscriptionService.updateSubscriptionSettings).not.toHaveBeenCalled();
    });

    it("updateSubscription keeps the normal not-found error for overrides", async () => {
      req.params = { id: "missing-subscription" };
      req.body = { filenameTemplate: "{{ title }}.{{ ext }}" };
      (subscriptionService.getSubscriptionById as any).mockResolvedValue(null);

      await expect(
        updateSubscription(req as Request, res as Response)
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
