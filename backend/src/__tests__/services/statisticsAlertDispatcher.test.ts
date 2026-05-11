import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsStatisticsEnabled = vi.fn();
const mockEstimateDiskRunway = vi.fn();
const mockGetSettings = vi.fn();
const mockSendAlert = vi.fn();

vi.mock("../../db", () => ({
  sqlite: { prepare: vi.fn() },
}));

vi.mock("../../services/storageService", () => ({
  getSettings: () => mockGetSettings(),
}));

vi.mock("../../services/telegramService", () => ({
  TelegramService: { sendAlert: (...args: any[]) => mockSendAlert(...args) },
}));

vi.mock("../../services/statistics", () => ({
  isStatisticsEnabled: () => mockIsStatisticsEnabled(),
  estimateDiskRunway: () => mockEstimateDiskRunway(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { sqlite } from "../../db";
import {
  evaluateAlertsNow,
  startStatisticsAlertDispatcher,
  stopStatisticsAlertDispatcher,
} from "../../services/statisticsAlertDispatcher";

function makeStmt(rows: unknown[] = []) {
  return { all: vi.fn().mockReturnValue(rows), run: vi.fn(), get: vi.fn() };
}

describe("statisticsAlertDispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsStatisticsEnabled.mockReturnValue(true);
    mockGetSettings.mockReturnValue({ telegramEnabled: true });
    mockSendAlert.mockResolvedValue(true);
    mockEstimateDiskRunway.mockReturnValue({ status: "ok", volumes: [] });
  });

  afterEach(() => {
    stopStatisticsAlertDispatcher();
  });

  describe("evaluateAlertsNow", () => {
    it("does nothing when statistics is disabled", async () => {
      mockIsStatisticsEnabled.mockReturnValue(false);

      await evaluateAlertsNow();

      expect(sqlite.prepare).not.toHaveBeenCalled();
      expect(mockSendAlert).not.toHaveBeenCalled();
    });

    it("does nothing when telegram is disabled", async () => {
      mockGetSettings.mockReturnValue({ telegramEnabled: false });
      vi.mocked(sqlite.prepare).mockReturnValue(makeStmt([]) as any);

      await evaluateAlertsNow();

      expect(mockSendAlert).not.toHaveBeenCalled();
    });

    it("sends an alert for subscriptions with >= 5 consecutive failures", async () => {
      vi.mocked(sqlite.prepare).mockReturnValue(
        makeStmt([{ id: "sub-1", author: "CoolChannel", consecutive_failure_count: 7 }]) as any
      );

      await evaluateAlertsNow();

      expect(mockSendAlert).toHaveBeenCalledWith(
        expect.stringContaining("CoolChannel")
      );
      expect(mockSendAlert).toHaveBeenCalledWith(
        expect.stringContaining("7")
      );
    });

    it("does not double-alert the same subscription within 24 h", async () => {
      vi.mocked(sqlite.prepare).mockReturnValue(
        makeStmt([{ id: "sub-dedupe", author: "Channel", consecutive_failure_count: 5 }]) as any
      );

      // First call dispatches
      await evaluateAlertsNow();
      expect(mockSendAlert).toHaveBeenCalledTimes(1);

      // Second call within 24 h should be debounced
      await evaluateAlertsNow();
      expect(mockSendAlert).toHaveBeenCalledTimes(1);
    });

    it("sends a disk runway alert when a volume has < 7 days remaining", async () => {
      vi.mocked(sqlite.prepare).mockReturnValue(makeStmt([]) as any);
      mockEstimateDiskRunway.mockReturnValue({
        status: "ok",
        volumes: [{ rootPath: "/data", daysRemaining: 3 }],
      });

      await evaluateAlertsNow();

      expect(mockSendAlert).toHaveBeenCalledWith(
        expect.stringContaining("/data")
      );
      expect(mockSendAlert).toHaveBeenCalledWith(
        expect.stringContaining("3")
      );
    });

    it("skips disk alert when runway status is not ok", async () => {
      vi.mocked(sqlite.prepare).mockReturnValue(makeStmt([]) as any);
      mockEstimateDiskRunway.mockReturnValue({ status: "error" });

      await evaluateAlertsNow();

      expect(mockSendAlert).not.toHaveBeenCalled();
    });

    it("skips disk alert when volume has >= 7 days remaining", async () => {
      vi.mocked(sqlite.prepare).mockReturnValue(makeStmt([]) as any);
      mockEstimateDiskRunway.mockReturnValue({
        status: "ok",
        volumes: [{ rootPath: "/data", daysRemaining: 10 }],
      });

      await evaluateAlertsNow();

      expect(mockSendAlert).not.toHaveBeenCalled();
    });

    it("handles sqlite error in subscription streak check gracefully", async () => {
      vi.mocked(sqlite.prepare).mockImplementation(() => {
        throw new Error("db error");
      });

      await expect(evaluateAlertsNow()).resolves.not.toThrow();
    });
  });

  describe("startStatisticsAlertDispatcher / stopStatisticsAlertDispatcher", () => {
    it("stopStatisticsAlertDispatcher is safe when never started", () => {
      expect(() => stopStatisticsAlertDispatcher()).not.toThrow();
    });

    it("startStatisticsAlertDispatcher does not throw", () => {
      vi.useFakeTimers();
      expect(() => startStatisticsAlertDispatcher()).not.toThrow();
      vi.useRealTimers();
    });

    it("calling startStatisticsAlertDispatcher twice does not register a second timer", () => {
      vi.useFakeTimers();
      startStatisticsAlertDispatcher();
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      startStatisticsAlertDispatcher();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
