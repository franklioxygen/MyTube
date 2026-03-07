import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  uuidv4: vi.fn(() => "job-test-id"),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../../db", () => ({
  sqlite: {
    prepare: mocks.prepare,
  },
}));

vi.mock("uuid", () => ({
  v4: mocks.uuidv4,
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

type StatementMock = {
  run: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
};

const createStatementMock = (): StatementMock => ({
  run: vi.fn(() => ({})),
  get: vi.fn(),
  all: vi.fn(() => []),
});

const mockPrepare = (
  resolver: (sql: string) => Partial<StatementMock> | null | undefined
): void => {
  mocks.prepare.mockImplementation((sql: string) => {
    const resolved = resolver(sql);
    const base = createStatementMock();
    if (!resolved) {
      return base;
    }
    return {
      run: resolved.run ?? base.run,
      get: resolved.get ?? base.get,
      all: resolved.all ?? base.all,
    };
  });
};

describe("hookWorkerQueueService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.HOOK_EXECUTION_MODE;
    delete process.env.HOOK_WORKER_MAX_ATTEMPTS;
    delete process.env.HOOK_WORKER_RETRY_BASE_DELAY_MS;
    delete process.env.HOOK_WORKER_LEASE_MS;
  });

  it("enqueues hook worker job with pending status and generated id", async () => {
    const createTableRun = vi.fn(() => ({}));
    const createIndexRun = vi.fn(() => ({}));
    const insertRun = vi.fn(() => ({}));
    mockPrepare((sql) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS hook_worker_jobs")) {
        return { run: createTableRun };
      }
      if (sql.includes("CREATE INDEX IF NOT EXISTS hook_worker_jobs_")) {
        return { run: createIndexRun };
      }
      if (sql.includes("INSERT INTO hook_worker_jobs")) {
        return { run: insertRun };
      }
      return null;
    });

    const service = await import("../hookWorkerQueueService");
    const payload = {
      eventName: "task_success",
      context: {
        taskId: "task-1",
        taskTitle: "Title",
        status: "success",
      },
      config: {
        version: 1,
        actions: [{ type: "notify_webhook", url: "https://example.com/hook" }],
      },
    };

    const jobId = service.enqueueHookWorkerJob(payload);

    expect(jobId).toBe("job-test-id");
    expect(mocks.uuidv4).toHaveBeenCalledTimes(1);
    expect(createTableRun).toHaveBeenCalledTimes(1);
    expect(createIndexRun).toHaveBeenCalledTimes(3);
    expect(insertRun).toHaveBeenCalledWith(
      "job-test-id",
      JSON.stringify(payload),
      3,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("claims pending job and parses payload", async () => {
    const releaseLeaseRun = vi.fn(() => ({}));
    const claimRun = vi.fn(() => ({ changes: 1 }));
    mockPrepare((sql) => {
      if (
        sql.includes("UPDATE hook_worker_jobs") &&
        sql.includes("status = 'pending'") &&
        sql.includes("lease_until <= ?")
      ) {
        return { run: releaseLeaseRun };
      }
      if (
        sql.includes("SELECT") &&
        sql.includes("payload_json AS payloadJson") &&
        sql.includes("WHERE status = 'pending'")
      ) {
        return {
          get: vi.fn(() => ({
            id: "job-1",
            payloadJson: JSON.stringify({
              eventName: "task_success",
              context: { taskId: "t1", status: "success" },
              config: { version: 1, actions: [{ type: "notify_webhook" }] },
            }),
            attemptCount: 0,
            maxAttempts: 3,
          })),
        };
      }
      if (
        sql.includes("UPDATE hook_worker_jobs") &&
        sql.includes("status = 'processing'") &&
        sql.includes("WHERE id = ? AND status = 'pending'")
      ) {
        return { run: claimRun };
      }
      return null;
    });

    const service = await import("../hookWorkerQueueService");
    const job = service.claimNextHookWorkerJob("worker-1");

    expect(releaseLeaseRun).toHaveBeenCalledTimes(1);
    expect(claimRun).toHaveBeenCalledWith(
      "worker-1",
      expect.any(Number),
      expect.any(Number),
      "job-1"
    );
    expect(job).toEqual({
      id: "job-1",
      payload: {
        eventName: "task_success",
        context: { taskId: "t1", status: "success" },
        config: { version: 1, actions: [{ type: "notify_webhook" }] },
      },
      attemptCount: 0,
      maxAttempts: 3,
    });
  });

  it("marks invalid payload claim as failed without returning a job", async () => {
    const releaseLeaseRun = vi.fn(() => ({}));
    const claimRun = vi.fn(() => ({ changes: 1 }));
    const selectFailedRow = vi.fn(() => ({ attemptCount: 0, maxAttempts: 3 }));
    const terminalUpdateRun = vi.fn(() => ({}));
    mockPrepare((sql) => {
      if (
        sql.includes("UPDATE hook_worker_jobs") &&
        sql.includes("status = 'pending'") &&
        sql.includes("lease_until <= ?")
      ) {
        return { run: releaseLeaseRun };
      }
      if (
        sql.includes("SELECT") &&
        sql.includes("payload_json AS payloadJson") &&
        sql.includes("WHERE status = 'pending'")
      ) {
        return {
          get: vi.fn(() => ({
            id: "job-bad-json",
            payloadJson: "{bad-json",
            attemptCount: 0,
            maxAttempts: 3,
          })),
        };
      }
      if (
        sql.includes("UPDATE hook_worker_jobs") &&
        sql.includes("status = 'processing'") &&
        sql.includes("WHERE id = ? AND status = 'pending'")
      ) {
        return { run: claimRun };
      }
      if (
        sql.includes("SELECT attempt_count AS attemptCount, max_attempts AS maxAttempts")
      ) {
        return { get: selectFailedRow };
      }
      if (
        sql.includes("UPDATE hook_worker_jobs") &&
        sql.includes("status = ?") &&
        sql.includes("completed_at = ?")
      ) {
        return { run: terminalUpdateRun };
      }
      return null;
    });

    const service = await import("../hookWorkerQueueService");
    const job = service.claimNextHookWorkerJob("worker-2");

    expect(job).toBeNull();
    expect(releaseLeaseRun).toHaveBeenCalledTimes(1);
    expect(claimRun).toHaveBeenCalledTimes(1);
    expect(selectFailedRow).toHaveBeenCalledWith("job-bad-json");
    expect(terminalUpdateRun).toHaveBeenCalledWith(
      "failed",
      1,
      expect.any(Number),
      expect.any(Number),
      expect.stringContaining("Invalid payload JSON"),
      "job-bad-json"
    );
  });

  it("retries failed job with exponential backoff before max attempts", async () => {
    const selectRun = vi.fn(() => ({ attemptCount: 0, maxAttempts: 3 }));
    const retryRun = vi.fn(() => ({}));
    mockPrepare((sql) => {
      if (
        sql.includes("SELECT attempt_count AS attemptCount, max_attempts AS maxAttempts")
      ) {
        return { get: selectRun };
      }
      if (
        sql.includes("UPDATE hook_worker_jobs") &&
        sql.includes("status = 'pending'") &&
        sql.includes("attempt_count = ?")
      ) {
        return { run: retryRun };
      }
      return null;
    });
    vi.spyOn(Date, "now").mockReturnValue(1000);

    const service = await import("../hookWorkerQueueService");
    service.markHookWorkerJobFailed("job-retry", "network timeout", true);

    expect(retryRun).toHaveBeenCalledWith(
      1,
      6000,
      1000,
      "network timeout",
      "job-retry"
    );
  });

  it("marks failed job as dead after max retry attempts", async () => {
    const selectRun = vi.fn(() => ({ attemptCount: 2, maxAttempts: 3 }));
    const deadRun = vi.fn(() => ({}));
    mockPrepare((sql) => {
      if (
        sql.includes("SELECT attempt_count AS attemptCount, max_attempts AS maxAttempts")
      ) {
        return { get: selectRun };
      }
      if (
        sql.includes("UPDATE hook_worker_jobs") &&
        sql.includes("status = ?") &&
        sql.includes("completed_at = ?")
      ) {
        return { run: deadRun };
      }
      return null;
    });
    vi.spyOn(Date, "now").mockReturnValue(2000);

    const service = await import("../hookWorkerQueueService");
    service.markHookWorkerJobFailed("job-dead", "always failing", true);

    expect(deadRun).toHaveBeenCalledWith(
      "dead",
      3,
      2000,
      2000,
      "always failing",
      "job-dead"
    );
  });

  it("aggregates queue stats and emits structured log", async () => {
    mockPrepare((sql) => {
      if (sql.includes("SELECT status, COUNT(*) AS count")) {
        return {
          all: vi.fn(() => [
            { status: "pending", count: 2 },
            { status: "processing", count: 1 },
            { status: "completed", count: 3 },
            { status: "failed", count: 1 },
            { status: "dead", count: 4 },
          ]),
        };
      }
      return null;
    });

    const service = await import("../hookWorkerQueueService");
    const stats = service.getHookWorkerQueueStats();
    service.logHookWorkerQueueStats();

    expect(stats).toEqual({
      pending: 2,
      processing: 1,
      completed: 3,
      dead: 5,
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith("Hook worker queue stats", {
      pending: 2,
      processing: 1,
      completed: 3,
      dead: 5,
    });
  });
});
