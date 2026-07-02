import { sanitizeLogMessage } from "../../utils/logger";
import { HookService } from "../hookService";
import {
  CANCEL_TASK_WAIT_TIMEOUT_MS,
  TASK_FAIL_HOOK_WAIT_TIMEOUT_MS,
} from "./types";
import { logger } from "../../utils/logger";

export async function awaitTaskFailHook(
  context: Record<string, string | undefined>,
): Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    await Promise.race([
      HookService.executeHook("task_fail", context),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          logger.warn(
            `task_fail hook exceeded ${TASK_FAIL_HOOK_WAIT_TIMEOUT_MS}ms; continuing task failure handling.`
          );
          resolve();
        }, TASK_FAIL_HOOK_WAIT_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    logger.error("task_fail hook failed:", error);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function awaitTaskCancellationHook(
  taskId: string,
  cancelFn: () => void | Promise<void>,
): Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    await Promise.race([
      Promise.resolve().then(() => cancelFn()),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          logger.warn(
            `Cancel hook for download ${sanitizeLogMessage(taskId)} exceeded ${CANCEL_TASK_WAIT_TIMEOUT_MS}ms; finalizing cancellation anyway.`
          );
          resolve();
        }, CANCEL_TASK_WAIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
