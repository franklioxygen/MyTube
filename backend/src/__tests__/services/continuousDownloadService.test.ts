import { beforeEach, describe, expect, it, vi } from "vitest";
import downloadManager from "../../services/downloadManager";
import { ContinuousDownloadService } from "../../services/continuousDownloadService";
import * as storageService from "../../services/storageService";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../services/storageService", () => ({
  getDownloadStatus: vi.fn(),
}));

vi.mock("../../services/downloadManager", () => ({
  default: {
    cancelDownload: vi.fn(),
  },
}));

vi.mock("../../services/continuousDownload/taskRepository", () => ({
  TaskRepository: vi.fn().mockImplementation(() => ({
    createTask: vi.fn().mockResolvedValue(undefined),
    getAllTasks: vi.fn().mockResolvedValue([]),
    getTaskById: vi.fn().mockResolvedValue(null),
    getTaskByAuthorUrl: vi.fn().mockResolvedValue(null),
    cancelTask: vi.fn().mockResolvedValue(undefined),
    pauseTask: vi.fn().mockResolvedValue(undefined),
    resumeTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    cancelTaskWithError: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../services/continuousDownload/videoUrlFetcher", () => ({
  VideoUrlFetcher: vi.fn().mockImplementation(() => ({
    getAllVideoUrls: vi.fn().mockResolvedValue([]),
    getVideoUrlsIncremental: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("../../services/continuousDownload/taskCleanup", () => ({
  TaskCleanup: vi.fn().mockImplementation(() => ({
    cleanupCurrentVideoTempFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../services/continuousDownload/taskProcessor", () => ({
  TaskProcessor: vi.fn().mockImplementation(() => ({
    processTask: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe("ContinuousDownloadService", () => {
  let service: ContinuousDownloadService;
  let repo: any;
  let fetcher: any;
  let cleanup: any;
  let processor: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (ContinuousDownloadService as any).instance = undefined;
    service = ContinuousDownloadService.getInstance();
    repo = (service as any).taskRepository;
    fetcher = (service as any).videoUrlFetcher;
    cleanup = (service as any).taskCleanup;
    processor = (service as any).taskProcessor;
    vi.mocked(storageService.getDownloadStatus).mockReturnValue({
      activeDownloads: [],
    } as any);
  });

  describe("task creation and queries", () => {
    it("createTask should persist and start background processing", async () => {
      const processSpy = vi
        .spyOn(service as any, "processTask")
        .mockResolvedValue(undefined);

      const task = await service.createTask(
        "https://youtube.com/@author",
        "Author",
        "YouTube",
        "sub-1"
      );

      expect(task.authorUrl).toBe("https://youtube.com/@author");
      expect(task.subscriptionId).toBe("sub-1");
      expect(repo.createTask).toHaveBeenCalledWith(task);
      expect(processSpy).toHaveBeenCalledWith(task.id);
      processSpy.mockRestore();
    });

    it("createPlaylistTask should keep collection id and start processing", async () => {
      const processSpy = vi
        .spyOn(service as any, "processTask")
        .mockResolvedValue(undefined);

      const task = await service.createPlaylistTask(
        "https://youtube.com/playlist?list=PL1",
        "Author",
        "YouTube",
        "col-1"
      );

      expect(task.collectionId).toBe("col-1");
      expect(repo.createTask).toHaveBeenCalledWith(task);
      expect(processSpy).toHaveBeenCalledWith(task.id);
      processSpy.mockRestore();
    });

    it("getters should delegate to repository", async () => {
      repo.getAllTasks.mockResolvedValue([{ id: "a" }]);
      repo.getTaskById.mockResolvedValue({ id: "b" });
      repo.getTaskByAuthorUrl.mockResolvedValue({ id: "c" });

      await expect(service.getAllTasks()).resolves.toEqual([{ id: "a" }]);
      await expect(service.getTaskById("b")).resolves.toEqual({ id: "b" });
      await expect(service.getTaskByAuthorUrl("u")).resolves.toEqual({ id: "c" });
    });
  });

  describe("task state operations", () => {
    it("cancelTask should throw when task is missing", async () => {
      repo.getTaskById.mockResolvedValue(null);
      await expect(service.cancelTask("missing")).rejects.toThrow(
        "Task missing not found"
      );
    });

    it("cancelTask should no-op for completed/cancelled tasks", async () => {
      repo.getTaskById.mockResolvedValue({ id: "t1", status: "completed" });
      await service.cancelTask("t1");
      expect(repo.cancelTask).not.toHaveBeenCalled();

      repo.getTaskById.mockResolvedValue({ id: "t2", status: "cancelled" });
      await service.cancelTask("t2");
      expect(repo.cancelTask).not.toHaveBeenCalled();
    });

    it("cancelTask should cancel matching active downloads and cleanup files", async () => {
      const task = {
        id: "task-1",
        status: "active",
        authorUrl: "https://youtube.com/@author",
        platform: "YouTube",
      };
      repo.getTaskById.mockResolvedValue(task);
      (service as any).videoUrlCache.set(
        "task-1:https://youtube.com/@author",
        ["https://youtube.com/watch?v=match"]
      );
      vi.mocked(storageService.getDownloadStatus).mockReturnValue({
        activeDownloads: [
          { id: "dl-1", sourceUrl: "https://youtube.com/watch?v=match" },
          { id: "dl-2", sourceUrl: "https://youtube.com/watch?v=other" },
        ],
      } as any);

      await service.cancelTask("task-1");

      expect(repo.cancelTask).toHaveBeenCalledWith("task-1");
      expect(downloadManager.cancelDownload).toHaveBeenCalledWith("dl-1");
      expect(cleanup.cleanupCurrentVideoTempFiles).toHaveBeenCalledWith(task);
      expect(
        (service as any).videoUrlCache.has("task-1:https://youtube.com/@author")
      ).toBe(false);
    });

    it("cancelTask should continue when download cancellation lookup fails", async () => {
      const task = {
        id: "task-2",
        status: "active",
        authorUrl: "https://youtube.com/@author",
        platform: "YouTube",
      };
      repo.getTaskById.mockResolvedValue(task);
      vi.mocked(storageService.getDownloadStatus).mockImplementation(() => {
        throw new Error("status lookup failed");
      });
      cleanup.cleanupCurrentVideoTempFiles.mockRejectedValue(
        new Error("cleanup failed")
      );

      await service.cancelTask("task-2");

      expect(repo.cancelTask).toHaveBeenCalledWith("task-2");
    });

    it("pauseTask and resumeTask should validate status and delegate", async () => {
      repo.getTaskById.mockResolvedValueOnce(null);
      await expect(service.pauseTask("x")).rejects.toThrow("Task x not found");

      repo.getTaskById.mockResolvedValueOnce({ id: "x", status: "paused" });
      await expect(service.pauseTask("x")).rejects.toThrow(
        "Task x is not active (status: paused)"
      );

      repo.getTaskById.mockResolvedValueOnce({ id: "x", status: "active" });
      await service.pauseTask("x");
      expect(repo.pauseTask).toHaveBeenCalledWith("x");

      repo.getTaskById.mockResolvedValueOnce(null);
      await expect(service.resumeTask("x")).rejects.toThrow("Task x not found");

      repo.getTaskById.mockResolvedValueOnce({ id: "x", status: "active" });
      await expect(service.resumeTask("x")).rejects.toThrow(
        "Task x is not paused (status: active)"
      );

      const processSpy = vi
        .spyOn(service as any, "processTask")
        .mockResolvedValue(undefined);
      repo.getTaskById.mockResolvedValueOnce({ id: "x", status: "paused" });
      await service.resumeTask("x");
      expect(repo.resumeTask).toHaveBeenCalledWith("x");
      expect(processSpy).toHaveBeenCalledWith("x");
      processSpy.mockRestore();
    });

    it("deleteTask and clearFinishedTasks should remove only finished items", async () => {
      repo.getTaskById.mockResolvedValueOnce(null);
      await expect(service.deleteTask("x")).rejects.toThrow("Task x not found");

      const task = { id: "d1", authorUrl: "https://youtube.com/@author" };
      repo.getTaskById.mockResolvedValue(task);
      (service as any).videoUrlCache.set("d1:https://youtube.com/@author", ["a"]);
      await service.deleteTask("d1");
      expect(repo.deleteTask).toHaveBeenCalledWith("d1");
      expect((service as any).videoUrlCache.size).toBe(0);

      repo.getAllTasks.mockResolvedValue([
        { id: "f1", status: "completed" },
        { id: "f2", status: "cancelled" },
        { id: "a1", status: "active" },
      ]);
      const deleteSpy = vi
        .spyOn(service, "deleteTask")
        .mockRejectedValueOnce(new Error("delete failed"))
        .mockResolvedValue(undefined);

      await service.clearFinishedTasks();
      expect(deleteSpy).toHaveBeenCalledTimes(2);
      deleteSpy.mockRestore();
    });
  });

  describe("private processTask flow", () => {
    it("should skip when task is already processing", async () => {
      (service as any).processingTasks.add("dup");
      await (service as any).processTask("dup");
      expect(repo.getTaskById).not.toHaveBeenCalled();
    });

    it("should exit when task is missing or inactive", async () => {
      repo.getTaskById.mockResolvedValueOnce(null);
      await (service as any).processTask("missing");

      repo.getTaskById.mockResolvedValueOnce({ id: "paused", status: "paused" });
      await (service as any).processTask("paused");

      expect(processor.processTask).not.toHaveBeenCalled();
    });

    it("should cache and process non-playlist tasks, then clear cache", async () => {
      const task = {
        id: "np",
        authorUrl: "https://youtube.com/@channel",
        platform: "YouTube",
        status: "active",
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task);
      fetcher.getAllVideoUrls.mockResolvedValue(["u1", "u2"]);

      await (service as any).processTask("np");

      expect(fetcher.getAllVideoUrls).toHaveBeenCalledWith(
        "https://youtube.com/@channel",
        "YouTube"
      );
      expect(processor.processTask).toHaveBeenCalledWith(task, ["u1", "u2"]);
      expect((service as any).videoUrlCache.size).toBe(0);
    });

    it("should process YouTube playlists incrementally without prefetch cache", async () => {
      const task = {
        id: "pl",
        authorUrl: "https://youtube.com/playlist?list=PLX",
        platform: "YouTube",
        status: "active",
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task);

      await (service as any).processTask("pl");

      expect(fetcher.getAllVideoUrls).not.toHaveBeenCalled();
      expect(processor.processTask).toHaveBeenCalledWith(task, undefined);
    });

    it("should cancel task with error when processing fails", async () => {
      const task = {
        id: "err",
        authorUrl: "https://youtube.com/@err",
        platform: "YouTube",
        status: "active",
      };
      repo.getTaskById.mockResolvedValue(task);
      fetcher.getAllVideoUrls.mockRejectedValue(new Error("fetch failed"));

      await (service as any).processTask("err");

      expect(repo.cancelTaskWithError).toHaveBeenCalledWith("err", "fetch failed");
      expect((service as any).processingTasks.has("err")).toBe(false);
      expect((service as any).videoUrlCache.size).toBe(0);
    });
  });
});
