import { beforeEach, describe, expect, it, vi } from "vitest";
import { startBackgroundJobs } from "../../server/startupJobs";
import { subscriptionService } from "../../services/subscriptionService";
import * as metadataService from "../../services/metadataService";
import { startCloudflaredIfEnabled } from "../../server/cloudRoutes";
import { startTelegramDownloadPolling } from "../../services/telegramDownloadService";
import { logger } from "../../utils/logger";

vi.mock("../../services/subscriptionService", () => ({
  subscriptionService: {
    startScheduler: vi.fn(),
  },
}));

vi.mock("../../services/metadataService", () => ({
  backfillDurations: vi.fn(),
  backfillVideoDimensions: vi.fn(),
}));

vi.mock("../../server/cloudRoutes", () => ({
  startCloudflaredIfEnabled: vi.fn(),
}));

vi.mock("../../services/telegramDownloadService", () => ({
  startTelegramDownloadPolling: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const flushBackgroundWork = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const startSchedulerMock = vi.mocked(subscriptionService.startScheduler);
const backfillDurationsMock = vi.mocked(metadataService.backfillDurations);
const backfillVideoDimensionsMock = vi.mocked(metadataService.backfillVideoDimensions);
const startCloudflaredIfEnabledMock = vi.mocked(startCloudflaredIfEnabled);
const startTelegramDownloadPollingMock = vi.mocked(startTelegramDownloadPolling);
const loggerErrorMock = vi.mocked(logger.error);

describe("startBackgroundJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts scheduler, metadata backfill, telegram polling and cloudflared bootstrap", async () => {
    startBackgroundJobs(3000);
    await flushBackgroundWork();

    expect(startSchedulerMock).toHaveBeenCalledTimes(1);
    expect(backfillDurationsMock).toHaveBeenCalledTimes(1);
    expect(backfillVideoDimensionsMock).toHaveBeenCalledTimes(1);
    expect(startTelegramDownloadPollingMock).toHaveBeenCalledTimes(1);
    expect(startCloudflaredIfEnabledMock).toHaveBeenCalledWith(3000);
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it("logs subscription startup failure and keeps other jobs running", async () => {
    const startSchedulerError = new Error("subscription boom");
    startSchedulerMock.mockImplementation(() => {
      throw startSchedulerError;
    });

    startBackgroundJobs(8080);
    await flushBackgroundWork();

    expect(backfillDurationsMock).toHaveBeenCalledTimes(1);
    expect(startCloudflaredIfEnabledMock).toHaveBeenCalledWith(8080);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "Failed to start subscription service:",
      startSchedulerError
    );
  });

  it("logs metadata startup failure", async () => {
    const metadataError = new Error("metadata boom");
    backfillDurationsMock.mockImplementation(() => {
      throw metadataError;
    });

    startBackgroundJobs(9090);
    await flushBackgroundWork();

    expect(startSchedulerMock).toHaveBeenCalledTimes(1);
    expect(startCloudflaredIfEnabledMock).toHaveBeenCalledWith(9090);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "Failed to start metadata service:",
      metadataError
    );
  });
});
