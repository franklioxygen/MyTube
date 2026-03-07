import dotenv from "dotenv";
dotenv.config();

import os from "os";
import { v4 as uuidv4 } from "uuid";
import {
  HookWorkerJobPayload,
  claimNextHookWorkerJob,
  cleanupOldHookWorkerJobs,
  logHookWorkerQueueStats,
  markHookWorkerJobCompleted,
  markHookWorkerJobFailed,
} from "../services/hookWorkerQueueService";
import {
  executeNotifyWebhookAction,
  parseNotifyWebhookAction,
} from "../services/webhookExecutor";
import { logger } from "../utils/logger";

const parsePositiveIntEnv = (
  raw: string | undefined,
  fallback: number
): number => {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const pollIntervalMs = parsePositiveIntEnv(
  process.env.HOOK_WORKER_POLL_INTERVAL_MS,
  1000
);
const maxJobsPerProcess = parsePositiveIntEnv(
  process.env.HOOK_WORKER_MAX_JOBS_PER_PROCESS,
  25
);
const idleExitMs = parsePositiveIntEnv(
  process.env.HOOK_WORKER_IDLE_EXIT_MS,
  120_000
);

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const executeHookJobPayload = async (payload: HookWorkerJobPayload): Promise<void> => {
  for (const rawAction of payload.config.actions) {
    if (!rawAction || typeof rawAction !== "object") {
      throw new Error("Invalid hook action payload");
    }
    const action = parseNotifyWebhookAction(rawAction);
    await executeNotifyWebhookAction(
      {
        ...payload.context,
        eventName: payload.eventName,
      },
      action
    );
  }
};

const workerId = `hook-worker-${os.hostname()}-${process.pid}-${uuidv4()}`;

const run = async (): Promise<void> => {
  logger.info(
    `[HookWorker] started with workerId=${workerId}, poll=${pollIntervalMs}ms, maxJobs=${maxJobsPerProcess}, idleExit=${idleExitMs}ms`
  );
  let processedCount = 0;
  let lastActiveAt = Date.now();
  let loops = 0;

  while (true) {
    const job = claimNextHookWorkerJob(workerId);
    if (!job) {
      loops += 1;
      if (loops % 60 === 0) {
        const cleaned = cleanupOldHookWorkerJobs();
        if (cleaned > 0) {
          logger.info(`[HookWorker] cleaned ${cleaned} old queue records`);
        }
        logHookWorkerQueueStats();
      }
      if (Date.now() - lastActiveAt >= idleExitMs) {
        logger.info(
          `[HookWorker] idle timeout reached (${idleExitMs}ms), exiting`
        );
        return;
      }
      await sleep(pollIntervalMs);
      continue;
    }

    loops = 0;
    lastActiveAt = Date.now();
    try {
      await executeHookJobPayload(job.payload);
      markHookWorkerJobCompleted(job.id);
      processedCount += 1;
      logger.info(
        `[HookWorker] processed job ${job.id} (${processedCount}/${maxJobsPerProcess})`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markHookWorkerJobFailed(job.id, message, true);
      logger.error(`[HookWorker] job ${job.id} failed`, new Error(message));
    }

    if (processedCount >= maxJobsPerProcess) {
      logger.info(
        `[HookWorker] max jobs per process reached (${maxJobsPerProcess}), exiting`
      );
      return;
    }
  }
};

void run().catch((error) => {
  logger.error(
    "[HookWorker] fatal error",
    error instanceof Error ? error : new Error(String(error))
  );
  process.exit(1);
});
