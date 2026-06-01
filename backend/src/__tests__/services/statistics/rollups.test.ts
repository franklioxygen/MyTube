import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const mockWarn = vi.fn();
let nextEventId = 0;

vi.mock("../../../db", () => ({
  sqlite: {
    prepare: vi.fn(),
    transaction: vi.fn((callback: (...args: any[]) => unknown) => (...args: any[]) =>
      callback(...args)
    ),
  },
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    warn: (...args: any[]) => mockWarn(...args),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { sqlite } from "../../../db";
import {
  getRollupHealth,
  recomputeAllUnsealedDays,
  runRollupCycle,
  startRollupWorker,
  stopRollupWorker,
} from "../../../services/statistics/rollups";

type Matcher = string | RegExp;
type Responder = unknown | ((args: unknown[]) => unknown);

interface MockStatement {
  get: Mock<(...args: unknown[]) => unknown>;
  all: Mock<(...args: unknown[]) => unknown>;
  run: Mock<(...args: unknown[]) => unknown>;
}

interface RollupRow {
  day: string;
  metricKey: string;
  dimensions: Record<string, unknown>;
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
  updatedAt: number;
}

function matchesSql(sql: string, matcher: Matcher): boolean {
  return typeof matcher === "string" ? sql.includes(matcher) : matcher.test(sql);
}

function resolveResponder(
  sql: string,
  args: unknown[],
  responders: Array<[Matcher, Responder]>
): unknown {
  const matched = responders.find(([matcher]) => matchesSql(sql, matcher));
  if (!matched) {
    throw new Error(`No SQL mock configured for: ${sql}`);
  }

  const [, responder] = matched;
  return typeof responder === "function"
    ? (responder as (nextArgs: unknown[]) => unknown)(args)
    : responder;
}

function makeStatement(options: {
  get?: Responder;
  all?: Responder;
  run?: Responder;
} = {}): MockStatement {
  return {
    get: vi.fn((...args: unknown[]) =>
      typeof options.get === "function"
        ? (options.get as (nextArgs: unknown[]) => unknown)(args)
        : options.get
    ),
    all: vi.fn((...args: unknown[]) =>
      typeof options.all === "function"
        ? (options.all as (nextArgs: unknown[]) => unknown)(args)
        : options.all ?? []
    ),
    run: vi.fn((...args: unknown[]) =>
      typeof options.run === "function"
        ? (options.run as (nextArgs: unknown[]) => unknown)(args)
        : options.run ?? { changes: 1 }
    ),
  };
}

function installPrepareMocks(options: {
  get?: Array<[Matcher, Responder]>;
  all?: Array<[Matcher, Responder]>;
  run?: Array<[Matcher, Responder]>;
}): void {
  const getResponders = options.get ?? [];
  const allResponders = options.all ?? [];
  const runResponders = options.run ?? [];

  vi.mocked(sqlite.prepare).mockImplementation((sql: string) => {
    return {
      get: vi.fn((...args: unknown[]) => resolveResponder(sql, args, getResponders)),
      all: vi.fn((...args: unknown[]) => resolveResponder(sql, args, allResponders)),
      run: vi.fn((...args: unknown[]) => resolveResponder(sql, args, runResponders)),
    } as any;
  });
}

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `evt-${++nextEventId}`,
    eventType: "search_submitted",
    recordedAt: 0,
    sessionId: null,
    videoId: null,
    subscriptionId: null,
    rssTokenId: null,
    actorRole: "admin",
    platform: "youtube",
    sourceKind: "manual",
    durationSeconds: null,
    value: null,
    payload: "{}",
    relatedEventId: null,
    ...overrides,
  };
}

function extractRollupRows(statement: MockStatement): RollupRow[] {
  return statement.run.mock.calls.map((args) => ({
    day: args[0] as string,
    metricKey: args[1] as string,
    dimensions: JSON.parse(args[6] as string) as Record<string, unknown>,
    count: args[7] as number,
    sum: args[8] as number,
    min: (args[9] as number | null) ?? null,
    max: (args[10] as number | null) ?? null,
    updatedAt: args[11] as number,
  }));
}

function findRollupRow(
  rows: RollupRow[],
  metricKey: string,
  expectedDimensions: Record<string, unknown>
): RollupRow | undefined {
  return rows.find(
    (row) =>
      row.metricKey === metricKey &&
      Object.entries(expectedDimensions).every(
        ([key, value]) => row.dimensions[key] === value
      )
  );
}

describe("statistics rollups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    nextEventId = 0;
    stopRollupWorker();
  });

  afterEach(() => {
    stopRollupWorker();
    vi.useRealTimers();
  });

  it("aggregates dirty days into daily metrics and completion buckets", async () => {
    const day = "2026-01-01";
    const insertDaily = makeStatement();
    const deleteDaily = makeStatement();
    const clearDirtyDay = makeStatement();

    installPrepareMocks({
      all: [
        [
          "SELECT day FROM usage_statistics_rollup_days",
          [{ day }],
        ],
        [
          "FROM usage_statistics_events",
          [
            makeEvent({ id: "evt-1", payload: "{", recordedAt: 1_000 }),
            makeEvent({ id: "evt-2", eventType: "video_play_started", recordedAt: 2_000 }),
            makeEvent({
              id: "evt-3",
              eventType: "video_watch_chunk_recorded",
              sessionId: "sess-a",
              videoId: "video-1",
              durationSeconds: 30,
              recordedAt: 100_000,
            }),
            makeEvent({
              id: "evt-4",
              eventType: "video_watch_chunk_recorded",
              sessionId: "sess-a",
              videoId: "video-1",
              durationSeconds: 65,
              recordedAt: 210_000,
            }),
            makeEvent({
              id: "evt-5",
              eventType: "video_watch_chunk_recorded",
              sessionId: "sess-b",
              videoId: "video-1",
              durationSeconds: 55,
              recordedAt: 400_000,
            }),
            makeEvent({
              id: "evt-6",
              eventType: "video_watch_chunk_recorded",
              sessionId: "sess-c",
              videoId: "video-low",
              durationSeconds: 5,
              recordedAt: 500_000,
            }),
            makeEvent({
              id: "evt-7",
              eventType: "video_watch_chunk_recorded",
              sessionId: "sess-d",
              videoId: "video-mid",
              durationSeconds: 30,
              recordedAt: 600_000,
            }),
            makeEvent({
              id: "evt-8",
              eventType: "video_watch_chunk_recorded",
              sessionId: "sess-e",
              videoId: "video-missing",
              durationSeconds: 20,
              recordedAt: 700_000,
            }),
            makeEvent({
              id: "evt-9",
              eventType: "download_enqueued",
              sourceKind: "subscription",
              recordedAt: 800_000,
            }),
            makeEvent({
              id: "evt-10",
              eventType: "download_started",
              sourceKind: "subscription",
              recordedAt: 810_000,
            }),
            makeEvent({
              id: "evt-11",
              eventType: "library_video_added",
              payload: JSON.stringify({ reason: "scan", fileSizeBytes: 1_024 }),
              recordedAt: 900_000,
            }),
            makeEvent({
              id: "evt-12",
              eventType: "library_video_deleted",
              payload: JSON.stringify({ reason: "retention", fileSizeBytes: 256 }),
              recordedAt: 910_000,
            }),
            makeEvent({
              id: "evt-13",
              eventType: "library_video_deleted",
              payload: "{}",
              recordedAt: 920_000,
            }),
            makeEvent({
              id: "evt-14",
              eventType: "subscription_check_completed",
              payload: JSON.stringify({ status: "partial", newVideoCount: 3 }),
              recordedAt: 930_000,
            }),
            makeEvent({
              id: "evt-15",
              eventType: "subscription_check_completed",
              payload: "{}",
              recordedAt: 940_000,
            }),
            makeEvent({
              id: "evt-16",
              eventType: "retention_delete_completed",
              payload: JSON.stringify({ deletedCount: 2 }),
              recordedAt: 950_000,
            }),
            makeEvent({
              id: "evt-17",
              eventType: "retention_delete_completed",
              payload: "{}",
              recordedAt: 960_000,
            }),
            makeEvent({
              id: "evt-18",
              eventType: "rss_feed_accessed",
              rssTokenId: null,
              platform: null,
              recordedAt: 970_000,
            }),
            makeEvent({
              id: "evt-19",
              eventType: "unknown_event",
              recordedAt: 980_000,
            }),
          ],
        ],
        [
          "SELECT id, duration\n       FROM videos",
          [
            { id: "video-1", duration: "100" },
            { id: "video-low", duration: "100" },
            { id: "video-mid", duration: "100" },
          ],
        ],
      ],
      run: [
        ["DELETE FROM usage_statistics_daily WHERE day = ?", (args: unknown[]) => deleteDaily.run(...args)],
        ["INSERT INTO usage_statistics_daily", (args: unknown[]) => insertDaily.run(...args)],
        [
          "UPDATE usage_statistics_rollup_days\n         SET dirty = 0, last_rolled_up_at = ?",
          (args: unknown[]) => clearDirtyDay.run(...args),
        ],
      ],
    });

    const result = await runRollupCycle();
    const rows = extractRollupRows(insertDaily);

    expect(result.daysProcessed).toBe(1);
    expect(deleteDaily.run).toHaveBeenCalledWith(day);
    expect(clearDirtyDay.run).toHaveBeenCalledWith(expect.any(Number), day);
    expect(getRollupHealth().running).toBe(false);

    expect(findRollupRow(rows, "search_submitted", { actor_role: "admin" })).toEqual(
      expect.objectContaining({ count: 1, sum: 1, min: 1, max: 1 })
    );
    expect(findRollupRow(rows, "search_zero_result", { actor_role: "admin" })).toEqual(
      expect.objectContaining({ count: 1, sum: 1 })
    );
    expect(
      findRollupRow(rows, "download_enqueued", {
        actor_role: "admin",
        platform: "youtube",
        source_kind: "subscription",
      })
    ).toEqual(expect.objectContaining({ count: 1 }));
    expect(
      findRollupRow(rows, "watch_seconds", {
        actor_role: "admin",
        platform: "youtube",
      })
    ).toEqual(expect.objectContaining({ count: 6, sum: 205, min: 5, max: 65 }));
    expect(
      findRollupRow(rows, "play_session", {
        actor_role: "admin",
        platform: "youtube",
        video_id: "video-1",
      })
    ).toEqual(expect.objectContaining({ count: 2, sum: 150, min: 55, max: 95 }));
    expect(
      findRollupRow(rows, "completion_bucket", {
        actor_role: "admin",
        platform: "youtube",
        bucket: "0-10",
      })
    ).toEqual(expect.objectContaining({ count: 1 }));
    expect(
      findRollupRow(rows, "completion_bucket", {
        actor_role: "admin",
        platform: "youtube",
        bucket: "10-50",
      })
    ).toEqual(expect.objectContaining({ count: 1 }));
    expect(
      findRollupRow(rows, "completion_bucket", {
        actor_role: "admin",
        platform: "youtube",
        bucket: "50-90",
      })
    ).toEqual(expect.objectContaining({ count: 1 }));
    expect(
      findRollupRow(rows, "completion_bucket", {
        actor_role: "admin",
        platform: "youtube",
        bucket: "90-100",
      })
    ).toEqual(expect.objectContaining({ count: 1 }));
    expect(
      findRollupRow(rows, "completed_play_sessions", {
        actor_role: "admin",
        platform: "youtube",
      })
    ).toEqual(expect.objectContaining({ count: 1 }));
    expect(
      findRollupRow(rows, "rewatched_videos", {
        actor_role: "admin",
        platform: "youtube",
        video_id: "video-1",
      })
    ).toEqual(expect.objectContaining({ count: 1 }));
    expect(findRollupRow(rows, "library_bytes_added", { platform: "youtube" })).toEqual(
      expect.objectContaining({ count: 1, sum: 1_024, min: 1_024, max: 1_024 })
    );
    expect(findRollupRow(rows, "library_video_deleted", { platform: "youtube", reason: "manual" })).toEqual(
      expect.objectContaining({ count: 1 })
    );
    expect(findRollupRow(rows, "library_bytes_deleted", { platform: "youtube" })).toEqual(
      expect.objectContaining({ count: 1, sum: 256 })
    );
    expect(findRollupRow(rows, "subscription_new_videos", { status: "partial" })).toEqual(
      expect.objectContaining({ count: 1, sum: 3, min: 3, max: 3 })
    );
    expect(findRollupRow(rows, "subscription_check_completed", { status: "success" })).toEqual(
      expect.objectContaining({ count: 1 })
    );
    expect(findRollupRow(rows, "retention_delete_completed", { reason: "retention" })).toEqual(
      expect.objectContaining({ count: 2, sum: 3, min: 1, max: 2 })
    );
    expect(findRollupRow(rows, "rss_feed_accessed", { rss_token_id: "unknown" })).toEqual(
      expect.objectContaining({ count: 1 })
    );
  });

  it("warns and continues when recomputing one dirty day fails", async () => {
    const deleteDaily = makeStatement();
    const clearDirtyDay = makeStatement();

    installPrepareMocks({
      all: [
        [
          "SELECT day FROM usage_statistics_rollup_days",
          [{ day: "2026-01-01" }, { day: "2026-01-02" }],
        ],
        [
          "FROM usage_statistics_events",
          (args: unknown[]) => {
            if (args[0] === "2026-01-01") {
              throw new Error("broken day");
            }
            return [];
          },
        ],
      ],
      run: [
        ["DELETE FROM usage_statistics_daily WHERE day = ?", (args: unknown[]) => deleteDaily.run(...args)],
        [
          "INSERT INTO usage_statistics_daily",
          () => {
            throw new Error("should not upsert empty day");
          },
        ],
        [
          "UPDATE usage_statistics_rollup_days\n         SET dirty = 0, last_rolled_up_at = ?",
          (args: unknown[]) => clearDirtyDay.run(...args),
        ],
      ],
    });

    const result = await runRollupCycle();

    expect(result.daysProcessed).toBe(1);
    expect(mockWarn).toHaveBeenCalledWith(
      "Failed to recompute statistics rollup day 2026-01-01",
      expect.any(Error)
    );
    expect(deleteDaily.run).toHaveBeenCalledWith("2026-01-02");
    expect(clearDirtyDay.run).toHaveBeenCalledWith(expect.any(Number), "2026-01-02");
    expect(getRollupHealth().running).toBe(false);
    expect(getRollupHealth().lastRunAt).toBeGreaterThan(0);
  });

  it("schedules one worker interval and reports initial and periodic failures", async () => {
    vi.useFakeTimers();

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    installPrepareMocks({
      all: [
        [
          "SELECT day FROM usage_statistics_rollup_days",
          () => {
            throw new Error("worker offline");
          },
        ],
      ],
    });

    startRollupWorker();
    startRollupWorker();
    await Promise.resolve();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      "Initial rollup cycle failed",
      expect.any(Error)
    );

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(mockWarn).toHaveBeenCalledWith(
      "Periodic rollup cycle failed",
      expect.any(Error)
    );

    stopRollupWorker();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("marks every unsealed day dirty before recomputing", async () => {
    const markAllDirty = makeStatement();
    const deleteDaily = makeStatement();
    const clearDirtyDay = makeStatement();

    installPrepareMocks({
      all: [
        ["SELECT day FROM usage_statistics_rollup_days", [{ day: "2026-01-03" }]],
        ["FROM usage_statistics_events", []],
      ],
      run: [
        [
          "UPDATE usage_statistics_rollup_days SET dirty = 1 WHERE sealed = 0",
          (args: unknown[]) => markAllDirty.run(...args),
        ],
        ["DELETE FROM usage_statistics_daily WHERE day = ?", (args: unknown[]) => deleteDaily.run(...args)],
        [
          "UPDATE usage_statistics_rollup_days\n         SET dirty = 0, last_rolled_up_at = ?",
          (args: unknown[]) => clearDirtyDay.run(...args),
        ],
      ],
    });

    const daysProcessed = await recomputeAllUnsealedDays();

    expect(daysProcessed).toBe(1);
    expect(markAllDirty.run).toHaveBeenCalledWith();
    expect(deleteDaily.run).toHaveBeenCalledWith("2026-01-03");
    expect(clearDirtyDay.run).toHaveBeenCalledWith(expect.any(Number), "2026-01-03");
  });
});
