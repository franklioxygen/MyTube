import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubscriptionSchedulerTasks,
  stopSubscriptionSchedulerTasks,
} from "../../../services/subscription/scheduler";
import { runSubscriptionRetentionCleanup } from "../../../services/subscriptionRetentionService";
import { logger } from "../../../utils/logger";
import cron from "node-cron";

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  retentionCleanup: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: { schedule: mocks.schedule },
  schedule: mocks.schedule,
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
  },
}));

vi.mock("../../../services/subscriptionRetentionService", () => ({
  runSubscriptionRetentionCleanup: mocks.retentionCleanup,
}));

describe("subscription scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.schedule.mockImplementation((_expression: string, _callback: () => void) => ({
      stop: vi.fn(),
    }));
    mocks.retentionCleanup.mockResolvedValue(undefined);
  });

  it("creates check and retention cron tasks", () => {
    const checkSubscriptions = vi.fn().mockResolvedValue(undefined);

    const tasks = createSubscriptionSchedulerTasks(checkSubscriptions);

    expect(tasks.checkTask).toBeDefined();
    expect(tasks.retentionCleanupTask).toBeDefined();
    expect(cron.schedule).toHaveBeenCalledWith("* * * * *", expect.any(Function));
    expect(cron.schedule).toHaveBeenCalledWith("0 * * * *", expect.any(Function));
    expect(logger.info).toHaveBeenCalledWith(
      "Subscription scheduler started (node-cron)."
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Subscription retention scheduler started (node-cron)."
    );
  });

  it("logs check callback failures", async () => {
    const error = new Error("check failed");
    const checkSubscriptions = vi.fn().mockRejectedValue(error);
    createSubscriptionSchedulerTasks(checkSubscriptions);

    const callback = mocks.schedule.mock.calls[0][1] as () => void;
    callback();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      "Subscription scheduler tick failed:",
      error
    );
  });

  it("runs retention cleanup from the retention cron callback", async () => {
    const checkSubscriptions = vi.fn().mockResolvedValue(undefined);
    createSubscriptionSchedulerTasks(checkSubscriptions);

    const callback = mocks.schedule.mock.calls[1][1] as () => void;
    callback();
    await Promise.resolve();

    expect(runSubscriptionRetentionCleanup).toHaveBeenCalled();
  });

  it("stops existing scheduler tasks", () => {
    const checkTask = { stop: vi.fn() };
    const retentionCleanupTask = { stop: vi.fn() };

    stopSubscriptionSchedulerTasks({
      checkTask,
      retentionCleanupTask,
    } as unknown as Parameters<typeof stopSubscriptionSchedulerTasks>[0]);

    expect(checkTask.stop).toHaveBeenCalled();
    expect(retentionCleanupTask.stop).toHaveBeenCalled();
  });
});
