import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";
import downloadManager from "../../services/downloadManager";
import { ContinuousDownloadService } from "../../services/continuousDownloadService";
import * as storageService from "../../services/storageService";
import * as security from "../../utils/security";

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
  TaskRepository: vi.fn().mockImplementation(function () {
    return {
      createTask: vi.fn().mockResolvedValue(undefined),
      getAllTasks: vi.fn().mockResolvedValue([]),
      getTaskById: vi.fn().mockResolvedValue(null),
      getTaskByAuthorUrl: vi.fn().mockResolvedValue(null),
      getBlockingPlaylistTaskByDestination: vi.fn().mockResolvedValue(null),
      cancelTask: vi.fn().mockResolvedValue(undefined),
      pauseTask: vi.fn().mockResolvedValue(undefined),
      resumeTask: vi.fn().mockResolvedValue(undefined),
      deleteTask: vi.fn().mockResolvedValue(undefined),
      cancelTaskWithError: vi.fn().mockResolvedValue(undefined),
      activateTaskForPlanningRetry: vi.fn().mockResolvedValue(undefined),
      updateTotalVideos: vi.fn().mockResolvedValue(undefined),
      updateFrozenVideoListPath: vi.fn().mockResolvedValue(undefined),
      clearFrozenVideoListPath: vi.fn().mockResolvedValue(undefined),
      getSubscriptionForTask: vi.fn().mockResolvedValue(null),
    };
  }),
}));

vi.mock("../../services/continuousDownload/videoUrlFetcher", () => ({
  OrderingMetadataUnavailableError: class OrderingMetadataUnavailableError extends Error {},
  SourceEnumerationFailedError: class SourceEnumerationFailedError extends Error {
    constructor(
      public platform: string,
      public page: number,
      public enumeratedCount: number,
      public cause: unknown
    ) {
      super("enumeration failed");
    }
  },
  VideoUrlFetcher: vi.fn().mockImplementation(function () {
    return {
      getAllVideoUrls: vi.fn().mockResolvedValue([]),
      getAllVideoEntries: vi.fn().mockResolvedValue([]),
      getVideoUrlsIncremental: vi.fn().mockResolvedValue([]),
    };
  }),
  sortVideoEntries: vi.fn((entries: unknown[]) => entries),
}));

