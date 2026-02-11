import { beforeEach, describe, expect, it, vi } from "vitest";
import { startBackgroundJobs } from "../../server/startupJobs";
import { subscriptionService } from "../../services/subscriptionService";
import * as metadataService from "../../services/metadataService";
import { startCloudflaredIfEnabled } from "../../server/cloudRoutes";
import { logger } from "../../utils/logger";

vi.mock("../../services/subscriptionService", () => ({
  subscriptionService: {
    startScheduler: vi.fn(),
  },
}));

vi.mock("../../services/metadataService", () => ({
  backfillDurations: vi.fn(),
}));

vi.mock("../../server/cloudRoutes", () => ({
  startCloudflaredIfEnabled: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

const flushBackgroundWork = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("startBackgroundJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts scheduler, metadata backfill and cloudflared bootstrap", async () => {
    startBackgroundJobs(3000);
    await flushBackgroundWork();

    expect(subscriptionService.startScheduler).toHaveBeenCalledTimes(1);
    expect(metadataService.backfillDurations).toHaveBeenCalledTimes(1);
    expect(startCloudflaredIfEnabled).toHaveBeenCalledWith(3000);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs subscription startup failure and keeps other jobs running", async () => {
    const startSchedulerError = new Error("subscription boom");
    vi.mocked(subscriptionService.startScheduler).mockImplementation(() => {
      throw startSchedulerError;
    });

    startBackgroundJobs(8080);
    await flushBackgroundWork();

    expect(metadataService.backfillDurations).toHaveBeenCalledTimes(1);
    expect(startCloudflaredIfEnabled).toHaveBeenCalledWith(8080);
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to start subscription service:",
      startSchedulerError
    );
  });

  it("logs metadata startup failure", async () => {
    const metadataError = new Error("metadata boom");
    vi.mocked(metadataService.backfillDurations).mockImplementation(() => {
      throw metadataError;
    });

    startBackgroundJobs(9090);
    await flushBackgroundWork();

    expect(subscriptionService.startScheduler).toHaveBeenCalledTimes(1);
    expect(startCloudflaredIfEnabled).toHaveBeenCalledWith(9090);
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to start metadata service:",
      metadataError
    );
  });
});
