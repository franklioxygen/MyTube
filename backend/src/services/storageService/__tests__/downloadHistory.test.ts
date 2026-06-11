/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...parts) => ({ parts })),
  asc: vi.fn((value) => ({ ascBy: value })),
  desc: vi.fn((value) => ({ descBy: value })),
  eq: vi.fn((left, right) => ({ left, right })),
  ne: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("../../../db/schema", () => ({
  downloadHistory: {
    id: "id",
    finishedAt: "finishedAt",
    status: "status",
    nextRetryAt: "nextRetryAt",
    sourceUrl: "sourceUrl",
    downloadType: "downloadType",
  },
}));

vi.mock("../../../db", () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { db } from "../../../db";
import { DatabaseError } from "../../../errors/DownloadErrors";
import { logger } from "../../../utils/logger";
import {
  addDownloadHistoryItem,
  clearDownloadHistory,
  finalizePendingRetryHistoryItem,
  getDownloadHistory,
  getDownloadHistoryItem,
  getLatestRetryHistoryItemBySourceUrl,
  getPendingRetryHistoryItems,
  removeDownloadHistoryItem,
} from "../downloadHistory";

describe("downloadHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds history item successfully", () => {
    const run = vi.fn();
    const onConflictDoUpdate = vi.fn(() => ({ run }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    vi.mocked(db.insert).mockReturnValue({ values } as any);

    addDownloadHistoryItem({
      id: "h1",
      title: "Video",
      status: "success",
      finishedAt: "2026-02-11T00:00:00.000Z",
    } as any);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "h1",
        title: "Video",
        status: "success",
      })
    );
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("swallows add history errors and logs", () => {
    vi.mocked(db.insert).mockImplementation(() => {
      throw new Error("insert failed");
    });

    expect(() =>
      addDownloadHistoryItem({
        id: "h2",
        title: "Broken",
        status: "failed",
        finishedAt: "2026-02-11T00:00:00.000Z",
      } as any)
    ).not.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      "Error adding download history item",
      expect.any(Error)
    );
  });

  it("returns normalized history items", () => {
    const all = vi.fn().mockReturnValue([
      {
        id: "h1",
        title: "Done",
        status: "success",
        finishedAt: "2026-02-11T00:00:00.000Z",
        author: null,
        sourceUrl: null,
        error: null,
        videoPath: null,
        thumbnailPath: null,
        totalSize: null,
        videoId: null,
        downloadedAt: null,
        deletedAt: null,
        subscriptionId: null,
        taskId: null,
        platform: null,
        sourceKind: null,
        downloadType: null,
        retryCount: null,
        retryLimit: null,
        retryIntervalMinutes: null,
        nextRetryAt: null,
      },
    ]);
    const orderBy = vi.fn(() => ({ all }));
    const from = vi.fn(() => ({ orderBy }));
    vi.mocked(db.select).mockReturnValue({ from } as any);

    const result = getDownloadHistory();

    expect(result).toEqual([
      {
        id: "h1",
        title: "Done",
        status: "success",
        finishedAt: "2026-02-11T00:00:00.000Z",
        author: undefined,
        sourceUrl: undefined,
        error: undefined,
        videoPath: undefined,
        thumbnailPath: undefined,
        totalSize: undefined,
        videoId: undefined,
        downloadedAt: undefined,
        deletedAt: undefined,
        subscriptionId: undefined,
        taskId: undefined,
        platform: undefined,
        sourceKind: undefined,
        downloadType: undefined,
        retryCount: undefined,
        retryLimit: undefined,
        retryIntervalMinutes: undefined,
        nextRetryAt: undefined,
      },
    ]);
  });

  it("returns a single history item by id", () => {
    const get = vi.fn().mockReturnValue({
      id: "retry-1",
      title: "Retrying",
      status: "pending_retry",
      finishedAt: 123,
      nextRetryAt: 456,
      retryCount: 1,
      retryLimit: 3,
      retryIntervalMinutes: 5,
    });
    const where = vi.fn(() => ({ get }));
    const from = vi.fn(() => ({ where }));
    vi.mocked(db.select).mockReturnValue({ from } as any);

    expect(getDownloadHistoryItem("retry-1")).toEqual(
      expect.objectContaining({
        id: "retry-1",
        status: "pending_retry",
        nextRetryAt: 456,
        retryCount: 1,
      })
    );
  });

  it("returns pending retry items ordered by next retry time", () => {
    const all = vi.fn().mockReturnValue([
      {
        id: "retry-1",
        title: "Retrying",
        status: "pending_retry",
        finishedAt: 123,
        nextRetryAt: 456,
      },
    ]);
    const orderBy = vi.fn(() => ({ all }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    vi.mocked(db.select).mockReturnValue({ from } as any);

    expect(getPendingRetryHistoryItems()).toEqual([
      expect.objectContaining({
        id: "retry-1",
        status: "pending_retry",
        nextRetryAt: 456,
      }),
    ]);
  });

  it("returns the latest retryable history item by source url", () => {
    const all = vi.fn().mockReturnValue([
      {
        id: "success-1",
        title: "Done",
        status: "success",
        finishedAt: 300,
        sourceUrl: "https://www.bilibili.com/video/BV1xx",
        retryMetadata: "{\"shape\":\"bilibili_all_parts\"}",
      },
      {
        id: "partial-1",
        title: "Incomplete",
        status: "partial",
        finishedAt: 250,
        sourceUrl: "https://www.bilibili.com/video/BV1xx",
        downloadType: "bilibili",
        retryMetadata: "{\"shape\":\"bilibili_all_parts\"}",
      },
      {
        id: "retry-1",
        title: "Retrying",
        status: "pending_retry",
        finishedAt: 200,
        sourceUrl: "https://www.bilibili.com/video/BV1xx",
        downloadType: "bilibili",
        retryMetadata: "{\"shape\":\"bilibili_all_parts\"}",
      },
      {
        id: "failed-1",
        title: "Failed",
        status: "failed",
        finishedAt: 100,
        sourceUrl: "https://www.bilibili.com/video/BV1xx",
        downloadType: "bilibili",
        retryMetadata: "{\"shape\":\"bilibili_all_parts\"}",
      },
    ]);
    const orderBy = vi.fn(() => ({ all }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    vi.mocked(db.select).mockReturnValue({ from } as any);

    expect(
      getLatestRetryHistoryItemBySourceUrl(
        "https://www.bilibili.com/video/BV1xx",
        "bilibili",
      ),
    ).toEqual(
      expect.objectContaining({
        id: "partial-1",
        status: "partial",
      }),
    );
  });

  it("ignores successful items when no retryable history exists", () => {
    const all = vi.fn().mockReturnValue([
      {
        id: "success-1",
        title: "Done",
        status: "success",
        finishedAt: 300,
        sourceUrl: "https://www.bilibili.com/video/BV1yy",
        downloadType: "bilibili",
        retryMetadata: "{\"shape\":\"bilibili_all_parts\"}",
      },
      {
        id: "success-2",
        title: "Older",
        status: "success",
        finishedAt: 200,
        sourceUrl: "https://www.bilibili.com/video/BV1yy",
        downloadType: "bilibili",
        retryMetadata: "{\"shape\":\"bilibili_all_parts\"}",
      },
    ]);
    const orderBy = vi.fn(() => ({ all }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    vi.mocked(db.select).mockReturnValue({ from } as any);

    expect(
      getLatestRetryHistoryItemBySourceUrl(
        "https://www.bilibili.com/video/BV1yy",
        "bilibili",
      ),
    ).toBeUndefined();
  });

  it("returns empty list when get history fails", () => {
    vi.mocked(db.select).mockImplementation(() => {
      throw new Error("query failed");
    });

    const result = getDownloadHistory();

    expect(result).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "Error getting download history",
      expect.any(Error)
    );
  });

  it("removes a history item", () => {
    const run = vi.fn();
    const where = vi.fn(() => ({ run }));
    vi.mocked(db.delete).mockReturnValue({ where } as any);

    removeDownloadHistoryItem("h1");

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("swallows remove errors", () => {
    vi.mocked(db.delete).mockImplementation(() => {
      throw new Error("delete failed");
    });

    expect(() => removeDownloadHistoryItem("bad")).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "Error removing download history item",
      expect.any(Error)
    );
  });

  it("clears history", () => {
    const run = vi.fn();
    const where = vi.fn(() => ({ run }));
    vi.mocked(db.delete).mockReturnValue({ where } as any);

    clearDownloadHistory();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("finalizes a pending retry item as failed", () => {
    const get = vi.fn().mockReturnValue({
      id: "retry-1",
      title: "Retrying",
      status: "pending_retry",
      finishedAt: 123,
      sourceUrl: "https://example.com",
      retryCount: 2,
      retryLimit: 3,
      retryIntervalMinutes: 5,
      nextRetryAt: 456,
    });
    const whereSelect = vi.fn(() => ({ get }));
    const from = vi.fn(() => ({ where: whereSelect }));
    vi.mocked(db.select).mockReturnValue({ from } as any);

    const run = vi.fn();
    const onConflictDoUpdate = vi.fn(() => ({ run }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    vi.mocked(db.insert).mockReturnValue({ values } as any);

    finalizePendingRetryHistoryItem("retry-1", "Final failure");

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "retry-1",
        status: "failed",
        error: "Final failure",
        nextRetryAt: null,
      })
    );
  });

  it("throws DatabaseError when clear fails", () => {
    vi.mocked(db.delete).mockImplementation(() => {
      throw new Error("clear failed");
    });

    expect(() => clearDownloadHistory()).toThrow(DatabaseError);
    expect(logger.error).toHaveBeenCalledWith(
      "Error clearing download history",
      expect.any(Error)
    );
  });
});
