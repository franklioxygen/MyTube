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
      void Promise.resolve(service.backfillDurations()).then(() =>
        service.backfillVideoDimensions()
      );
    })
    .catch((error) => {
      logger.error(
        "Failed to start metadata service:",
        error instanceof Error ? error : new Error(String(error))
      );
    });

  // Download-history retention (opt-in via downloadHistoryRetentionDays):
  // prune shortly after boot, then daily. No-op while the setting is 0/unset.
  import("../services/storageService")
    .then((storage) => {
      const runHistoryPrune = () => {
        try {
          storage.pruneDownloadHistory();
        } catch (error) {
          logger.error(
            "Download history retention prune failed:",
            error instanceof Error ? error : new Error(String(error))
          );
        }
      };
      setTimeout(runHistoryPrune, 30_000);
      setInterval(runHistoryPrune, 24 * 60 * 60 * 1000);
    })
    .catch((error) => {
      logger.error(
        "Failed to schedule download history retention:",
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
