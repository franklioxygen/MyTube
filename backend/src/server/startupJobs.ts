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

  startCloudflaredIfEnabled(port);
};
