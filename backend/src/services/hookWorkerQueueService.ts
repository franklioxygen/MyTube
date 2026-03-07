import { v4 as uuidv4 } from "uuid";
import { sqlite } from "../db";
import {
  HOOK_WORKER_JOBS_SCHEMA,
  ensureSqliteTableSchema,
} from "../db/sqliteStorageSchemas";
import { logger } from "../utils/logger";

export interface HookWorkerJobPayload {
  eventName: string;
  context: Record<string, string | undefined>;
  config: {
    version: number;
    actions: unknown[];
  };
}

export interface HookWorkerJob {
  id: string;
  payload: HookWorkerJobPayload;
  attemptCount: number;
  maxAttempts: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 5_000;

let queueStorageInitialized = false;

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

const getMaxAttempts = (): number =>
  parsePositiveIntEnv(process.env.HOOK_WORKER_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS);

const getLeaseMs = (): number =>
  parsePositiveIntEnv(process.env.HOOK_WORKER_LEASE_MS, DEFAULT_LEASE_MS);

const getRetryBaseDelayMs = (): number =>
  parsePositiveIntEnv(
    process.env.HOOK_WORKER_RETRY_BASE_DELAY_MS,
    DEFAULT_RETRY_BASE_DELAY_MS
  );

const ensureHookWorkerQueueStorage = (): void => {
  if (queueStorageInitialized) {
    return;
  }

  ensureSqliteTableSchema(sqlite, HOOK_WORKER_JOBS_SCHEMA);

  queueStorageInitialized = true;
};

const isValidHookWorkerPayload = (
  payload: unknown
): payload is HookWorkerJobPayload => {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const parsed = payload as HookWorkerJobPayload;
  if (typeof parsed.eventName !== "string" || parsed.eventName.trim().length === 0) {
    return false;
  }
  if (!parsed.context || typeof parsed.context !== "object") {
    return false;
  }
  if (!parsed.config || typeof parsed.config !== "object") {
    return false;
  }
  if (!Array.isArray(parsed.config.actions) || parsed.config.actions.length === 0) {
    return false;
  }
  return true;
};

const releaseExpiredLeases = (now: number): void => {
  sqlite
    .prepare(
      `
      UPDATE hook_worker_jobs
      SET
        status = 'pending',
        worker_id = NULL,
        lease_until = 0,
        updated_at = ?
      WHERE status = 'processing' AND lease_until > 0 AND lease_until <= ?
      `
    )
    .run(now, now);
};

export const isHookWorkerExecutionEnabled = (): boolean =>
  (process.env.HOOK_EXECUTION_MODE || "").trim().toLowerCase() === "worker";

export const enqueueHookWorkerJob = (payload: HookWorkerJobPayload): string => {
  ensureHookWorkerQueueStorage();
  const now = Date.now();
  const jobId = uuidv4();
  sqlite
    .prepare(
      `
      INSERT INTO hook_worker_jobs (
        id,
        status,
        payload_json,
        attempt_count,
        max_attempts,
        available_at,
        lease_until,
        created_at,
        updated_at
      )
      VALUES (?, 'pending', ?, 0, ?, ?, 0, ?, ?)
      `
    )
    .run(
      jobId,
      JSON.stringify(payload),
      getMaxAttempts(),
      now,
      now,
      now
    );

  return jobId;
};

export const claimNextHookWorkerJob = (workerId: string): HookWorkerJob | null => {
  ensureHookWorkerQueueStorage();
  const now = Date.now();
  releaseExpiredLeases(now);

  const row = sqlite
    .prepare(
      `
      SELECT
        id,
        payload_json AS payloadJson,
        attempt_count AS attemptCount,
        max_attempts AS maxAttempts
      FROM hook_worker_jobs
      WHERE status = 'pending' AND available_at <= ?
      ORDER BY created_at ASC
      LIMIT 1
      `
    )
    .get(now) as
    | {
        id: string;
        payloadJson: string;
        attemptCount: number;
        maxAttempts: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  const leaseUntil = now + getLeaseMs();
  const claimed = sqlite
    .prepare(
      `
      UPDATE hook_worker_jobs
      SET
        status = 'processing',
        worker_id = ?,
        lease_until = ?,
        updated_at = ?
      WHERE id = ? AND status = 'pending'
      `
    )
    .run(workerId, leaseUntil, now, row.id);
  if ((claimed.changes ?? 0) === 0) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(row.payloadJson);
  } catch (error) {
    markHookWorkerJobFailed(
      row.id,
      `Invalid payload JSON: ${error instanceof Error ? error.message : String(error)}`,
      false
    );
    return null;
  }
  if (!isValidHookWorkerPayload(payload)) {
    markHookWorkerJobFailed(row.id, "Invalid hook worker payload shape", false);
    return null;
  }

  return {
    id: row.id,
    payload,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
  };
};

export const markHookWorkerJobCompleted = (jobId: string): void => {
  ensureHookWorkerQueueStorage();
  const now = Date.now();
  sqlite
    .prepare(
      `
      UPDATE hook_worker_jobs
      SET
        status = 'completed',
        worker_id = NULL,
        lease_until = 0,
        updated_at = ?,
        completed_at = ?,
        last_error = NULL
      WHERE id = ?
      `
    )
    .run(now, now, jobId);
};

export const markHookWorkerJobFailed = (
  jobId: string,
  errorMessage: string,
  retryable = true
): void => {
  ensureHookWorkerQueueStorage();
  const row = sqlite
    .prepare(
      `
      SELECT attempt_count AS attemptCount, max_attempts AS maxAttempts
      FROM hook_worker_jobs
      WHERE id = ?
      `
    )
    .get(jobId) as { attemptCount: number; maxAttempts: number } | undefined;
  if (!row) {
    return;
  }

  const now = Date.now();
  const nextAttemptCount = Number(row.attemptCount || 0) + 1;
  const maxAttempts = Number(row.maxAttempts || getMaxAttempts());
  const shouldRetry = retryable && nextAttemptCount < maxAttempts;
  if (shouldRetry) {
    const retryDelayMs = Math.min(
      60_000,
      getRetryBaseDelayMs() * 2 ** Math.max(0, nextAttemptCount - 1)
    );
    sqlite
      .prepare(
        `
        UPDATE hook_worker_jobs
        SET
          status = 'pending',
          worker_id = NULL,
          lease_until = 0,
          attempt_count = ?,
          available_at = ?,
          updated_at = ?,
          last_error = ?
        WHERE id = ?
        `
      )
      .run(nextAttemptCount, now + retryDelayMs, now, errorMessage, jobId);
    return;
  }

  const terminalStatus = retryable ? "dead" : "failed";
  sqlite
    .prepare(
      `
      UPDATE hook_worker_jobs
      SET
        status = ?,
        worker_id = NULL,
        lease_until = 0,
        attempt_count = ?,
        updated_at = ?,
        completed_at = ?,
        last_error = ?
      WHERE id = ?
      `
    )
    .run(terminalStatus, nextAttemptCount, now, now, errorMessage, jobId);
};

export const cleanupOldHookWorkerJobs = (maxAgeMs = 7 * 24 * 60 * 60 * 1000): number => {
  ensureHookWorkerQueueStorage();
  const cutoff = Date.now() - maxAgeMs;
  const result = sqlite
    .prepare(
      `
      DELETE FROM hook_worker_jobs
      WHERE status IN ('completed', 'failed', 'dead')
        AND COALESCE(completed_at, updated_at, created_at) < ?
      `
    )
    .run(cutoff);
  return result.changes ?? 0;
};

export const getHookWorkerQueueStats = (): {
  pending: number;
  processing: number;
  completed: number;
  dead: number;
} => {
  ensureHookWorkerQueueStorage();
  const rows = sqlite
    .prepare(
      `
      SELECT status, COUNT(*) AS count
      FROM hook_worker_jobs
      GROUP BY status
      `
    )
    .all() as Array<{ status: string; count: number }>;

  const stats = {
    pending: 0,
    processing: 0,
    completed: 0,
    dead: 0,
  };
  for (const row of rows) {
    if (row.status === "pending") {
      stats.pending = row.count;
    } else if (row.status === "processing") {
      stats.processing = row.count;
    } else if (row.status === "completed") {
      stats.completed = row.count;
    } else if (row.status === "dead" || row.status === "failed") {
      stats.dead += row.count;
    }
  }
  return stats;
};

export const logHookWorkerQueueStats = (): void => {
  const stats = getHookWorkerQueueStats();
  logger.info("Hook worker queue stats", stats);
};
