import fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSettings = vi.fn();
const mockNormalizeSafeAbsolutePath = vi.fn((value: string) => value);
const mockStatTrustedSync = vi.fn((_value: string) => ({ isDirectory: () => true }));

vi.mock("../../../db", () => ({
  sqlite: { prepare: vi.fn() },
}));

vi.mock("../../../services/storageService", () => ({
  getSettings: () => mockGetSettings(),
}));

vi.mock("../../../services/statistics/collector", () => ({
  getResolvedTimezone: vi.fn(() => "UTC"),
}));

vi.mock("../../../utils/security", () => ({
  normalizeSafeAbsolutePath: (value: string) => mockNormalizeSafeAbsolutePath(value),
  statTrustedSync: (value: string) => mockStatTrustedSync(value),
}));

import { sqlite } from "../../../db";
import {
  estimateDiskRunway,
  getOverview,
  getRanking,
  getTimeseries,
} from "../../../services/statistics/queries";

type Matcher = string | RegExp;
type Responder = unknown | ((args: unknown[]) => unknown);

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

function buildDailyRows(
  count: number,
  added = 1_000,
  deleted = 100,
  retentionDeletes = 0
): Array<{ day: string; added: number; deleted: number; retentionDeletes: number }> {
  return Array.from({ length: count }, (_value, index) => ({
    day: `2026-01-${String(index + 1).padStart(2, "0")}`,
    added,
    deleted,
    retentionDeletes,
  }));
}

