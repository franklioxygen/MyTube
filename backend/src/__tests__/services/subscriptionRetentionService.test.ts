import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import { runSubscriptionRetentionCleanup } from "../../services/subscriptionRetentionService";
import * as storageService from "../../services/storageService";

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../../db/schema", () => ({
  downloadHistory: {
    id: "id",
    videoId: "videoId",
    finishedAt: "finishedAt",
    status: "status",
    subscriptionId: "subscriptionId",
  },
  subscriptions: {
    id: "id",
    author: "author",
    retentionDays: "retentionDays",
  },
}));

vi.mock("../../services/storageService", () => ({
  deleteVideo: vi.fn(),
  getVideoById: vi.fn(),
  markDownloadHistoryDeletedByVideoId: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const createSelectBuilder = (rows: unknown[] | Promise<unknown[]>) => {
  const builder: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
};

const queueSelectResults = (...results: unknown[][]) => {
  vi.mocked(db.select).mockImplementation(() => {
    const rows = results.shift() || [];
    return createSelectBuilder(rows) as any;
  });
};

const RETENTION_DELETE_REASON = "retention";

describe("subscriptionRetentionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageService.deleteVideo).mockReturnValue(true);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "video-1",
      title: "Old Video",
      sourceUrl: "https://example.com/video",
      createdAt: "2026-01-01",
    });
  });

  it("deletes expired videos owned only by the subscription", async () => {
    queueSelectResults(
      [{ id: "sub-1", author: "Author", retentionDays: 7 }],
      [{ id: "history-1", videoId: "video-1", finishedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }],
      []
    );

    const summary = await runSubscriptionRetentionCleanup();

    expect(storageService.deleteVideo).toHaveBeenCalledWith(
      "video-1",
      RETENTION_DELETE_REASON
    );
    // deleteVideo() updates download_history internally; the cleanup loop
    // must not double-write.
    expect(storageService.markDownloadHistoryDeletedByVideoId).not.toHaveBeenCalled();
    expect(summary.deletedVideos).toBe(1);
  });

  it("skips expired videos referenced by another subscription or manual download", async () => {
    queueSelectResults(
      [{ id: "sub-1", author: "Author", retentionDays: 7 }],
      [{ id: "history-1", videoId: "video-1", finishedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }],
      [{ videoId: "video-1" }]
    );

    const summary = await runSubscriptionRetentionCleanup();

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(summary.skippedSharedVideos).toBe(1);
  });

  it("checks external references once for multiple candidates", async () => {
    queueSelectResults(
      [{ id: "sub-1", author: "Author", retentionDays: 7 }],
      [
        { id: "history-1", videoId: "video-1", finishedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 },
        { id: "history-2", videoId: "video-2", finishedAt: Date.now() - 9 * 24 * 60 * 60 * 1000 },
      ],
      []
    );

    const summary = await runSubscriptionRetentionCleanup();

    expect(db.select).toHaveBeenCalledTimes(3);
    expect(storageService.deleteVideo).toHaveBeenCalledTimes(2);
    expect(summary.deletedVideos).toBe(2);
  });

  it("does not treat skipped history as a shared ownership reference", async () => {
    queueSelectResults(
      [{ id: "sub-1", author: "Author", retentionDays: 7 }],
      [{ id: "history-1", videoId: "video-1", finishedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }],
      []
    );

    const summary = await runSubscriptionRetentionCleanup();

    expect(storageService.deleteVideo).toHaveBeenCalledWith(
      "video-1",
      RETENTION_DELETE_REASON
    );
    expect(summary.deletedVideos).toBe(1);
    expect(summary.skippedSharedVideos).toBe(0);
  });

  it("skips missing video records without failing the cleanup", async () => {
    vi.mocked(storageService.getVideoById).mockReturnValue(undefined);
    queueSelectResults(
      [{ id: "sub-1", author: "Author", retentionDays: 7 }],
      [{ id: "history-1", videoId: "video-1", finishedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }],
      []
    );

    const summary = await runSubscriptionRetentionCleanup();

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(storageService.markDownloadHistoryDeletedByVideoId).toHaveBeenCalledWith(
      "video-1"
    );
    expect(summary.skippedMissingVideos).toBe(1);
  });

  it("does not count deleteVideo false results as deleted", async () => {
    vi.mocked(storageService.deleteVideo).mockReturnValue(false);
    queueSelectResults(
      [{ id: "sub-1", author: "Author", retentionDays: 7 }],
      [{ id: "history-1", videoId: "video-1", finishedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }],
      []
    );

    const summary = await runSubscriptionRetentionCleanup();

    expect(storageService.deleteVideo).toHaveBeenCalledWith(
      "video-1",
      RETENTION_DELETE_REASON
    );
    expect(storageService.markDownloadHistoryDeletedByVideoId).not.toHaveBeenCalled();
    expect(summary.deletedVideos).toBe(0);
  });

  it("passes order and limit to the candidates query", async () => {
    queueSelectResults(
      [{ id: "sub-1", author: "Author", retentionDays: 7 }],
      [{ id: "history-1", videoId: "video-1", finishedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }],
      []
    );

    await runSubscriptionRetentionCleanup();

    // The second db.select call is the candidates query; it must have .limit() applied.
    const candidatesBuilder = vi.mocked(db.select).mock.results[1].value;
    expect(candidatesBuilder.orderBy).toHaveBeenCalled();
    expect(candidatesBuilder.limit).toHaveBeenCalledWith(100);
  });

  it("continues past a full shared batch to delete later owned videos", async () => {
    const oldFinishedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const sharedCandidates = Array.from({ length: 100 }, (_, index) => ({
      id: `history-shared-${index.toString().padStart(3, "0")}`,
      videoId: `shared-video-${index}`,
      finishedAt: oldFinishedAt + index,
    }));

    queueSelectResults(
      [{ id: "sub-1", author: "Author", retentionDays: 7 }],
      sharedCandidates,
      sharedCandidates.map((candidate) => ({ videoId: candidate.videoId })),
      [{ id: "history-owned-1", videoId: "owned-video-1", finishedAt: oldFinishedAt + 101 }],
      []
    );

    const summary = await runSubscriptionRetentionCleanup();

    expect(storageService.deleteVideo).toHaveBeenCalledTimes(1);
    expect(storageService.deleteVideo).toHaveBeenCalledWith(
      "owned-video-1",
      RETENTION_DELETE_REASON
    );
    expect(summary.skippedSharedVideos).toBe(100);
    expect(summary.deletedVideos).toBe(1);
  });

  it("returns early when another cleanup is already running", async () => {
    let releaseFirstSelect: ((rows: unknown[]) => void) | undefined;
    const firstSelect = new Promise<unknown[]>((resolve) => {
      releaseFirstSelect = resolve;
    });
    vi.mocked(db.select).mockReturnValueOnce(createSelectBuilder(firstSelect) as any);

    const firstRun = runSubscriptionRetentionCleanup();
    const secondSummary = await runSubscriptionRetentionCleanup();

    expect(secondSummary).toEqual({
      checkedSubscriptions: 0,
      deletedVideos: 0,
      skippedMissingVideos: 0,
      skippedSharedVideos: 0,
      errors: 0,
    });
    expect(db.select).toHaveBeenCalledTimes(1);

    releaseFirstSelect?.([]);
    await firstRun;
  });
});