vi.mock("../../services/continuousDownload/taskCleanup", () => ({
  TaskCleanup: vi.fn().mockImplementation(function () {
    return {
      cleanupCurrentVideoTempFiles: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("../../services/continuousDownload/taskProcessor", () => ({
  TaskProcessor: vi.fn().mockImplementation(function () {
    return {
      processTask: vi.fn().mockResolvedValue(undefined),
      signalInterruption: vi.fn(),
      clearInterruption: vi.fn(),
      isTaskInterrupted: vi.fn(() => false),
    };
  }),
}));

describe("ContinuousDownloadService", () => {
  let service: ContinuousDownloadService;
  let repo: any;
  let fetcher: any;
  let cleanup: any;
  let processor: any;
  let frozenListsRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    (ContinuousDownloadService as any).instance = undefined;
    service = ContinuousDownloadService.getInstance();
    repo = (service as any).taskRepository;
    fetcher = (service as any).videoUrlFetcher;
    cleanup = (service as any).taskCleanup;
    processor = (service as any).taskProcessor;
    frozenListsRoot = path.resolve(path.join(process.cwd(), "data", "frozen-lists"));
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

    it("createPlaylistTask should persist an explicit subscription owner", async () => {
      const processSpy = vi
        .spyOn(service as any, "processTask")
        .mockResolvedValue(undefined);

      const task = await service.createPlaylistTask(
        "https://youtube.com/playlist?list=PL1",
        "Author",
        "YouTube",
        "col-1",
        "sub-1"
      );

      expect(task.subscriptionId).toBe("sub-1");
      expect(repo.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: "sub-1" })
      );
      processSpy.mockRestore();
    });

    it("getters should delegate to repository", async () => {
      repo.getAllTasks.mockResolvedValue([{ id: "a" }]);
      repo.getTaskById.mockResolvedValue({ id: "b" });
      repo.getTaskByAuthorUrl.mockResolvedValue({ id: "c" });
      repo.getBlockingPlaylistTaskByDestination.mockResolvedValue({ id: "d" });

      await expect(service.getAllTasks()).resolves.toEqual([{ id: "a" }]);
      await expect(service.getTaskById("b")).resolves.toEqual({ id: "b" });
      await expect(service.getTaskByAuthorUrl("u")).resolves.toEqual({ id: "c" });
      await expect(
        service.getBlockingPlaylistTaskByDestination("u", "sub", "col")
      ).resolves.toEqual({ id: "d" });
    });

    it("getAllTasks should attach partial ordering warnings from V2 frozen plans", async () => {
      const frozenListPath = path.join(frozenListsRoot, "warned.json");
      repo.getAllTasks.mockResolvedValue([
        {
          id: "warned",
          authorUrl: "https://youtube.com/@warned",
          platform: "YouTube",
          downloadOrder: "dateAsc",
          frozenVideoListPath: frozenListPath,
        },
      ]);
      const readSpy = vi
        .spyOn(security, "readFileSafeSync")
        .mockReturnValue(JSON.stringify({
          version: 2,
          taskId: "warned",
          sourceUrl: "https://youtube.com/@warned",
          platform: "YouTube",
          downloadOrder: "dateAsc",
          createdAt: new Date(0).toISOString(),
          entries: [
            { url: "u1", sourceVideoId: "u1", publishedAtMs: 1, publishedDatePrecision: "second", viewCount: null, sourceIndex: 0 },
            { url: "u2", sourceVideoId: "u2", publishedAtMs: null, publishedDatePrecision: "unknown", viewCount: null, sourceIndex: 1 },
          ],
          metadataStats: {
            entryCount: 2,
            knownDates: 1,
            unknownDates: 1,
            knownViewCounts: 0,
            unknownViewCounts: 2,
          },
          warnings: [
            "1 of 2 videos lacked publication dates and were placed after videos with known metadata.",
          ],
        }));

      await expect(service.getAllTasks()).resolves.toEqual([
        expect.objectContaining({
          orderingWarnings: [
            {
              code: "ORDERING_METADATA_PARTIAL",
              message:
                "1 of 2 videos lacked publication dates and were placed after videos with known metadata.",
              knownCount: 1,
              unknownCount: 1,
            },
          ],
        }),
      ]);
      expect(readSpy).toHaveBeenCalledWith(
        frozenListPath,
        frozenListsRoot,
        "utf8"
      );

      readSpy.mockRestore();
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
      // Resume must drop any stale pause/cancel signal so the (possibly still
      // draining) loop doesn't kill the resumed task.
      expect(processor.clearInterruption).toHaveBeenCalledWith("x");
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

    it("retryPlanning should reactivate a cancelled task with a retryable ordering error", async () => {
      const planningError = JSON.stringify({
        kind: "ordering_planning_failure",
        version: 1,
        code: "ORDERING_METADATA_UNAVAILABLE",
        message: "Unable to prepare requested order.",
        retryable: true,
        platform: "YouTube",
        downloadOrder: "dateDesc",
        entryCount: 1,
        knownCount: 0,
        unknownCount: 1,
        suggestedAction: "check_cookies_or_proxy",
      });
      const cancelledTask = {
        id: "retry-plan",
        status: "cancelled",
        error: planningError,
        downloadedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        currentVideoIndex: 0,
      };
      const retriedTask = {
        ...cancelledTask,
        status: "active",
        error: null,
      };
      repo.getTaskById
        .mockResolvedValueOnce(cancelledTask)
        .mockResolvedValueOnce(retriedTask);
      const processSpy = vi
        .spyOn(service as any, "processTask")
        .mockResolvedValue(undefined);

      const result = await service.retryPlanning("retry-plan");

      expect(repo.activateTaskForPlanningRetry).toHaveBeenCalledWith(
        "retry-plan"
      );
      expect(processor.clearInterruption).toHaveBeenCalledWith("retry-plan");
      expect(processSpy).toHaveBeenCalledWith("retry-plan");
      expect(result).toBe(retriedTask);
      processSpy.mockRestore();
    });

    it("retryPlanning should refuse while the failed worker is still draining", async () => {
      // The worker clears processingTasks in its finally, after the cancelled
      // state the client reacts to is already visible. Reporting success here
      // would activate nothing and leave the task cancelled forever.
      const planningError = JSON.stringify({
        kind: "ordering_planning_failure",
        version: 1,
        code: "SOURCE_ENUMERATION_FAILED",
        message: "Could not finish listing this source.",
        retryable: true,
        platform: "YouTube",
        downloadOrder: "dateDesc",
        entryCount: 0,
        knownCount: 0,
        unknownCount: 0,
        suggestedAction: "check_cookies_or_proxy",
      });
      const cancelledTask = {
        id: "retry-plan-busy",
        status: "cancelled",
        error: planningError,
        downloadedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        currentVideoIndex: 0,
      };
      repo.getTaskById.mockResolvedValue(cancelledTask);
      (service as any).processingTasks.add("retry-plan-busy");
      const processSpy = vi
        .spyOn(service as any, "processTask")
        .mockResolvedValue(undefined);

      await expect(
        (service as any).retryPlanning("retry-plan-busy", 30, 5)
      ).rejects.toThrow(/still finishing/i);

      expect(repo.activateTaskForPlanningRetry).not.toHaveBeenCalled();
      expect(processSpy).not.toHaveBeenCalled();
      (service as any).processingTasks.delete("retry-plan-busy");
      processSpy.mockRestore();
    });

    it("retryPlanning should proceed once the worker drains", async () => {
      const planningError = JSON.stringify({
        kind: "ordering_planning_failure",
        version: 1,
        code: "SOURCE_ENUMERATION_FAILED",
        message: "Could not finish listing this source.",
        retryable: true,
        platform: "YouTube",
        downloadOrder: "dateDesc",
        entryCount: 0,
        knownCount: 0,
        unknownCount: 0,
        suggestedAction: "check_cookies_or_proxy",
      });
      const cancelledTask = {
        id: "retry-plan-drains",
        status: "cancelled",
        error: planningError,
        downloadedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        currentVideoIndex: 0,
      };
      repo.getTaskById.mockResolvedValue(cancelledTask);
      (service as any).processingTasks.add("retry-plan-drains");
      setTimeout(
        () => (service as any).processingTasks.delete("retry-plan-drains"),
        20
      );
      const processSpy = vi
        .spyOn(service as any, "processTask")
        .mockResolvedValue(undefined);

      await (service as any).retryPlanning("retry-plan-drains", 2000, 5);

      expect(repo.activateTaskForPlanningRetry).toHaveBeenCalledWith(
        "retry-plan-drains"
      );
      expect(processSpy).toHaveBeenCalledWith("retry-plan-drains");
      processSpy.mockRestore();
    });

    it("retryPlanning should reject once task progress exists", async () => {
      repo.getTaskById.mockResolvedValue({
        id: "retry-plan-progress",
        status: "cancelled",
        error: JSON.stringify({
          kind: "ordering_planning_failure",
          version: 1,
          code: "ORDERING_METADATA_UNAVAILABLE",
          message: "Unable to prepare requested order.",
          retryable: true,
          suggestedAction: "check_cookies_or_proxy",
        }),
        downloadedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        currentVideoIndex: 1,
      });

      await expect(service.retryPlanning("retry-plan-progress")).rejects.toThrow(
        "Order preparation can only be retried before any task progress exists."
      );
      expect(repo.activateTaskForPlanningRetry).not.toHaveBeenCalled();
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

    it("should prefetch, sort and process non-playlist tasks", async () => {
      const task = {
        id: "np",
        authorUrl: "https://youtube.com/@channel",
        platform: "YouTube",
        status: "active",
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task);
      fetcher.getAllVideoEntries.mockResolvedValue([
        { url: "u1", sourceVideoId: "u1", publishedAtMs: Date.UTC(2024, 0, 1), publishedDatePrecision: "day", viewCount: 1, sourceIndex: 0 },
        { url: "u2", sourceVideoId: "u2", publishedAtMs: Date.UTC(2024, 0, 2), publishedDatePrecision: "day", viewCount: 2, sourceIndex: 1 },
      ]);

      await (service as any).processTask("np");

      expect(fetcher.getAllVideoEntries).toHaveBeenCalledWith(
        "https://youtube.com/@channel",
        "YouTube",
        null,
        "dateDesc"
      );
      expect(processor.processTask).toHaveBeenCalledWith(task, ["u1", "u2"]);
      expect((service as any).videoUrlCache.size).toBe(0);
    });

    it("should process YouTube channel-uploads playlists incrementally without prefetch cache", async () => {
      const task = {
        id: "pl",
        // `UU...` is the auto-generated uploads playlist (newest-first), so the
        // dateDesc incremental fast path is safe here.
        authorUrl: "https://youtube.com/playlist?list=UUabcdef",
        platform: "YouTube",
        status: "active",
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task);

      await (service as any).processTask("pl");

      expect(fetcher.getAllVideoUrls).not.toHaveBeenCalled();
      expect(fetcher.getAllVideoEntries).not.toHaveBeenCalled();
      expect(processor.processTask).toHaveBeenCalledWith(task, undefined);
    });

    it("should route manually-ordered YouTube playlists through the sorted frozen-plan path", async () => {
      // A `PL...` playlist can be in any order, so a dateDesc request must not
      // take the incremental fast path (which would hand playlist order straight
      // to the processor); it has to fetch, sort, and freeze instead. The sort
      // itself is a stubbed identity here — sortVideoEntries has its own tests —
      // so this asserts the branch, not the ordering math.
      const task = {
        id: "manual-pl",
        authorUrl: "https://youtube.com/playlist?list=PLX",
        platform: "YouTube",
        status: "active",
        downloadOrder: "dateDesc",
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task);
      fetcher.getAllVideoEntries.mockResolvedValue([
        { url: "u1", sourceVideoId: "u1", publishedAtMs: Date.UTC(2024, 0, 1), publishedDatePrecision: "day", viewCount: 1, sourceIndex: 0 },
        { url: "u2", sourceVideoId: "u2", publishedAtMs: Date.UTC(2024, 0, 2), publishedDatePrecision: "day", viewCount: 2, sourceIndex: 1 },
      ]);

      const ensureDirSpy = vi
        .spyOn(security, "ensureDirSafeSync")
        .mockImplementation(() => undefined);
      const writeSpy = vi
        .spyOn(security, "writeFileSafeSync")
        .mockImplementation(() => undefined);

      await (service as any).processTask("manual-pl");

      // Full-fetch path taken: entries are enumerated and frozen, and the
      // processor receives the resolved URL list rather than `undefined`.
      expect(fetcher.getAllVideoEntries).toHaveBeenCalledWith(
        "https://youtube.com/playlist?list=PLX",
        "YouTube",
        null,
        "dateDesc"
      );
      expect(writeSpy).toHaveBeenCalled();
      expect(processor.processTask).toHaveBeenCalledWith(task, ["u1", "u2"]);

      ensureDirSpy.mockRestore();
      writeSpy.mockRestore();
    });

    it("should keep an in-flight legacy incremental playlist on the incremental path", async () => {
      // A non-uploads playlist that already has numeric progress and no frozen
      // plan was created before the ordering change and has been downloading in
      // raw playlist order. Re-sorting it now would desync TaskProcessor's saved
      // index, so it must stay on the incremental path until it completes.
      const task = {
        id: "legacy-pl",
        authorUrl: "https://youtube.com/playlist?list=PLX",
        platform: "YouTube",
        status: "active",
        downloadOrder: "dateDesc",
        currentVideoIndex: 3,
        frozenVideoListPath: null,
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task);

      await (service as any).processTask("legacy-pl");

      expect(fetcher.getAllVideoEntries).not.toHaveBeenCalled();
      expect(processor.processTask).toHaveBeenCalledWith(task, undefined);
    });

    it("should route a fresh manually-ordered playlist through the sorted path even with saved progress once frozen", async () => {
      // Once a manual playlist has a frozen plan, progress is an index into the
      // sorted order, so it must not fall back to the incremental path.
      const task = {
        id: "frozen-pl",
        authorUrl: "https://youtube.com/playlist?list=PLX",
        platform: "YouTube",
        status: "active",
        downloadOrder: "dateDesc",
        currentVideoIndex: 3,
        frozenVideoListPath: path.join(frozenListsRoot, "frozen-pl.json"),
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task);
      const readFrozenSpy = vi
        .spyOn(service as any, "readFrozenPlanUrls")
        .mockReturnValue(["a", "b"]);

      await (service as any).processTask("frozen-pl");

      expect(fetcher.getAllVideoEntries).not.toHaveBeenCalled();
      expect(readFrozenSpy).toHaveBeenCalled();
      expect(processor.processTask).toHaveBeenCalledWith(task, ["a", "b"]);

      readFrozenSpy.mockRestore();
    });

    it("should create and persist frozen list for full-fetch tasks", async () => {
      const task = {
        id: "freeze-create",
        authorUrl: "https://youtube.com/@freeze",
        platform: "YouTube",
        status: "active",
        downloadOrder: "viewsDesc",
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task);
      fetcher.getAllVideoEntries.mockResolvedValue([
        { url: "u1", sourceVideoId: "u1", publishedAtMs: Date.UTC(2024, 0, 1), publishedDatePrecision: "day", viewCount: 1, sourceIndex: 0 },
        { url: "u2", sourceVideoId: "u2", publishedAtMs: Date.UTC(2024, 0, 2), publishedDatePrecision: "day", viewCount: 2, sourceIndex: 1 },
      ]);

      const ensureDirSpy = vi
        .spyOn(security, "ensureDirSafeSync")
        .mockImplementation(() => undefined);
      const writeSpy = vi
        .spyOn(security, "writeFileSafeSync")
        .mockImplementation(() => undefined);

      await (service as any).processTask("freeze-create");

      expect(fetcher.getAllVideoEntries).toHaveBeenCalledWith(
        "https://youtube.com/@freeze",
        "YouTube",
        null,
        "viewsDesc"
      );
      expect(ensureDirSpy).toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalled();
      const writtenPlan = JSON.parse(String(writeSpy.mock.calls[0][2]));
      expect(writtenPlan).toMatchObject({
        version: 2,
        taskId: "freeze-create",
        sourceUrl: "https://youtube.com/@freeze",
        platform: "YouTube",
        downloadOrder: "viewsDesc",
      });
      expect(writtenPlan.entries.map((entry: { url: string }) => entry.url)).toEqual([
        "u1",
        "u2",
      ]);
      expect(repo.updateFrozenVideoListPath).toHaveBeenCalledWith(
        "freeze-create",
        expect.stringContaining("freeze-create.json")
      );
      expect(repo.updateTotalVideos).toHaveBeenCalledWith("freeze-create", 2);
      expect(processor.processTask).toHaveBeenCalledWith(task, ["u1", "u2"]);

      ensureDirSpy.mockRestore();
      writeSpy.mockRestore();
    });

    it("should cancel with a structured planning error when frozen plan persistence fails", async () => {
      const task = {
        id: "freeze-write-fails",
        authorUrl: "https://youtube.com/@freeze-write-fails",
        platform: "YouTube",
        status: "active",
        downloadOrder: "dateAsc",
      };
      repo.getTaskById.mockResolvedValue(task);
      fetcher.getAllVideoEntries.mockResolvedValue([
        { url: "u1", sourceVideoId: "u1", publishedAtMs: Date.UTC(2024, 0, 1), publishedDatePrecision: "day", viewCount: 1, sourceIndex: 0 },
      ]);

      const ensureDirSpy = vi
        .spyOn(security, "ensureDirSafeSync")
        .mockImplementation(() => undefined);
      const writeSpy = vi
        .spyOn(security, "writeFileSafeSync")
        .mockImplementation(() => {
          throw new Error("disk full");
        });

      await (service as any).processTask("freeze-write-fails");

      expect(processor.processTask).not.toHaveBeenCalled();
      expect(repo.cancelTaskWithError).toHaveBeenCalledWith(
        "freeze-write-fails",
        expect.stringContaining("ORDERING_PLAN_PERSIST_FAILED")
      );
      const serialized = repo.cancelTaskWithError.mock.calls[0][1];
      const parsed = JSON.parse(serialized);
      expect(parsed).toMatchObject({
        kind: "ordering_planning_failure",
        code: "ORDERING_PLAN_PERSIST_FAILED",
        retryable: true,
        platform: "YouTube",
        downloadOrder: "dateAsc",
        suggestedAction: "check_storage",
      });

      ensureDirSpy.mockRestore();
      writeSpy.mockRestore();
    });

    it("should load existing frozen list on resume and skip metadata fetch", async () => {
      const frozenListPath = path.join(frozenListsRoot, "freeze-resume.json");
      const task = {
        id: "freeze-resume",
        authorUrl: "https://youtube.com/@resume",
        platform: "YouTube",
        status: "active",
        frozenVideoListPath: frozenListPath,
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task);

      const readSpy = vi
        .spyOn(security, "readFileSafeSync")
        .mockReturnValue(JSON.stringify(["r1", "r2"]));

      await (service as any).processTask("freeze-resume");

      expect(readSpy).toHaveBeenCalledWith(
        frozenListPath,
        frozenListsRoot,
        "utf8"
      );
      expect(fetcher.getAllVideoEntries).not.toHaveBeenCalled();
      expect(processor.processTask).toHaveBeenCalledWith(task, ["r1", "r2"]);

      readSpy.mockRestore();
    });

    it("should rebuild an invalid frozen plan before any progress is recorded", async () => {
      const frozenListPath = path.join(frozenListsRoot, "freeze-rebuild.json");
      const task = {
        id: "freeze-rebuild",
        authorUrl: "https://youtube.com/@rebuild",
        platform: "YouTube",
        status: "active",
        downloadOrder: "viewsDesc",
        currentVideoIndex: 0,
        frozenVideoListPath: frozenListPath,
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task);
      fetcher.getAllVideoEntries.mockResolvedValue([
        { url: "r1", sourceVideoId: "r1", publishedAtMs: Date.UTC(2024, 0, 1), publishedDatePrecision: "day", viewCount: 1, sourceIndex: 0 },
      ]);

      const readSpy = vi
        .spyOn(security, "readFileSafeSync")
        .mockImplementation(() => {
          throw new Error("invalid json");
        });
      const ensureDirSpy = vi
        .spyOn(security, "ensureDirSafeSync")
        .mockImplementation(() => undefined);
      const writeSpy = vi
        .spyOn(security, "writeFileSafeSync")
        .mockImplementation(() => undefined);

      await (service as any).processTask("freeze-rebuild");

      expect(fetcher.getAllVideoEntries).toHaveBeenCalledWith(
        "https://youtube.com/@rebuild",
        "YouTube",
        null,
        "viewsDesc"
      );
      expect(repo.cancelTaskWithError).not.toHaveBeenCalled();
      expect(processor.processTask).toHaveBeenCalledWith(task, ["r1"]);

      readSpy.mockRestore();
      ensureDirSpy.mockRestore();
      writeSpy.mockRestore();
    });

    it("should cancel progressed tasks when their frozen plan is invalid", async () => {
      const frozenListPath = path.join(frozenListsRoot, "freeze-invalid.json");
      const task = {
        id: "freeze-invalid",
        authorUrl: "https://youtube.com/@invalid",
        platform: "YouTube",
        status: "active",
        downloadOrder: "viewsDesc",
        currentVideoIndex: 1,
        totalVideos: 3,
        frozenVideoListPath: frozenListPath,
      };
      repo.getTaskById.mockResolvedValue(task);

      const readSpy = vi
        .spyOn(security, "readFileSafeSync")
        .mockImplementation(() => {
          throw new Error("invalid json");
        });
      const unlinkSpy = vi
        .spyOn(security, "unlinkSafeSync")
        .mockImplementation(() => undefined);

      await (service as any).processTask("freeze-invalid");

      expect(fetcher.getAllVideoEntries).not.toHaveBeenCalled();
      expect(processor.processTask).not.toHaveBeenCalled();
      expect(repo.cancelTaskWithError).toHaveBeenCalledWith(
        "freeze-invalid",
        expect.stringContaining("ORDERING_PLAN_INVALID")
      );
      const serialized = repo.cancelTaskWithError.mock.calls[0][1];
      const parsed = JSON.parse(serialized);
      expect(parsed).toMatchObject({
        kind: "ordering_planning_failure",
        code: "ORDERING_PLAN_INVALID",
        retryable: false,
        platform: "YouTube",
        downloadOrder: "viewsDesc",
      });

      readSpy.mockRestore();
      unlinkSpy.mockRestore();
    });

    it("should delete frozen list and clear DB path when task reaches completed", async () => {
      const frozenListPath = path.join(frozenListsRoot, "freeze-done.json");
      const task = {
        id: "freeze-done",
        authorUrl: "https://youtube.com/@done",
        platform: "YouTube",
        status: "active",
      };
      const finalTask = {
        ...task,
        status: "completed",
        frozenVideoListPath: frozenListPath,
      };
      repo.getTaskById
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(finalTask);
      fetcher.getAllVideoEntries.mockResolvedValue([
        { url: "d1", sourceVideoId: "d1", publishedAtMs: Date.UTC(2024, 0, 1), publishedDatePrecision: "day", viewCount: 1, sourceIndex: 0 },
      ]);

      const ensureDirSpy = vi
        .spyOn(security, "ensureDirSafeSync")
        .mockImplementation(() => undefined);
      const writeSpy = vi
        .spyOn(security, "writeFileSafeSync")
        .mockImplementation(() => undefined);
      const unlinkSpy = vi
        .spyOn(security, "unlinkSafeSync")
        .mockImplementation(() => undefined);

      await (service as any).processTask("freeze-done");

      expect(unlinkSpy).toHaveBeenCalledWith(frozenListPath, frozenListsRoot);
      expect(repo.clearFrozenVideoListPath).toHaveBeenCalledWith("freeze-done");

      ensureDirSpy.mockRestore();
      writeSpy.mockRestore();
      unlinkSpy.mockRestore();
    });

    it("should cancel task with error when processing fails", async () => {
      const task = {
        id: "err",
        authorUrl: "https://youtube.com/@err",
        platform: "YouTube",
        status: "active",
      };
      repo.getTaskById.mockResolvedValue(task);
      fetcher.getAllVideoEntries.mockRejectedValue(new Error("fetch failed"));

      await (service as any).processTask("err");

      expect(repo.cancelTaskWithError).toHaveBeenCalledWith("err", "fetch failed");
      expect((service as any).processingTasks.has("err")).toBe(false);
      expect((service as any).videoUrlCache.size).toBe(0);
    });
  });
});
