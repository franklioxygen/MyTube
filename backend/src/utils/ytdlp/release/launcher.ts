import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { AsyncLocalStorage } from "async_hooks";
import { logger } from "../../logger";
import { createOperationId } from "./ids";
import { acquireLease, releaseLease } from "./leases";
import { acquireYtDlpRelease, createExternalRelease } from "./acquire";
import { resolveYtDlpPath } from "../pathResolver";
import { DEFAULT_YT_DLP_PATH } from "../constants";
import { collectGarbageIfDue } from "./gc";
import type { YtDlpRelease } from "./types";

type TrackedChild = {
  child: ChildProcess;
  /** True once the OS reported a running process for this child. */
  spawned: boolean;
};

type ReleaseScope = {
  release: YtDlpRelease;
  operationId: string;
  leaseFilename: string | null;
  children: Map<ChildProcess, TrackedChild>;
};

const scopeStorage = new AsyncLocalStorage<ReleaseScope>();

/**
 * A release may be garbage-collected between reading current.json and writing
 * the lease. The reader retries with a freshly acquired release rather than
 * failing the operation.
 */
const LEASE_ACQUISITION_ATTEMPTS = 3;

export type SpawnYtDlpOptions = Omit<SpawnOptions, "env" | "shell"> & {
  timeoutMs?: number;
};

export async function withYtDlpRelease<T>(
  task: (release: YtDlpRelease) => Promise<T>
): Promise<T> {
  // A nested call belongs to the same logical operation, so it reuses the
  // snapshot (and its lease) instead of acquiring a possibly newer release.
  const existing = scopeStorage.getStore();
  if (existing) {
    return task(existing.release);
  }

  const { release, lease } = await acquireReleaseWithLease();
  const scope: ReleaseScope = {
    release,
    operationId: lease?.operationId ?? createOperationId(),
    leaseFilename: lease?.leaseFilename ?? null,
    children: new Map(),
  };

  try {
    return await scopeStorage.run(scope, () => task(release));
  } finally {
    await waitForChildren(scope);
    if (lease) {
      // Cleanup runs in a finally, so anything thrown here would replace the
      // task's result: a download that succeeded would be reported as failed
      // purely because its lease could not be deleted. A leaked lease costs
      // disk, which is the lesser problem by far.
      try {
        releaseLease(lease.releaseId, lease.leaseFilename);
      } catch (error: unknown) {
        logger.warn(
          `[yt-dlp] Could not release the lease on ${lease.releaseId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      // Never awaited: collection is best-effort maintenance, not part of the
      // operation's result.
      try {
        collectGarbageIfDue();
      } catch {
        // Same reasoning: maintenance never changes an operation's outcome.
      }
    }
  }
}

async function acquireReleaseWithLease(): Promise<{
  release: YtDlpRelease;
  lease: {
    releaseId: string;
    leaseFilename: string;
    operationId: string;
  } | null;
}> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= LEASE_ACQUISITION_ATTEMPTS; attempt += 1) {
    const release = await acquireYtDlpRelease({ ensureAvailable: true });
    // MyTube neither collects nor guarantees immutability for files it does
    // not own, so external releases are never leased.
    if (release.kind !== "managed") {
      return { release, lease: null };
    }
    const operationId = createOperationId();
    try {
      const lease = acquireLease(release.releaseId, operationId);
      return { release, lease: { ...lease, operationId } };
    } catch (error: unknown) {
      lastError = error;
      logger.warn(
        `[yt-dlp] Could not lease release ${release.releaseId} (attempt ${attempt}/${LEASE_ACQUISITION_ATTEMPTS}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  // The store cannot hand out leases at all - unwritable, symlinked, or being
  // collected out from under every attempt. That is a store problem, and a
  // store problem must degrade rather than fail every operation, so fall back
  // to discovery exactly as an unusable store does elsewhere.
  logger.warn(
    `[yt-dlp] Could not lease a managed release (${
      lastError instanceof Error ? lastError.message : String(lastError)
    }); falling back to external discovery.`
  );
  const resolvedPath = await resolveYtDlpPath();
  return {
    release: await createExternalRelease(resolvedPath || DEFAULT_YT_DLP_PATH),
    lease: null,
  };
}

export function spawnYtDlp(
  release: YtDlpRelease,
  args: readonly string[],
  options: SpawnYtDlpOptions = {}
): ChildProcess {
  const { timeoutMs: _ignoredTimeoutMs, stdio, ...spawnOptions } = options;
  const child = spawn(release.command, [...release.prefixArgs, ...args], {
    ...spawnOptions,
    // The snapshot environment is not overridable: a caller-supplied env would
    // break the guarantee that every child of this operation runs the same
    // release with the same module path.
    env: release.spawnEnv,
    shell: false,
    windowsHide: true,
    stdio: stdio ?? ["ignore", "pipe", "pipe"],
  });
  trackChild(child);
  return child;
}

function trackChild(child: ChildProcess): void {
  if (!child || typeof child.once !== "function") {
    return;
  }
  const scope = scopeStorage.getStore();
  if (!scope) {
    return;
  }
  const tracked: TrackedChild = { child, spawned: false };
  scope.children.set(child, tracked);
  child.once("spawn", () => {
    tracked.spawned = true;
  });
  child.once("error", () => {
    // An error before "spawn" means startup failed and there is no process to
    // protect. After "spawn" the process may well still be running, so the
    // lease must survive until "close".
    if (!tracked.spawned) {
      scope.children.delete(child);
    }
  });
  child.once("close", () => {
    scope.children.delete(child);
  });
}

function waitForChildren(scope: ReleaseScope): Promise<void> {
  const tracked = [...scope.children.values()].filter(
    (entry) => typeof entry.child.once === "function"
  );
  if (tracked.length === 0) {
    return Promise.resolve();
  }
  return Promise.all(
    tracked.map(
      (entry) =>
        new Promise<void>((resolve) => {
          // `killed` only records that a signal was delivered — the process can
          // still be reading from its release — so only a real exit counts.
          if (entry.child.exitCode != null || entry.child.signalCode != null) {
            resolve();
            return;
          }
          entry.child.once("close", () => resolve());
          entry.child.once("error", () => {
            if (!entry.spawned) {
              resolve();
            }
          });
        })
    )
  ).then(() => undefined);
}

export function getScopedYtDlpRelease(): YtDlpRelease | undefined {
  return scopeStorage.getStore()?.release;
}
