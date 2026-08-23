import type { ChildProcess } from "child_process";
import { YT_DLP_UPDATE_DRAIN_TIMEOUT_MS } from "./constants";
import { logger } from "../logger";

/**
 * Coordination between in-place pip updates and running yt-dlp processes.
 *
 * A pip upgrade rewrites the files of the very installation yt-dlp is launched
 * from. A process that starts mid-upgrade can fail to exec (the console script
 * is briefly absent) or blow up on a lazy import of a module being replaced, so
 * an otherwise valid download fails for reasons the user cannot act on.
 *
 * Serializing pip against itself is not enough — that only orders the writers.
 * This gate is the reader side: while an update holds it, new executions wait,
 * and the update first gives the ones already running a bounded chance to
 * finish.
 */

// Non-null while an update holds the gate; resolves when the update releases.
let updateHold: Promise<void> | null = null;
let activeExecutions = 0;
let idleWaiters: Array<() => void> = [];

function notifyIdleWaiters(): void {
  if (activeExecutions > 0) {
    return;
  }

  const waiters = idleWaiters;
  idleWaiters = [];
  waiters.forEach((resolve) => resolve());
}

/**
 * Wait until no update is replacing the installation. Call immediately before
 * spawning yt-dlp — a check any earlier can go stale while the caller is still
 * assembling arguments.
 */
export async function awaitYtDlpExecutionSlot(): Promise<void> {
  while (updateHold) {
    await updateHold;
  }
}

/**
 * Count a spawned process as in flight until it closes, so an update can tell
 * whether anything is still running against the installation.
 */
export function registerYtDlpExecution(subprocess: ChildProcess): void {
  activeExecutions += 1;

  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    activeExecutions -= 1;
    notifyIdleWaiters();
  };

  subprocess.once("close", release);
  subprocess.once("error", release);
}

export function getActiveYtDlpExecutionCount(): number {
  return activeExecutions;
}

async function waitForExecutionsToDrain(timeoutMs: number): Promise<boolean> {
  if (activeExecutions === 0) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (drained: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(drained);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    idleWaiters.push(() => finish(true));
  });
}

/**
 * Hold the gate for the duration of `task`, blocking new yt-dlp executions.
 *
 * Processes already running are given `drainTimeoutMs` to finish first. The
 * wait is deliberately bounded and non-fatal: an operator updates yt-dlp
 * precisely when downloads are failing, so a long-running job must not be able
 * to postpone the fix indefinitely. Whatever is still running when the timeout
 * expires keeps running, and the update proceeds.
 */
export async function withYtDlpExecutionsSuspended<T>(
  task: () => Promise<T>,
  options: { drainTimeoutMs?: number } = {}
): Promise<T> {
  const { drainTimeoutMs = YT_DLP_UPDATE_DRAIN_TIMEOUT_MS } = options;

  while (updateHold) {
    await updateHold;
  }

  // No await between the check above and this assignment, so two callers
  // cannot both claim the gate.
  let release!: () => void;
  updateHold = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    const drained = await waitForExecutionsToDrain(drainTimeoutMs);
    if (!drained) {
      logger.warn(
        `[yt-dlp] ${activeExecutions} yt-dlp process(es) still running after ${Math.round(drainTimeoutMs / 1000)}s. Proceeding with the update; those processes may fail and need a retry.`
      );
    }

    return await task();
  } finally {
    updateHold = null;
    release();
  }
}

/**
 * @internal Test helper to clear gate state between test cases.
 */
export function resetYtDlpExecutionGate(): void {
  updateHold = null;
  activeExecutions = 0;
  idleWaiters = [];
}
