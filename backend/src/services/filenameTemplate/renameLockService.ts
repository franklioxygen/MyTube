/**
 * Process-wide mutex to prevent downloads from running during a batch rename job.
 * The lock is acquired before the rename job starts, and released when the job
 * completes, fails, or is cancelled.
 *
 * This lock is intentionally in-memory only. It coordinates a single Node.js
 * process, but it is not shared across restarts or horizontally scaled app
 * instances.
 */

let renameJobId: string | null = null;
let lockedAt: number | null = null;

export function acquireRenameLock(jobId: string): boolean {
  if (renameJobId !== null) {
    return false;
  }
  renameJobId = jobId;
  lockedAt = Date.now();
  return true;
}

export function releaseRenameLock(): void {
  renameJobId = null;
  lockedAt = null;
}

export function isRenameLockActive(): boolean {
  return renameJobId !== null;
}

export function getRenameLockInfo(): { jobId: string; lockedAt: number } | null {
  if (renameJobId === null || lockedAt === null) return null;
  return { jobId: renameJobId, lockedAt };
}

/**
 * Throws a structured error if a rename job is active, preventing new downloads.
 * Call this from every download trigger path.
 */
export function assertDownloadsAllowed(): void {
  if (renameJobId !== null) {
    const err = new Error(
      "A file rename job is in progress. New downloads are temporarily blocked until the rename finishes."
    );
    (err as any).code = "filename_rename_in_progress";
    (err as any).lockedAt = lockedAt;
    throw err;
  }
}
