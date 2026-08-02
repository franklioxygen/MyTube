import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  runSweep: vi.fn(),
  getSettings: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: { schedule: mocks.schedule },
  schedule: mocks.schedule,
}));

vi.mock("../../services/autoDeleteService", () => ({
  runAutoDeleteSweep: mocks.runSweep,
}));

vi.mock("../../services/storageService", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

import {
  startAutoDeleteScheduler,
  stopAutoDeleteScheduler,
} from "../../services/autoDeleteScheduler";

const uncappedSummary = {
  enabled: true,
  intervalDays: 30,
  scanned: 0,
  deletedVideos: 0,
  skippedLocked: 0,
  errors: 0,
  capped: false,
};

function dailyCallback(): () => void {
  return mocks.schedule.mock.calls[0][1] as () => void;
}

describe("auto-delete scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    vi.clearAllMocks();
    mocks.schedule.mockReturnValue({ stop: vi.fn() });
    mocks.runSweep.mockResolvedValue(uncappedSummary);
    mocks.getSettings.mockReturnValue({ autoDeleteEnabled: false });
  });

  afterEach(() => {
    stopAutoDeleteScheduler();
    vi.useRealTimers();
  });

  it("starts one idempotent daily 03:00 task", () => {
    startAutoDeleteScheduler();
    startAutoDeleteScheduler();

    expect(mocks.schedule).toHaveBeenCalledTimes(1);
    expect(mocks.schedule).toHaveBeenCalledWith(
      "0 3 * * *",
      expect.any(Function)
    );
  });

  it("runs a stale boot-time catch-up after the startup delay", async () => {
    mocks.getSettings.mockReturnValue({
      autoDeleteEnabled: true,
      autoDeleteLastRunAt: Date.now() - 25 * 60 * 60 * 1000,
    });
    startAutoDeleteScheduler();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(mocks.runSweep).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.runSweep).toHaveBeenCalledTimes(1);
  });

  it("does not catch up when the last run is still fresh", async () => {
    mocks.getSettings.mockReturnValue({
      autoDeleteEnabled: true,
      autoDeleteLastRunAt: Date.now() - 23 * 60 * 60 * 1000,
    });
    startAutoDeleteScheduler();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.runSweep).not.toHaveBeenCalled();
  });

  it("schedules only one five-minute follow-up for capped runs", async () => {
    mocks.runSweep.mockResolvedValue({ ...uncappedSummary, capped: true });
    startAutoDeleteScheduler();

    dailyCallback()();
    dailyCallback()();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runSweep).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(mocks.runSweep).toHaveBeenCalledTimes(3);
  });

  it("cancels catch-up and capped-run follow-up work when stopped", async () => {
    mocks.getSettings.mockReturnValue({
      autoDeleteEnabled: true,
      autoDeleteLastRunAt: 0,
    });
    mocks.runSweep.mockResolvedValue({ ...uncappedSummary, capped: true });
    const task = { stop: vi.fn() };
    mocks.schedule.mockReturnValue(task);
    startAutoDeleteScheduler();

    dailyCallback()();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runSweep).toHaveBeenCalledTimes(1);

    stopAutoDeleteScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(task.stop).toHaveBeenCalledTimes(1);
    expect(mocks.runSweep).toHaveBeenCalledTimes(1);
  });

  it("does not let an in-flight stopped generation schedule follow-up work", async () => {
    let resolveSweep: ((value: typeof uncappedSummary) => void) | undefined;
    mocks.runSweep.mockReturnValue(
      new Promise((resolve) => {
        resolveSweep = resolve;
      })
    );
    startAutoDeleteScheduler();

    dailyCallback()();
    stopAutoDeleteScheduler();
    resolveSweep?.({ ...uncappedSummary, capped: true });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(mocks.runSweep).toHaveBeenCalledTimes(1);
  });
});
