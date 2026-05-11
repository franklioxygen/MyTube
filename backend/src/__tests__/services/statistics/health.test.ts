import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRollupHealth = vi.fn();

vi.mock("../../../db", () => ({
  sqlite: { prepare: vi.fn() },
}));

vi.mock("../../../services/statistics/rollups", () => ({
  getRollupHealth: () => mockGetRollupHealth(),
  runRollupCycle: vi.fn(),
  startRollupWorker: vi.fn(),
  stopRollupWorker: vi.fn(),
  recomputeAllUnsealedDays: vi.fn(),
}));

import { sqlite } from "../../../db";
import { getHealthSnapshot } from "../../../services/statistics/health";

function makePrepare(returnVal: unknown) {
  return { get: vi.fn().mockReturnValue(returnVal), run: vi.fn(), all: vi.fn() };
}

describe("statistics health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a healthy snapshot with no warnings", () => {
    mockGetRollupHealth.mockReturnValue({ running: false, lastRunAt: Date.now() - 5_000 });
    vi.mocked(sqlite.prepare)
      .mockReturnValueOnce(makePrepare({ c: 0 }) as any)
      .mockReturnValueOnce(makePrepare({ c: 3 }) as any)
      .mockReturnValueOnce(makePrepare({ acc: 50, dropped: 0, errors: 0, sealedDayDrop: 0 }) as any);

    const snap = getHealthSnapshot();

    expect(snap.dirtyDayCount).toBe(0);
    expect(snap.sealedDayCount).toBe(3);
    expect(snap.trailingHour.accepted).toBe(50);
    expect(snap.trailingHour.dropped).toBe(0);
    expect(snap.trailingHour.error).toBe(0);
    expect(snap.warning).toBe(false);
    expect(snap.rollup.running).toBe(false);
    expect(snap.rollup.lastRunAt).toBeGreaterThan(0);
  });

  it("sets lastRunAt to null when rollup has never run (lastRunAt = 0)", () => {
    mockGetRollupHealth.mockReturnValue({ running: false, lastRunAt: 0 });
    vi.mocked(sqlite.prepare)
      .mockReturnValueOnce(makePrepare({ c: 0 }) as any)
      .mockReturnValueOnce(makePrepare({ c: 0 }) as any)
      .mockReturnValueOnce(makePrepare({ acc: 0, dropped: 0, errors: 0, sealedDayDrop: 0 }) as any);

    const snap = getHealthSnapshot();

    expect(snap.rollup.lastRunAt).toBeNull();
    // fresh install — not stale yet, so warning stays false
    expect(snap.warning).toBe(false);
  });

  it("sets warning when rollup is stale (> 30 min since last run)", () => {
    const staleTime = Date.now() - 31 * 60 * 1000;
    mockGetRollupHealth.mockReturnValue({ running: false, lastRunAt: staleTime });
    vi.mocked(sqlite.prepare)
      .mockReturnValueOnce(makePrepare({ c: 0 }) as any)
      .mockReturnValueOnce(makePrepare({ c: 0 }) as any)
      .mockReturnValueOnce(makePrepare({ acc: 0, dropped: 0, errors: 0, sealedDayDrop: 0 }) as any);

    const snap = getHealthSnapshot();

    expect(snap.warning).toBe(true);
    expect(snap.rollup.lastRunAt).toBe(staleTime);
  });

  it("sets warning when trailing hour has dropped events", () => {
    mockGetRollupHealth.mockReturnValue({ running: false, lastRunAt: Date.now() - 1_000 });
    vi.mocked(sqlite.prepare)
      .mockReturnValueOnce(makePrepare({ c: 1 }) as any)
      .mockReturnValueOnce(makePrepare({ c: 0 }) as any)
      .mockReturnValueOnce(makePrepare({ acc: 100, dropped: 5, errors: 0, sealedDayDrop: 0 }) as any);

    const snap = getHealthSnapshot();

    expect(snap.warning).toBe(true);
    expect(snap.trailingHour.dropped).toBe(5);
    expect(snap.dirtyDayCount).toBe(1);
  });

  it("sets warning when trailing hour has errors", () => {
    mockGetRollupHealth.mockReturnValue({ running: true, lastRunAt: Date.now() - 1_000 });
    vi.mocked(sqlite.prepare)
      .mockReturnValueOnce(makePrepare({ c: 0 }) as any)
      .mockReturnValueOnce(makePrepare({ c: 0 }) as any)
      .mockReturnValueOnce(makePrepare({ acc: 0, dropped: 0, errors: 2, sealedDayDrop: 0 }) as any);

    const snap = getHealthSnapshot();

    expect(snap.warning).toBe(true);
    expect(snap.trailingHour.error).toBe(2);
    expect(snap.rollup.running).toBe(true);
  });

  it("sets warning when there are sealed-day drops", () => {
    mockGetRollupHealth.mockReturnValue({ running: false, lastRunAt: Date.now() - 1_000 });
    vi.mocked(sqlite.prepare)
      .mockReturnValueOnce(makePrepare({ c: 0 }) as any)
      .mockReturnValueOnce(makePrepare({ c: 10 }) as any)
      .mockReturnValueOnce(makePrepare({ acc: 0, dropped: 0, errors: 0, sealedDayDrop: 1 }) as any);

    const snap = getHealthSnapshot();

    expect(snap.warning).toBe(true);
    expect(snap.trailingHour.sealedDayDrop).toBe(1);
    expect(snap.sealedDayCount).toBe(10);
  });

  it("uses defaults when sqlite returns undefined rows", () => {
    mockGetRollupHealth.mockReturnValue({ running: false, lastRunAt: 0 });
    vi.mocked(sqlite.prepare)
      .mockReturnValueOnce(makePrepare(undefined) as any)
      .mockReturnValueOnce(makePrepare(undefined) as any)
      .mockReturnValueOnce(makePrepare(undefined) as any);

    const snap = getHealthSnapshot();

    expect(snap.dirtyDayCount).toBe(0);
    expect(snap.sealedDayCount).toBe(0);
    expect(snap.trailingHour.accepted).toBe(0);
    expect(snap.trailingHour.dropped).toBe(0);
    expect(snap.trailingHour.error).toBe(0);
    expect(snap.trailingHour.sealedDayDrop).toBe(0);
  });
});
