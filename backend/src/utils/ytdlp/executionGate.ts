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
 *
 * Every spawn of the yt-dlp binary belongs here, wherever it lives — a
 * downloader that reaches for `spawn` on its own is exactly the case this
 * cannot protect. The one deliberate exception is the version and capability
 * probes: the update itself probes the binary before and after installing, so
 * gating those would deadlock. `ytDlpExecutionGate.test.ts` pins the inventory
 * of spawn sites so a new one has to be a deliberate decision.
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

export interface YtDlpExecutionSlot {
  /** Hold the slot until this process closes or fails to start. */
  bindTo(subprocess: ChildProcess): void;
  /** Give the slot back without a process — for a caller that bails out. */
  release(): void;
}

/**
 * Reserve the right to run yt-dlp, waiting out any update in progress.
 *
 * Waiting and counting are one step on purpose. If a caller could observe a
 * free gate and only count itself later, an update claiming the gate in that
 * window would see zero active executions, skip the drain, and start pip while
 * the caller was about to spawn — the exact overlap this module exists to
 * prevent. The counter is therefore incremented in the same synchronous step
 * as the check that found the gate free, before this function yields.
 *
 * Call it immediately before spawning: the returned slot is already counted, so
 * anything between here and the spawn holds an update off.
 */
export async function acquireYtDlpExecutionSlot(): Promise<YtDlpExecutionSlot> {
  while (updateHold) {
    await updateHold;
  }

  // No await between the check above and this increment.
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

  return {
    release,
    bindTo(subprocess: ChildProcess) {
      // "close" is the terminal event in both outcomes: it fires after a normal
      // exit, and also after a spawn failure (verified on Node 22 — ENOENT
      // emits "error" then "close"). Binding it alone therefore never leaks.
      subprocess.once("close", release);

      // "error" is not terminal. Node also emits it for a process that is
      // already running — a kill that fails, or a failed IPC send. Releasing on
      // those would show an update a drained gate while yt-dlp is still alive
      // and let pip rewrite the installation underneath it. Treat "error" as
      // terminal only when the child never started, which is exactly when it
      // has no pid; that case is belt-and-braces for a platform that might not
      // follow the failure with "close".
      subprocess.once("error", () => {
        if (subprocess.pid === undefined) {
          release();
        }
      });
    },
  };
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
