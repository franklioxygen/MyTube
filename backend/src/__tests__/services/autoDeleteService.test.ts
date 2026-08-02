import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import { runAutoDeleteSweep } from "../../services/autoDeleteService";
import * as storageService from "../../services/storageService";
import * as statistics from "../../services/statistics";

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../../db/schema", () => ({
  videos: {
    id: "id",
    addedAt: "addedAt",
    createdAt: "createdAt",
    autoDeleteLocked: "autoDeleteLocked",
  },
}));

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
  getVideoById: vi.fn(),
  deleteVideo: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("../../services/statistics", () => ({
  recordEvent: vi.fn(() => null),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const createSelectBuilder = (rows: unknown[] | Promise<unknown[]>) => {
  const builder: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: any, reject: any) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
};

const queueSelectResults = (...results: unknown[][]) => {
  vi.mocked(db.select).mockImplementation(() => {
    const rows = results.shift() || [];
    return createSelectBuilder(rows) as any;
  });
};

const ENABLED_SETTINGS = { autoDeleteEnabled: true, autoDeleteIntervalDays: 30 };

const makeCandidates = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `video-${index}`,
    referenceIso: `2020-01-01T00:00:${index.toString().padStart(2, "0")}.000Z`,
  }));

describe("autoDeleteService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageService.getSettings).mockReturnValue(ENABLED_SETTINGS as any);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "video-0",
      title: "Old Video",
      autoDeleteLocked: null,
    } as any);
    vi.mocked(storageService.deleteVideo).mockReturnValue(true);
  });

  it("does nothing while disabled", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      autoDeleteEnabled: false,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(summary.enabled).toBe(false);
    expect(summary.deletedVideos).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(storageService.saveSettings).not.toHaveBeenCalled();
  });

  it("does nothing when the interval is invalid", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({
      autoDeleteEnabled: true,
      autoDeleteIntervalDays: 0,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(summary.enabled).toBe(false);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("deletes candidates with the auto_delete reason and records the run", async () => {
    queueSelectResults(makeCandidates(1));

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).toHaveBeenCalledWith(
      "video-0",
      "auto_delete"
    );
    expect(summary.enabled).toBe(true);
    expect(summary.intervalDays).toBe(30);
    expect(summary.deletedVideos).toBe(1);
    expect(summary.capped).toBe(false);

    // last-run persisted via the system-only escape hatch, not the public whitelist.
    expect(storageService.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ autoDeleteLastRunAt: expect.any(Number) }),
      { extraWhitelistedKeys: ["autoDeleteLastRunAt"] }
    );

    // summary event emitted.
    expect(statistics.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "auto_delete_completed",
        payload: expect.objectContaining({ deletedCount: 1, capped: false }),
      })
    );
  });

  it("records a completed sweep even when no candidates are deleted", async () => {
    queueSelectResults([]);

    const summary = await runAutoDeleteSweep();

    expect(summary.deletedVideos).toBe(0);
    expect(summary.errors).toBe(0);
    expect(storageService.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ autoDeleteLastRunAt: expect.any(Number) }),
      { extraWhitelistedKeys: ["autoDeleteLastRunAt"] }
    );
    expect(statistics.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "auto_delete_completed",
        payload: expect.objectContaining({ deletedCount: 0, errors: 0 }),
      })
    );
  });

  it("counts a false delete result as an error", async () => {
    queueSelectResults(makeCandidates(1));
    vi.mocked(storageService.deleteVideo).mockReturnValue(false);

    const summary = await runAutoDeleteSweep();

    expect(summary.deletedVideos).toBe(0);
    expect(summary.errors).toBe(1);
    expect(statistics.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ deletedCount: 0, errors: 1 }),
      })
    );
  });

  it("skips a candidate locked after selection and counts it", async () => {
    queueSelectResults(makeCandidates(1));
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "video-0",
      title: "Now Locked",
      autoDeleteLocked: 1,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(summary.skippedLocked).toBe(1);
    expect(summary.deletedVideos).toBe(0);
  });

  it("skips a candidate whose row no longer exists", async () => {
    queueSelectResults(makeCandidates(1));
    vi.mocked(storageService.getVideoById).mockReturnValue(undefined);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(summary.deletedVideos).toBe(0);
    expect(summary.skippedLocked).toBe(0);
  });

  it("stops the run when the policy is disabled mid-sweep", async () => {
    queueSelectResults(makeCandidates(2));
    // First getSettings (policy read) is enabled; the per-candidate re-check is disabled.
    vi.mocked(storageService.getSettings)
      .mockReturnValueOnce(ENABLED_SETTINGS as any)
      .mockReturnValue({ autoDeleteEnabled: false } as any);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(summary.deletedVideos).toBe(0);
  });

  it("stops at the per-run cap and marks the summary capped", async () => {
    // Five full batches of 100 = 500 deletions, hitting MAX_DELETIONS_PER_RUN.
    queueSelectResults(
      makeCandidates(100),
      makeCandidates(100),
      makeCandidates(100),
      makeCandidates(100),
      makeCandidates(100),
      []
    );
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "video",
      title: "Old",
      autoDeleteLocked: null,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(summary.deletedVideos).toBe(500);
    expect(summary.capped).toBe(true);
    expect(statistics.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ capped: true }),
      })
    );
  });

  it("returns an inert summary when a sweep is already running", async () => {
    let releaseFirstSelect: ((rows: unknown[]) => void) | undefined;
    const firstSelect = new Promise<unknown[]>((resolve) => {
      releaseFirstSelect = resolve;
    });
    vi.mocked(db.select).mockReturnValueOnce(
      createSelectBuilder(firstSelect) as any
    );

    const firstRun = runAutoDeleteSweep();
    const secondSummary = await runAutoDeleteSweep();

    expect(secondSummary.enabled).toBe(false);
    expect(secondSummary.deletedVideos).toBe(0);
    expect(db.select).toHaveBeenCalledTimes(1);

    releaseFirstSelect?.([]);
    await firstRun;
  });
});
