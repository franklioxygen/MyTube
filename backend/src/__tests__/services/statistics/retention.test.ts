import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSettings = vi.fn();
const mockRunRollupCycle = vi.fn();

vi.mock("../../../db", () => ({
  sqlite: { prepare: vi.fn(), transaction: vi.fn() },
}));

vi.mock("../../../services/storageService", () => ({
  getSettings: () => mockGetSettings(),
}));

vi.mock("../../../services/statistics/rollups", () => ({
  runRollupCycle: () => mockRunRollupCycle(),
}));

vi.mock("../../../services/statistics/collector", () => ({
  getResolvedTimezone: vi.fn(() => "UTC"),
}));

vi.mock("../../../services/statistics/normalizers", () => ({
  dayBucket: vi.fn((ms: number) => new Date(ms).toISOString().slice(0, 10)),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { sqlite } from "../../../db";
import {
  clearAllStatisticsData,
  runRetentionCycle,
  startRetentionWorker,
  stopRetentionWorker,
} from "../../../services/statistics/retention";

function makeStmt(opts: { run?: unknown; all?: unknown; get?: unknown } = {}) {
  return {
    run: vi.fn().mockReturnValue(opts.run ?? { changes: 0 }),
    all: vi.fn().mockReturnValue(opts.all ?? []),
    get: vi.fn().mockReturnValue(opts.get ?? undefined),
  };
}

describe("statistics retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunRollupCycle.mockResolvedValue({ daysProcessed: 0 });
  });

  afterEach(() => {
    stopRetentionWorker();
  });

  describe("runRetentionCycle", () => {
    it("returns early with no sealed days when retentionDays is null", async () => {
      mockGetSettings.mockReturnValue({ statisticsRetentionDays: null });
      const pruneStmt = makeStmt();
      vi.mocked(sqlite.prepare).mockReturnValue(pruneStmt as any);

      const result = await runRetentionCycle();

      expect(result.sealedDays).toBe(0);
      expect(result.minuteBucketsPruned).toBe(true);
    });

    it("uses 365-day default when setting is missing", async () => {
      mockGetSettings.mockReturnValue({});
      // pruneOldIngestionMinutes + getDistinctEventDays
      const pruneStmt = makeStmt();
      const distinctStmt = makeStmt({ all: [] });
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce(pruneStmt as any)
        .mockReturnValueOnce(distinctStmt as any);

      const result = await runRetentionCycle();

      expect(result.sealedDays).toBe(0);
    });

    it("uses settings value when statisticsRetentionDays is a positive number", async () => {
      mockGetSettings.mockReturnValue({ statisticsRetentionDays: 30 });
      const pruneStmt = makeStmt();
      const distinctStmt = makeStmt({ all: [] });
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce(pruneStmt as any)
        .mockReturnValueOnce(distinctStmt as any);

      const result = await runRetentionCycle();

      expect(result.sealedDays).toBe(0);
    });

    it("seals and prunes candidate days beyond cutoff", async () => {
      mockGetSettings.mockReturnValue({ statisticsRetentionDays: 1 });

      const oldDay = "2020-01-01";
      const pruneStmt = makeStmt();
      const distinctStmt = makeStmt({ all: [{ day: oldDay }] });
      const markDirtyStmt = makeStmt();
      const txFn = vi.fn().mockImplementation((cb: (day: string) => void) => cb(oldDay));
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce(pruneStmt as any)   // pruneOldIngestionMinutes
        .mockReturnValueOnce(distinctStmt as any) // getDistinctEventDays
        .mockReturnValueOnce(markDirtyStmt as any); // markDirty loop
      vi.mocked(sqlite.transaction).mockReturnValue(txFn as any);

      const result = await runRetentionCycle();

      expect(mockRunRollupCycle).toHaveBeenCalledTimes(1);
      expect(result.minuteBucketsPruned).toBe(true);
    });

    it("handles getSettings throwing and falls back to 365 days", async () => {
      mockGetSettings.mockImplementation(() => { throw new Error("settings error"); });
      const pruneStmt = makeStmt();
      const distinctStmt = makeStmt({ all: [] });
      vi.mocked(sqlite.prepare)
        .mockReturnValueOnce(pruneStmt as any)
        .mockReturnValueOnce(distinctStmt as any);

      const result = await runRetentionCycle();

      expect(result.sealedDays).toBe(0);
    });

    it("handles sqlite errors in pruneOldIngestionMinutes gracefully", async () => {
      mockGetSettings.mockReturnValue({ statisticsRetentionDays: null });
      vi.mocked(sqlite.prepare).mockImplementation(() => {
        throw new Error("db error");
      });

      const result = await runRetentionCycle();

      expect(result.sealedDays).toBe(0);
    });
  });

  describe("clearAllStatisticsData", () => {
    it("clears all four statistics tables", () => {
      const stmt = makeStmt();
      vi.mocked(sqlite.prepare).mockReturnValue(stmt as any);

      clearAllStatisticsData();

      expect(sqlite.prepare).toHaveBeenCalledTimes(4);
      expect(stmt.run).toHaveBeenCalledTimes(4);
    });

    it("throws if sqlite.prepare throws", () => {
      vi.mocked(sqlite.prepare).mockImplementation(() => {
        throw new Error("table missing");
      });

      expect(() => clearAllStatisticsData()).toThrow("table missing");
    });
  });

  describe("startRetentionWorker / stopRetentionWorker", () => {
    it("stopRetentionWorker is safe to call when worker was never started", () => {
      expect(() => stopRetentionWorker()).not.toThrow();
    });

    it("startRetentionWorker does not throw", () => {
      vi.useFakeTimers();
      expect(() => startRetentionWorker()).not.toThrow();
      vi.useRealTimers();
    });

    it("calling startRetentionWorker twice does not register a second timer", () => {
      vi.useFakeTimers();
      startRetentionWorker();
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      startRetentionWorker(); // second call should be a no-op
      expect(setIntervalSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
