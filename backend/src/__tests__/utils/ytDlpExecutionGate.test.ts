import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import type { ChildProcess } from "child_process";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acquireYtDlpExecutionSlot,
  getActiveYtDlpExecutionCount,
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
    const waiting = acquireYtDlpExecutionSlot().then((slot) => {
      slotAcquired = true;
      slot.release();
    });

    await flush();
    expect(slotAcquired).toBe(false);

    releaseTask();
    await update;
    await waiting;
    expect(slotAcquired).toBe(true);
  });

  it("counts the reader before yielding, so an update cannot slip in behind it", async () => {
    // The window this closes: a caller that observed a free gate but had not
    // yet registered would let an update see zero active executions, skip the
    // drain, and start pip just as the caller spawned.
    const slotPromise = acquireYtDlpExecutionSlot();
    expect(getActiveYtDlpExecutionCount()).toBe(1);

    let taskStarted = false;
    const update = withYtDlpExecutionsSuspended(async () => {
      taskStarted = true;
    });

    await flush();
    expect(taskStarted).toBe(false);

    (await slotPromise).release();
    await update;
    expect(taskStarted).toBe(true);
  });

  it("waits for running executions to finish before replacing the install", async () => {
    const subprocess = createProcess();
    (await acquireYtDlpExecutionSlot()).bindTo(subprocess);
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
    (await acquireYtDlpExecutionSlot()).bindTo(createProcess());

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
    const slot = await acquireYtDlpExecutionSlot();
    slot.release();
  });

  it("stops counting an execution that errors instead of closing", async () => {
    const subprocess = createProcess();
    (await acquireYtDlpExecutionSlot()).bindTo(subprocess);

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

// Every yt-dlp process must go through the gate, or an update replaces the
// installation underneath it. MissAVDownloader spawned yt-dlp directly and was
// missed when the gate was first wired, so pin the inventory: adding a spawn
// anywhere new forces a deliberate decision about the gate.
describe("yt-dlp spawn inventory", () => {
  const SPAWN_ALLOWLIST = [
    // Gated yt-dlp executions.
    "services/downloaders/MissAVDownloader.ts",
    "utils/ytdlp/execute.ts",
    // Deliberately ungated: the update itself probes the binary before and
    // after installing, so gating these would deadlock.
    "utils/ytdlp/runtime.ts",
    "utils/ytdlp/versionProbe.ts",
    // pip itself, serialized by its own queue, and an unrelated binary.
    "utils/ytdlp/install.ts",
    "services/cloudflaredService.ts",
  ].sort();

  const listSourceFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : listSourceFiles(full);
      }
      return entry.isFile() && full.endsWith(".ts") ? [full] : [];
    });

  it("has no spawn call outside the reviewed set", () => {
    const srcRoot = path.resolve(__dirname, "../..");
    const spawners = listSourceFiles(srcRoot)
      .filter((file) => /(?<![A-Za-z])spawn\(/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(srcRoot, file).split(path.sep).join("/"))
      .sort();

    expect(spawners).toEqual(SPAWN_ALLOWLIST);
  });
});
