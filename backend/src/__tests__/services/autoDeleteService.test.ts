import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, getDatabaseGeneration } from "../../db";
import { runAutoDeleteSweep } from "../../services/autoDeleteService";
import * as storageService from "../../services/storageService";
import * as statistics from "../../services/statistics";

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
  },
  getDatabaseGeneration: vi.fn(() => 0),
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
    vi.mocked(getDatabaseGeneration).mockReturnValue(0);
    vi.mocked(storageService.getSettings).mockReturnValue(ENABLED_SETTINGS as any);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "video-0",
      title: "Old Video",
      addedAt: "2020-01-01T00:00:00.000Z",
      createdAt: "2020-01-01T00:00:00.000Z",
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

  it("does not delete a row whose non-canonical timestamp parses to a recent date", async () => {
    // referenceIso sorts lexically before the cutoff (so the SQL pre-filter and
    // fast-stop select it), but the real row date parses to the future.
    queueSelectResults([{ id: "legacy-1", referenceIso: "01/15/2099" }]);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "legacy-1",
      title: "Locale-formatted future",
      addedAt: "01/15/2099",
      createdAt: "01/15/2099",
      autoDeleteLocked: null,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(summary.deletedVideos).toBe(0);
  });

  it("falls back to created_at when added_at is unparseable", async () => {
    queueSelectResults([{ id: "legacy-2", referenceIso: "0000-unparseable" }]);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "legacy-2",
      title: "Bad added_at, good created_at",
      addedAt: "0000-unparseable",
      createdAt: "2020-01-01T00:00:00.000Z",
      autoDeleteLocked: null,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).toHaveBeenCalledWith(
      "legacy-2",
      "auto_delete"
    );
    expect(summary.deletedVideos).toBe(1);
  });

  it("does not delete when a calendar-invalid ISO added_at masks a recent created_at", async () => {
    // Date.parse normalizes 2020-02-31 -> 2020-03-02; without calendar
    // validation the row would look old and delete a recently added video.
    const recentIso = new Date().toISOString();
    queueSelectResults([
      { id: "legacy-4", referenceIso: "2020-02-31T00:00:00.000Z" },
    ]);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "legacy-4",
      title: "Feb 31 added_at, recent created_at",
      addedAt: "2020-02-31T00:00:00.000Z",
      createdAt: recentIso,
      autoDeleteLocked: null,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(summary.deletedVideos).toBe(0);
  });

  it("falls back to created_at when the ISO added_at is calendar-invalid but old", async () => {
    queueSelectResults([
      { id: "legacy-5", referenceIso: "2020-02-31T00:00:00.000Z" },
    ]);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "legacy-5",
      title: "Feb 31 added_at, old created_at",
      addedAt: "2020-02-31T00:00:00.000Z",
      createdAt: "2019-01-01T00:00:00.000Z",
      autoDeleteLocked: null,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).toHaveBeenCalledWith(
      "legacy-5",
      "auto_delete"
    );
    expect(summary.deletedVideos).toBe(1);
  });

  it("skips a row whose timestamps cannot be parsed", async () => {
    queueSelectResults([{ id: "legacy-3", referenceIso: "0000-unparseable" }]);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "legacy-3",
      title: "Undateable",
      addedAt: "0000-unparseable",
      createdAt: "also-unparseable",
      autoDeleteLocked: null,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(summary.deletedVideos).toBe(0);
  });

  it("deletes a row dated by an old epoch-string added_at", async () => {
    const oldEpochMs = String(Date.parse("2020-01-01T00:00:00.000Z"));
    queueSelectResults([{ id: "epoch-1", referenceIso: oldEpochMs }]);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "epoch-1",
      title: "Epoch old",
      addedAt: oldEpochMs,
      createdAt: "",
      autoDeleteLocked: null,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).toHaveBeenCalledWith(
      "epoch-1",
      "auto_delete"
    );
    expect(summary.deletedVideos).toBe(1);
  });

  it("does not delete a row dated by a recent epoch-string added_at", async () => {
    const recentEpochMs = String(Date.now());
    queueSelectResults([{ id: "epoch-2", referenceIso: recentEpochMs }]);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "epoch-2",
      title: "Epoch recent",
      addedAt: recentEpochMs,
      createdAt: "",
      autoDeleteLocked: null,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(summary.deletedVideos).toBe(0);
  });

  it("falls back to created_at for an out-of-range date-shaped added_at", async () => {
    // 9999-99-99 matches the ISO shape but is not a real date; it must not mask
    // a valid old created_at.
    queueSelectResults([{ id: "invalid-1", referenceIso: "9999-99-99" }]);
    vi.mocked(storageService.getVideoById).mockReturnValue({
      id: "invalid-1",
      title: "9999-99-99 added_at, old created_at",
      addedAt: "9999-99-99",
      createdAt: "2019-01-01T00:00:00.000Z",
      autoDeleteLocked: null,
    } as any);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).toHaveBeenCalledWith(
      "invalid-1",
      "auto_delete"
    );
    expect(summary.deletedVideos).toBe(1);
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

  it("aborts without deleting when the database is replaced mid-sweep", async () => {
    queueSelectResults(makeCandidates(2));
    // Generation is captured at start (0), then differs on the per-candidate
    // check (1) — simulating a database import/restore mid-sweep.
    vi.mocked(getDatabaseGeneration)
      .mockReturnValueOnce(0)
      .mockReturnValue(1);

    const summary = await runAutoDeleteSweep();

    expect(storageService.deleteVideo).not.toHaveBeenCalled();
    expect(summary.deletedVideos).toBe(0);
  });

  it("does not delete when the interval is widened mid-sweep", async () => {
    queueSelectResults(makeCandidates(2));
    // Policy read uses 30 days; the per-candidate re-check widens the window so
    // far that the candidate (added in 2020) is no longer past the cutoff, so
    // the numeric age check drops it.
    vi.mocked(storageService.getSettings)
      .mockReturnValueOnce(ENABLED_SETTINGS as any)
      .mockReturnValue({
        autoDeleteEnabled: true,
        autoDeleteIntervalDays: 100_000,
      } as any);

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
      addedAt: "2020-01-01T00:00:00.000Z",
      createdAt: "2020-01-01T00:00:00.000Z",
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
