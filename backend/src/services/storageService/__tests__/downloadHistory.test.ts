/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((value) => ({ descBy: value })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("../../../db/schema", () => ({
  downloadHistory: {
    id: "id",
    finishedAt: "finishedAt",
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
  getDownloadHistory,
  removeDownloadHistoryItem,
} from "../downloadHistory";

describe("downloadHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds history item successfully", () => {
    const run = vi.fn();
    const values = vi.fn(() => ({ run }));
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
      },
    ]);
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
    vi.mocked(db.delete).mockReturnValue({ run } as any);

    clearDownloadHistory();

    expect(run).toHaveBeenCalledTimes(1);
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
