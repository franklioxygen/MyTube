import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
} from "../../controllers/subscriptionController";
import { ValidationError } from "../../errors/DownloadErrors";
import { continuousDownloadService } from "../../services/continuousDownloadService";
import { checkPlaylist } from "../../services/downloadService";
import * as storageService from "../../services/storageService";
import { subscriptionService } from "../../services/subscriptionService";
import { logger } from "../../utils/logger";
import {
    executeYtDlpJson,
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
    subscribePlaylist: vi.fn(),
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
  },
}));

vi.mock("../../services/downloadService", () => ({
  checkPlaylist: vi.fn(),
}));

vi.mock("../../services/storageService", () => ({
  getCollectionByName: vi.fn(),
  generateUniqueCollectionName: vi.fn((name: string) => `${name}-unique`),
  saveCollection: vi.fn(),
  getSettings: vi.fn(() => ({})),
}));

vi.mock("../../utils/helpers", () => ({
  isBilibiliUrl: vi.fn((url: string) => url.includes("bilibili")),
  isYouTubeUrl: vi.fn((url: string) => url.includes("youtube")),
  normalizeYouTubeAuthorUrl: vi.fn((url: string) => url.replace(/\/+$/, "")),
}));

vi.mock("../../utils/ytDlpUtils", () => ({
  executeYtDlpJson: vi.fn(),
  getNetworkConfigFromUserConfig: vi.fn(() => ({})),
  getUserYtDlpConfig: vi.fn(() => ({})),
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
  let json: ReturnType<typeof vi.fn>;
  let status: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = { body: {}, params: {} };
    res = { json, status };
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
        true
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
        "sub-123"
      );
      expect(continuousDownloadService.createTask).toHaveBeenNthCalledWith(
        2,
        "https://www.youtube.com/@testuser/shorts",
        "@testuser (Shorts)",
        "YouTube",
        "sub-123"
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
        "sub-bili-1"
      );
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

    it("should create playlist subscription for youtube and create task when downloadAll is true", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
      };
      (checkPlaylist as any).mockResolvedValue({
        success: true,
        title: "Playlist Title",
        videoCount: 12,
      });
      (storageService.getCollectionByName as any).mockReturnValue(null);
      (executeYtDlpJson as any).mockResolvedValue({
        entries: [{ uploader: "Uploader Name" }],
      });
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-playlist-1",
      });
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "task-123",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      expect(checkPlaylist).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123"
      );
      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123",
        60,
        "Playlist Title",
        "PL123",
        "Uploader Name",
        "YouTube",
        expect.any(String)
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription: { id: "sub-playlist-1" },
          taskId: "task-123",
        })
      );
    });

    it("should use bilibili collectionInfo without calling checkPlaylist", async () => {
      req.body = {
        playlistUrl: "https://www.bilibili.com/list/ml123",
        interval: 30,
        collectionName: "Bili List",
        collectionInfo: {
          type: "collection",
          id: 9988,
          title: "合集标题",
          count: 88,
        },
      };
      (storageService.getCollectionByName as any).mockReturnValue({
        id: "existing-col",
        name: "Bili List",
      });
      (executeYtDlpJson as any).mockResolvedValue({ uploader: "UP Name" });
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-bili-1",
      });

      await createPlaylistSubscription(req as Request, res as Response);

      expect(checkPlaylist).not.toHaveBeenCalled();
      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        "https://www.bilibili.com/list/ml123",
        30,
        "合集标题",
        "9988",
        "UP Name",
        "Bilibili",
        "existing-col"
      );
    });

    it("should continue with default author when yt-dlp extraction fails", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
      };
      (checkPlaylist as any).mockResolvedValue({
        success: true,
        title: "Playlist Title",
        videoCount: 12,
      });
      (storageService.getCollectionByName as any).mockReturnValue(null);
      (executeYtDlpJson as any).mockRejectedValue(new Error("yt-dlp error"));
      (subscriptionService.subscribePlaylist as any).mockResolvedValue({
        id: "sub-playlist-1",
      });

      await createPlaylistSubscription(req as Request, res as Response);
      expect(logger.warn).toHaveBeenCalled();
      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL123",
        60,
        "Playlist Title",
        "PL123",
        "Playlist Author",
        "YouTube",
        expect.any(String)
      );
    });

    it("should not fail when creating backfill task errors", async () => {
      req.body = {
        playlistUrl: "https://www.youtube.com/playlist?list=PL123",
        interval: 60,
        collectionName: "My Playlist",
        downloadAll: true,
      };
      (checkPlaylist as any).mockResolvedValue({
        success: true,
        title: "Playlist Title",
      });
      (storageService.getCollectionByName as any).mockReturnValue(null);
      (executeYtDlpJson as any).mockResolvedValue({ uploader: "Uploader Name" });
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
          taskId: undefined,
        })
      );
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

    function setupChannelPlaylistsMocks() {
      req.body = {
        url: "https://www.youtube.com/@channel",
        interval: 60,
        downloadAllPrevious: true,
      };
      (executeYtDlpJson as any).mockResolvedValue({
        uploader: "My Channel",
        entries: [
          { id: "PL_ONE", url: "https://www.youtube.com/playlist?list=PL_ONE", title: "Playlist One" },
          { id: "PL_TWO", url: "https://www.youtube.com/playlist?list=PL_TWO", title: "Playlist Two" },
        ],
      });
      (storageService.getSettings as any).mockReturnValue({ saveAuthorFilesToCollection: false });
      (storageService.getCollectionByName as any)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ id: "existing-col-2", name: "Playlist Two" });
      (subscriptionService.listSubscriptions as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { authorUrl: "https://www.youtube.com/playlist?list=PL_TWO" },
        ]);
      (continuousDownloadService.getTaskByAuthorUrl as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "existing-task" });
      (continuousDownloadService.createPlaylistTask as any).mockResolvedValue({
        id: "created-task-1",
      });
    }

    it("should subscribe new playlists and skip duplicates", async () => {
      setupChannelPlaylistsMocks();
      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledTimes(1);
      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL_ONE",
        60, "Playlist One", "PL_ONE", "My Channel", "YouTube",
        expect.any(String)
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledTimes(1);
    });

    it("should create watcher and respond with counts", async () => {
      setupChannelPlaylistsMocks();
      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.subscribeChannelPlaylistsWatcher).toHaveBeenCalledWith(
        "https://www.youtube.com/@channel/playlists", 60, "My Channel", "YouTube"
      );
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ subscribedCount: 1, skippedCount: 1, errorCount: 0 })
      );
    });

    it("should fallback channel name from url when uploader is missing", async () => {
      req.body = {
        url: "https://www.youtube.com/@MyChannel",
        interval: 60,
      };
      (executeYtDlpJson as any).mockResolvedValue({
        channel_id: "id-1",
        entries: [{ id: "PL1", title: "P1" }],
      });
      (storageService.getSettings as any).mockReturnValue({
        saveAuthorFilesToCollection: true,
      });
      (subscriptionService.listSubscriptions as any).mockResolvedValue([]);

      await subscribeChannelPlaylists(req as Request, res as Response);

      expect(subscriptionService.subscribePlaylist).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=PL1",
        60,
        "P1",
        "PL1",
        "@MyChannel",
        "YouTube",
        null
      );
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
});
