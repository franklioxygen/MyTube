import { logger } from "../utils/logger";
import { startCloudflaredIfEnabled } from "./cloudRoutes";

export const startBackgroundJobs = (port: number): void => {
  import("../services/subscriptionService")
    .then(({ subscriptionService }) => {
      subscriptionService.startScheduler();
    })
    .catch((error) => {
      logger.error(
        "Failed to start subscription service:",
        error instanceof Error ? error : new Error(String(error))
      );
    });

  import("../services/metadataService")
    .then((service) => {
      void service.backfillDurations();
    })
    .catch((error) => {
      logger.error(
        "Failed to start metadata service:",
        error instanceof Error ? error : new Error(String(error))
      );
    });

  // Statistics rollup + retention workers and the alert dispatch loop.
  import("../services/statistics")
    .then((statistics) => {
      try {
        statistics.startRollupWorker();
        statistics.startRetentionWorker();
      } catch (error) {
        logger.warn(
          "Failed to start statistics workers",
          error instanceof Error ? error : new Error(String(error))
        );
      }
    })
    .catch((error) => {
      logger.warn(
        "Failed to load statistics service",
        error instanceof Error ? error : new Error(String(error))
      );
    });

  import("../services/statisticsAlertDispatcher")
    .then(({ startStatisticsAlertDispatcher }) => {
      try {
        startStatisticsAlertDispatcher();
      } catch (error) {
        logger.warn(
          "Failed to start statistics alert dispatcher",
          error instanceof Error ? error : new Error(String(error))
        );
      }
    })
    .catch(() => {
      // Optional module; tolerate absence.
    });

  import("../services/telegramDownloadService")
    .then(({ startTelegramDownloadPolling }) => {
      try {
        startTelegramDownloadPolling();
      } catch (error) {
        logger.warn(
          "Failed to start Telegram download polling",
          error instanceof Error ? error : new Error(String(error))
        );
      }
    })
    .catch((error) => {
      logger.warn(
        "Failed to load Telegram download service",
        error instanceof Error ? error : new Error(String(error))
      );
    });

  startCloudflaredIfEnabled(port);
};
