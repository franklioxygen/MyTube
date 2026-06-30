import cron, { ScheduledTask } from "node-cron";
import { logger } from "../../utils/logger";
import { runSubscriptionRetentionCleanup } from "../subscriptionRetentionService";

export interface SubscriptionSchedulerTasks {
  checkTask: ScheduledTask;
  retentionCleanupTask: ScheduledTask;
}

export function stopSubscriptionSchedulerTasks(tasks: {
  checkTask: ScheduledTask | null;
  retentionCleanupTask: ScheduledTask | null;
}): void {
  tasks.checkTask?.stop();
  tasks.retentionCleanupTask?.stop();
}

export function createSubscriptionSchedulerTasks(
  checkSubscriptions: () => Promise<void>
): SubscriptionSchedulerTasks {
  const checkTask = cron.schedule("* * * * *", () => {
    checkSubscriptions().catch((error) => {
      logger.error("Subscription scheduler tick failed:", error);
    });
  });
  logger.info("Subscription scheduler started (node-cron).");

  const retentionCleanupTask = cron.schedule("0 * * * *", () => {
    runSubscriptionRetentionCleanup().catch((error) => {
      logger.error(
        "Subscription retention cleanup failed:",
        error instanceof Error ? error : new Error(String(error))
      );
    });
  });
  logger.info("Subscription retention scheduler started (node-cron).");

  return { checkTask, retentionCleanupTask };
}
