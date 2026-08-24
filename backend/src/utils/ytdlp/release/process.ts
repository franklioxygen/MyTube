import { spawn, spawnSync, type ChildProcess } from "child_process";

export type RunProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RunProcessOptions = {
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  cwd?: string;
  stdin?: "ignore" | "pipe";
};

const OUTPUT_LIMIT_BYTES = 1024 * 1024;
/** How long a child gets to exit after SIGTERM before SIGKILL. */
const SIGKILL_GRACE_MS = 1000;
/** How long to wait for "close" after SIGKILL before giving up on the child. */
const ABANDON_GRACE_MS = 5000;

export function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions
): Promise<RunProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;
    let abandonTimer: NodeJS.Timeout | null = null;

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: [options.stdin ?? "ignore", "pipe", "pipe"],
      // Give the child its own process group so a timeout can terminate what it
      // launched - pip spawns build and download helpers, and signalling only
      // the interpreter leaves those running against the staging directory we
      // are about to delete. Windows has no usable process groups here; the
      // kill path uses taskkill /T instead.
      detached: process.platform !== "win32",
    });

    const finish = (result: RunProcessResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (abandonTimer) {
        clearTimeout(abandonTimer);
      }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
      killTimer = setTimeout(() => {
        killProcessTree(child, "SIGKILL");
        // Last resort. "close" waits for the stdio streams to close, which a
        // grandchild that inherited the pipes can hold open long after the
        // child itself is gone. Every caller runs under a lock or an in-flight
        // dedup, so a promise that never settles would wedge updates for the
        // life of the process; report the timeout instead.
        abandonTimer = setTimeout(() => {
          // No signal is reported: we stopped waiting rather than observing an
          // exit, and claiming SIGKILL here would be indistinguishable from a
          // child that really was killed.
          finish({ code: null, signal: null, stdout, stderr, timedOut });
        }, ABANDON_GRACE_MS);
        abandonTimer.unref?.();
      }, SIGKILL_GRACE_MS);
      killTimer.unref?.();
    }, options.timeoutMs);
    timeout.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        code: null,
        signal: null,
        stdout,
        stderr: stderr || error.message,
        timedOut,
      });
    });
    child.on("close", (code, signal) => {
      finish({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function appendLimited(current: string, next: string): string {
  const combined = current + next;
  if (combined.length <= OUTPUT_LIMIT_BYTES) {
    return combined;
  }
  return combined.slice(combined.length - OUTPUT_LIMIT_BYTES);
}

function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM"
): void {
  // `child.killed` only records that a signal was successfully *sent*, so it is
  // already true after SIGTERM. Gating on it would make the SIGKILL escalation
  // below a silent no-op against a process that ignores SIGTERM. Only a real
  // exit means there is nothing left to signal.
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    try {
      // /T walks the tree, /F forces it. Windows offers no signal semantics,
      // so this is the only way to reach descendants.
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    } catch {
      // Fall back to signalling the child alone.
    }
  } else {
    try {
      // A negative pid targets the whole group created by `detached`.
      process.kill(-pid, signal);
      return;
    } catch {
      // The group may already be gone; fall back to the child alone.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // Already exited, or the pid is gone.
  }
}