describe("statistics queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({});
    mockNormalizeSafeAbsolutePath.mockImplementation((value: string) => value);
    mockStatTrustedSync.mockReturnValue({ isDirectory: () => true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds an overview snapshot with rollup data and alerts", () => {
    installPrepareMocks({
      get: [
        [/SELECT COUNT\(\*\) AS c FROM videos\s*$/, { c: 12 }],
        ["SUM(CAST(file_size AS INTEGER))", { bytes: 4_096 }],
        ["subscriptions WHERE COALESCE(paused, 0) = 0", { c: 3 }],
        ["subscriptions WHERE COALESCE(paused, 0) = 1", { c: 1 }],
        ["FROM rss_tokens WHERE is_active = 1", { c: 2 }],
        ["FROM collection_videos", { c: 5 }],
        ["subtitles IS NOT NULL", { c: 4 }],
        ["thumbnail_filename IS NOT NULL", { c: 6 }],
        [
          "FROM download_history\n       WHERE finished_at >= ? AND finished_at <= ?",
          { completed: 8, failed: 2, bytes: 2_048 },
        ],
        [
          "metric_key IN ('library_video_added', 'library_video_deleted')",
          { added: 10, deleted: 4, rowCount: 2 },
        ],
        ["SELECT COUNT(*) AS c FROM videos WHERE created_at >= ?", { c: 99 }],
        ["SELECT COALESCE(SUM(sum), 0) AS s", { s: 7_200 }],
      ],
      all: [
        [
          /FROM subscriptions\s+WHERE COALESCE\(consecutive_failure_count, 0\) >= 5/,
          [{ id: "sub-1", author: "Channel A", consecutive_failure_count: 6 }],
        ],
        [
          /WHERE finished_at >= \? AND finished_at <= \?\s+GROUP BY platform/,
          [{ platform: "youtube", completed: 5, failed: 5 }],
        ],
        [
          /WHERE finished_at >= \? AND finished_at < \?\s+GROUP BY platform/,
          [{ platform: "youtube", completed: 9, failed: 1 }],
        ],
      ],
    });

    const overview = getOverview(30);

    expect(overview.totalVideos).toBe(12);
    expect(overview.totalStorageBytes).toBe(4_096);
    expect(overview.activeSubscriptions).toBe(3);
    expect(overview.pausedSubscriptions).toBe(1);
    expect(overview.activeRssTokens).toBe(2);
    expect(overview.collectionCoverage).toBe(5);
    expect(overview.subtitleCoverage).toBe(4);
    expect(overview.thumbnailCoverage).toBe(6);
    expect(overview.downloadSuccessRate).toBe(0.8);
    expect(overview.downloadVolumeBytes).toBe(2_048);
    expect(overview.netNewVideos).toBe(6);
    expect(overview.watchSecondsLastRange).toBe(7_200);
    expect(overview.alerts).toEqual([
      expect.objectContaining({
        key: "subscription_failure_streak:sub-1",
        severity: "warning",
      }),
      expect.objectContaining({
        key: "platform_success_drop:youtube",
        severity: "warning",
      }),
    ]);
  });

  it("falls back to live counters when rollup rows are missing and ignores alert query failures", () => {
    installPrepareMocks({
      get: [
        [/SELECT COUNT\(\*\) AS c FROM videos\s*$/, undefined],
        ["SUM(CAST(file_size AS INTEGER))", undefined],
        ["subscriptions WHERE COALESCE(paused, 0) = 0", undefined],
        ["subscriptions WHERE COALESCE(paused, 0) = 1", undefined],
        ["FROM rss_tokens WHERE is_active = 1", undefined],
        ["FROM collection_videos", undefined],
        ["subtitles IS NOT NULL", undefined],
        ["thumbnail_filename IS NOT NULL", undefined],
        [
          "FROM download_history\n       WHERE finished_at >= ? AND finished_at <= ?",
          undefined,
        ],
        [
          "metric_key IN ('library_video_added', 'library_video_deleted')",
          { added: 0, deleted: 0, rowCount: 0 },
        ],
        ["SELECT COUNT(*) AS c FROM videos WHERE created_at >= ?", { c: 4 }],
        ["SELECT COALESCE(SUM(sum), 0) AS s", undefined],
      ],
      all: [
        [
          /FROM subscriptions\s+WHERE COALESCE\(consecutive_failure_count, 0\) >= 5/,
          () => {
            throw new Error("alerts unavailable");
          },
        ],
        [
          /WHERE finished_at >= \? AND finished_at <= \?\s+GROUP BY platform/,
          () => {
            throw new Error("history unavailable");
          },
        ],
      ],
    });

    const overview = getOverview(30);

    expect(overview.totalVideos).toBe(0);
    expect(overview.totalStorageBytes).toBe(0);
    expect(overview.activeSubscriptions).toBe(0);
    expect(overview.downloadSuccessRate).toBeNull();
    expect(overview.netNewVideos).toBe(4);
    expect(overview.watchSecondsLastRange).toBe(0);
    expect(overview.alerts).toEqual([]);
  });

  it("buckets live download and library timeseries metrics by day", () => {
    installPrepareMocks({
      all: [
        [
          /status IN \('success','deleted'\)/,
          [
            { finishedAt: Date.parse("2026-01-01T03:00:00Z"), totalSize: 100 },
            { finishedAt: Date.parse("2026-01-01T08:00:00Z"), totalSize: 50 },
            { finishedAt: Date.parse("2026-01-02T01:00:00Z"), totalSize: 75 },
          ],
        ],
        [
          /status = 'failed'/,
          [
            { finishedAt: Date.parse("2026-01-01T12:00:00Z") },
            { finishedAt: Date.parse("2026-01-02T12:00:00Z") },
          ],
        ],
        [
          /FROM videos\s+WHERE created_at >= \?/,
          [
            { createdAt: "2026-01-01T00:00:00.000Z" },
            { createdAt: "not-a-date" },
            { createdAt: "2026-01-02T00:00:00.000Z" },
          ],
        ],
      ],
    });

    expect(getTimeseries("downloads_completed_by_day", 30)).toEqual([
      { day: "2026-01-01", count: 2, sum: 150 },
      { day: "2026-01-02", count: 1, sum: 75 },
    ]);
    expect(getTimeseries("downloads_failed_by_day", 30)).toEqual([
      { day: "2026-01-01", count: 1, sum: 0 },
      { day: "2026-01-02", count: 1, sum: 0 },
    ]);
    expect(getTimeseries("library_added_by_day", 30)).toEqual([
      { day: "2026-01-01", count: 1, sum: 0 },
      { day: "2026-01-02", count: 1, sum: 0 },
    ]);
  });

  it("queries rollup-backed timeseries metrics with optional filters", () => {
    installPrepareMocks({
      all: [
        [
          /FROM usage_statistics_daily\s+WHERE metric_key = \? AND day >= \? AND day <= \?/,
          [
            { day: "2026-01-01", count: 2, sum: 120 },
            { day: "2026-01-02", count: 1, sum: 90 },
          ],
        ],
      ],
    });

    const rows = getTimeseries("watch_seconds", 14, {
      platform: "youtube",
      actorRole: "admin",
      sourceKind: "subscription",
    });

    expect(rows).toEqual([
      { day: "2026-01-01", count: 2, sum: 120 },
      { day: "2026-01-02", count: 1, sum: 90 },
    ]);
  });

  it("returns rankings for supported metrics and buckets failed downloads", () => {
    installPrepareMocks({
      all: [
        [
          /WHERE d.metric_key = 'play_session'/,
          [{ key: "vid-1", label: "Video 1", count: 4, sum: 900 }],
        ],
        [
          /FROM subscriptions s\s+LEFT JOIN download_history dh/,
          [{ key: "sub-1", label: "Author A", count: 7, sum: 0 }],
        ],
        [
          /FROM rss_tokens\s+ORDER BY access_count DESC/,
          [{ key: "rss-1", label: "Feed A", count: 3, sum: 0 }],
        ],
        [
          /SELECT id, error FROM download_history WHERE status = 'failed'/,
          [
            { id: "1", error: "Login required" },
            { id: "2", error: "Video unavailable (404)" },
            { id: "3", error: "Video unavailable (404)" },
          ],
        ],
        [
          /WHERE COALESCE\(view_count, 0\) = 0 AND file_size IS NOT NULL/,
          [{ key: "vid-2", label: "Never Watched", count: 0, sum: 500 }],
        ],
      ],
    });

    expect(getRanking("top_watched_videos", 10)).toEqual([
      { key: "vid-1", label: "Video 1", count: 4, sum: 900 },
    ]);
    expect(getRanking("most_productive_subscriptions", 10)).toEqual([
      { key: "sub-1", label: "Author A", count: 7, sum: 0 },
    ]);
    expect(getRanking("most_accessed_rss_feeds", 10)).toEqual([
      { key: "rss-1", label: "Feed A", count: 3, sum: 0 },
    ]);
    expect(getRanking("most_common_failure_buckets", 10)).toEqual([
      { key: "source_unavailable", label: "source_unavailable", count: 2, sum: 0 },
      { key: "auth_required", label: "auth_required", count: 1, sum: 0 },
    ]);
    expect(getRanking("largest_never_watched", 10)).toEqual([
      { key: "vid-2", label: "Never Watched", count: 0, sum: 500 },
    ]);
    expect(getRanking("unknown_metric", 10)).toEqual([]);
  });

  it("returns insufficient activity when runway has fewer than seven qualifying days", () => {
    installPrepareMocks({
      all: [
        [
          /FROM usage_statistics_daily\s+WHERE day >= \? AND day <= \?/,
          buildDailyRows(6),
        ],
      ],
    });

    expect(estimateDiskRunway(14)).toEqual({ status: "insufficient_activity" });
  });

  it("returns unavailable storage for cloud-only setups with positive growth", () => {
    mockGetSettings.mockReturnValue({ cloudDriveEnabled: true });
    installPrepareMocks({
      get: [
        [
          /FROM videos\s+WHERE video_path IS NULL OR video_path NOT LIKE 'cloud:%'/,
          { c: 0 },
        ],
      ],
      all: [
        [
          /FROM usage_statistics_daily\s+WHERE day >= \? AND day <= \?/,
          buildDailyRows(7, 1_000, 100, 0),
        ],
      ],
    });

    const runway = estimateDiskRunway(14);

    expect(runway.status).toBe("unavailable_storage");
    expect(runway.netDailyBytes).toBeGreaterThan(0);
  });

  it("returns the tightest local disk runway when writable roots exist", () => {
    mockGetSettings.mockReturnValue({
      mountDirectories: "/mnt/fast\n/mnt/tight",
      cloudDriveEnabled: false,
    });
    mockStatTrustedSync.mockReturnValue({ isDirectory: () => true });
    vi.spyOn(fs as any, "statfsSync").mockImplementation(((targetPath: unknown) => {
      const safePath = String(targetPath);
      if (safePath.includes("tight")) {
        return { bavail: 5, bsize: 100 };
      }
      if (safePath.includes("fast")) {
        return { bavail: 20, bsize: 100 };
      }
      return { bavail: 30, bsize: 100 };
    }) as any);

    installPrepareMocks({
      all: [
        [
          /FROM usage_statistics_daily\s+WHERE day >= \? AND day <= \?/,
          buildDailyRows(7, 1_000, 0, 0),
        ],
      ],
    });

    const runway = estimateDiskRunway(14);

    expect(runway.status).toBe("ok");
    expect(runway.rootPath).toContain("tight");
    expect(runway.freeBytes).toBe(500);
    expect(runway.volumes).toHaveLength(3);
  });
});
