import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { beforeEach, describe, expect, it } from "vitest";
import {
  awaitYtDlpExecutionSlot,
  getActiveYtDlpExecutionCount,
  registerYtDlpExecution,
  resetYtDlpExecutionGate,
  withYtDlpExecutionsSuspended,
} from "../../utils/ytdlp/executionGate";

const createProcess = () => new EventEmitter() as unknown as ChildProcess;
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe("yt-dlp execution gate", () => {
  beforeEach(() => {
    resetYtDlpExecutionGate();
  });

  it("blocks new executions while an update holds the gate", async () => {
    let releaseTask!: () => void;
    const taskRunning = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });

    const update = withYtDlpExecutionsSuspended(() => taskRunning);
    let slotAcquired = false;
    const waiting = awaitYtDlpExecutionSlot().then(() => {
      slotAcquired = true;
    });

    await flush();
    expect(slotAcquired).toBe(false);

    releaseTask();
    await update;
    await waiting;
    expect(slotAcquired).toBe(true);
  });

  it("waits for running executions to finish before replacing the install", async () => {
    const subprocess = createProcess();
    registerYtDlpExecution(subprocess);
    expect(getActiveYtDlpExecutionCount()).toBe(1);

    let taskStarted = false;
    const update = withYtDlpExecutionsSuspended(async () => {
      taskStarted = true;
    });

    await flush();
    expect(taskStarted).toBe(false);

    subprocess.emit("close", 0);
    await update;
    expect(taskStarted).toBe(true);
    expect(getActiveYtDlpExecutionCount()).toBe(0);
  });

  it("proceeds once the drain timeout expires so a long download cannot block the fix", async () => {
    registerYtDlpExecution(createProcess());

    let taskStarted = false;
    await withYtDlpExecutionsSuspended(
      async () => {
        taskStarted = true;
      },
      { drainTimeoutMs: 5 }
    );

    expect(taskStarted).toBe(true);
    // The long-running process is left alone rather than killed.
    expect(getActiveYtDlpExecutionCount()).toBe(1);
  });

  it("releases the gate when the update fails", async () => {
    await expect(
      withYtDlpExecutionsSuspended(async () => {
        throw new Error("pip failed");
      })
    ).rejects.toThrow("pip failed");

    // A failed update must not leave executions blocked forever.
    await expect(awaitYtDlpExecutionSlot()).resolves.toBeUndefined();
  });

  it("stops counting an execution that errors instead of closing", async () => {
    const subprocess = createProcess();
    registerYtDlpExecution(subprocess);

    subprocess.emit("error", new Error("spawn ENOENT"));
    expect(getActiveYtDlpExecutionCount()).toBe(0);

    // A later close on the same process must not double-decrement.
    subprocess.emit("close", 1);
    expect(getActiveYtDlpExecutionCount()).toBe(0);
  });

  it("serializes two updates instead of overlapping them", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstRunning = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withYtDlpExecutionsSuspended(async () => {
      order.push("first:start");
      await firstRunning;
      order.push("first:end");
    });
    const second = withYtDlpExecutionsSuspended(async () => {
      order.push("second:start");
    });

    await flush();
    expect(order).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });
});
