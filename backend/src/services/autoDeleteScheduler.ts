import cron, { ScheduledTask } from "node-cron";
import { logger } from "../utils/logger";
import { runAutoDeleteSweep } from "./autoDeleteService";
import * as storageService from "./storageService";

const FOLLOWUP_DELAY_MS = 5 * 60 * 1000;
const CATCHUP_DELAY_MS = 60_000;
const STALE_RUN_MS = 24 * 60 * 60 * 1000;

let dailyTask: ScheduledTask | null = null;
let catchupTimer: ReturnType<typeof setTimeout> | null = null;
let followupTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerGeneration = 0;

function logSweepError(error: unknown): void {
  logger.error(
    "Auto-delete sweep failed:",
    error instanceof Error ? error : new Error(String(error))
  );
}

async function runAndScheduleFollowup(generation: number): Promise<void> {
  const summary = await runAutoDeleteSweep();
  // Only chain a follow-up when this run belongs to the current generation, the
  // scheduler is still active, the run was capped, and no follow-up is pending.
  if (
    generation !== schedulerGeneration ||
    dailyTask === null ||
    !summary.capped ||
    followupTimer !== null
  ) {
    return;
  }

  followupTimer = setTimeout(() => {
    followupTimer = null;
    void runAndScheduleFollowup(generation).catch(logSweepError);
  }, FOLLOWUP_DELAY_MS);
}

export function startAutoDeleteScheduler(): void {
  if (dailyTask !== null) {
    return; // idempotent under repeated startup calls/tests
  }
  const generation = ++schedulerGeneration;

  // Daily at 03:00 server local time.
  dailyTask = cron.schedule("0 3 * * *", () => {
    void runAndScheduleFollowup(generation).catch(logSweepError);
  });
  logger.info("Auto-delete scheduler started (node-cron, 03:00 daily).");

  // Boot-time catch-up: if the last successful sweep was >24h ago (or never)
  // and the feature is enabled, run once shortly after boot so downtime over
  // 03:00 does not skip enforcement. Delayed to let the app settle.
  catchupTimer = setTimeout(() => {
    catchupTimer = null;
    try {
      const settings = storageService.getSettings();
      if (!settings.autoDeleteEnabled) {
        return;
      }
      const last = settings.autoDeleteLastRunAt ?? 0;
      if (Date.now() - last >= STALE_RUN_MS) {
        void runAndScheduleFollowup(generation).catch(logSweepError);
      }
    } catch (e) {
      logger.warn(
        "Auto-delete catch-up check failed",
        e instanceof Error ? e : new Error(String(e))
      );
    }
  }, CATCHUP_DELAY_MS);
}

export function stopAutoDeleteScheduler(): void {
  schedulerGeneration += 1; // prevents an in-flight old run from scheduling more work
  dailyTask?.stop();
  dailyTask = null;
  if (catchupTimer !== null) {
    clearTimeout(catchupTimer);
  }
  if (followupTimer !== null) {
    clearTimeout(followupTimer);
  }
  catchupTimer = null;
  followupTimer = null;
}
