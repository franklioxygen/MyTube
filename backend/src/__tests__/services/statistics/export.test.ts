import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSettings = vi.fn();
const mockGetOverview = vi.fn();
const mockGetHealthSnapshot = vi.fn();
const mockGetTimeseries = vi.fn();
const mockGetRanking = vi.fn();

vi.mock("../../../db", () => ({
  sqlite: { prepare: vi.fn() },
}));

vi.mock("../../../services/storageService", () => ({
  getSettings: () => mockGetSettings(),
}));

vi.mock("../../../services/statistics/health", () => ({
  getHealthSnapshot: () => mockGetHealthSnapshot(),
}));

vi.mock("../../../services/statistics/queries", () => ({
  getOverview: (...args: any[]) => mockGetOverview(...args),
  getRanking: (...args: any[]) => mockGetRanking(...args),
  getTimeseries: (...args: any[]) => mockGetTimeseries(...args),
}));

import { sqlite } from "../../../db";
import { exportRawEvents } from "../../../services/statistics/export";

function makeStmt(allResult: unknown) {
  return {
    all: vi.fn().mockReturnValue(allResult),
    get: vi.fn(),
    run: vi.fn(),
  };
}

describe("statistics export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({});
    mockGetOverview.mockReturnValue({
      totalVideos: 12,
      totalStorageBytes: 2_048,
      activeSubscriptions: 3,
      pausedSubscriptions: 1,
      activeRssTokens: 2,
      collectionCoverage: 5,
      subtitleCoverage: 4,
      thumbnailCoverage: 6,
      downloadSuccessRate: 0.8,
      downloadVolumeBytes: 1_024,
      netNewVideos: 7,
      watchSecondsLastRange: 600,
      alerts: [{ key: "warn-1", severity: "warning", title: "Warning 1" }],
    });
    mockGetHealthSnapshot.mockReturnValue({
      warning: true,
      dirtyDayCount: 2,
      sealedDayCount: 1,
      trailingHour: { accepted: 3, dropped: 1, error: 0, sealedDayDrop: 0 },
    });
    mockGetTimeseries.mockReturnValue([{ day: "2026-01-01", count: 2, sum: 120 }]);
    mockGetRanking.mockReturnValue([
      { key: "row-1", label: "Row 1", count: 3, sum: 450, meta: { source: "mock" } },
    ]);
  });

  it("exports raw events as JSON and redacts search text by default", () => {
    vi.mocked(sqlite.prepare).mockReturnValue(
      makeStmt([
        {
          id: "evt-1",
          schemaVersion: 1,
          eventType: "search_submitted",
          recordedAt: 1,
          clientOccurredAt: null,
          day: "2026-01-01",
          actorRole: "admin",
          surface: "web",
          sessionId: "sess-1",
          relatedEventId: null,
          videoId: null,
          collectionId: null,
          subscriptionId: null,
          rssTokenId: null,
          platform: "youtube",
          sourceKind: "search_result",
          durationSeconds: null,
          value: null,
          payload: JSON.stringify({ query: "secret", queryText: "keep out", localResultCount: 1 }),
        },
      ]) as any
    );

    const output = exportRawEvents({
      format: "json",
      view: "events",
      fromDay: "2026-01-01",
      toDay: "2026-01-31",
    });

    expect(JSON.parse(output)).toEqual({
      view: "events",
      events: [
        expect.objectContaining({
          id: "evt-1",
          payload: JSON.stringify({ localResultCount: 1 }),
        }),
      ],
    });
  });

  it("exports raw events as CSV and preserves search text when the setting is enabled", () => {
    mockGetSettings.mockReturnValue({ statisticsCaptureSearchText: true });
    vi.mocked(sqlite.prepare).mockReturnValue(
      makeStmt([
        {
          id: "evt-2",
          schemaVersion: 1,
          eventType: "search_submitted",
          recordedAt: 2,
          clientOccurredAt: 1,
          day: "2026-01-02",
          actorRole: "visitor",
          surface: "web",
          sessionId: "sess-2",
          relatedEventId: null,
          videoId: null,
          collectionId: null,
          subscriptionId: null,
          rssTokenId: null,
          platform: "youtube",
          sourceKind: "search_result",
          durationSeconds: null,
          value: null,
          payload: JSON.stringify({ queryText: "hello,world" }),
        },
      ]) as any
    );

    const output = exportRawEvents({ format: "csv", view: "events" });

    expect(output).toContain("event_type");
    expect(output).toContain('"{""queryText"":""hello,world""}"');
  });

  it("exports timeseries views in JSON and CSV with normalized range/filter values", () => {
    const jsonOutput = exportRawEvents({
      format: "json",
      view: "timeseries",
      metric: "watch_seconds",
      rangeDays: 999,
      platform: "youtube",
      actorRole: "admin",
      sourceKind: "subscription",
    });
    const csvOutput = exportRawEvents({
      format: "csv",
      view: "timeseries",
      metric: "watch_seconds",
      rangeDays: 999,
      platform: "youtube",
      actorRole: "admin",
      sourceKind: "subscription",
    });

    expect(mockGetTimeseries).toHaveBeenCalledWith("watch_seconds", 365, {
      platform: "youtube",
      actorRole: "admin",
      sourceKind: "subscription",
    });
    expect(JSON.parse(jsonOutput)).toEqual({
      view: "timeseries",
      metric: "watch_seconds",
      rangeDays: 365,
      filters: {
        platform: "youtube",
        actorRole: "admin",
        sourceKind: "subscription",
      },
      points: [{ day: "2026-01-01", count: 2, sum: 120 }],
    });
    expect(csvOutput).toBe("day,count,sum\n2026-01-01,2,120");
  });

  it("exports ranking views with normalized limits", () => {
    const jsonOutput = exportRawEvents({
      format: "json",
      view: "ranking",
      metric: "largest_never_watched",
      limit: 999,
    });
    const csvOutput = exportRawEvents({
      format: "csv",
      view: "ranking",
      metric: "largest_never_watched",
      limit: 999,
    });

    expect(mockGetRanking).toHaveBeenCalledWith("largest_never_watched", 200);
    expect(JSON.parse(jsonOutput)).toEqual({
      view: "ranking",
      metric: "largest_never_watched",
      limit: 200,
      rows: [{ key: "row-1", label: "Row 1", count: 3, sum: 450, meta: { source: "mock" } }],
    });
    expect(csvOutput).toContain("key,label,count,sum");
    expect(csvOutput).toContain("row-1,Row 1,3,450");
  });

  it("exports dashboard views in JSON and CSV", () => {
    const jsonOutput = exportRawEvents({
      format: "json",
      view: "dashboard",
      rangeDays: 90,
      platform: "youtube",
      actorRole: "admin",
      sourceKind: "subscription",
    });
    const csvOutput = exportRawEvents({
      format: "csv",
      view: "dashboard",
      rangeDays: 90,
      platform: "youtube",
      actorRole: "admin",
      sourceKind: "subscription",
    });

    expect(mockGetOverview).toHaveBeenCalledWith(90);
    expect(mockGetTimeseries).toHaveBeenCalledWith("watch_seconds", 90, {
      platform: "youtube",
      actorRole: "admin",
      sourceKind: "subscription",
    });
    expect(mockGetRanking).toHaveBeenCalledWith("top_watched_videos", 10);
    expect(JSON.parse(jsonOutput)).toEqual({
      view: "dashboard",
      rangeDays: 90,
      overview: expect.objectContaining({ totalVideos: 12 }),
      health: expect.objectContaining({ warning: true }),
      timeseries: expect.any(Object),
      rankings: expect.any(Object),
    });
    expect(csvOutput).toContain("section,key,label,value,count,sum,meta");
    expect(csvOutput).toContain("overview_alert,warn-1,Warning 1,warning,,,");
    expect(csvOutput).toContain("health,warning,warning,true");
    expect(csvOutput).toContain("timeseries,watch_seconds,2026-01-01,,2,120,");
    expect(csvOutput).toContain('ranking,top_watched_videos,Row 1,row-1,3,450,"{""source"":""mock""}"');
  });

  it("infers the export view from filter options when view is omitted", () => {
    vi.mocked(sqlite.prepare).mockReturnValue(makeStmt([]) as any);

    const inferredEvents = exportRawEvents({
      format: "json",
      fromDay: "2026-01-01",
    });
    const inferredTimeseries = exportRawEvents({
      format: "json",
      metric: "watch_seconds",
    });
    const inferredDashboard = exportRawEvents({ format: "json" });

    expect(JSON.parse(inferredEvents)).toEqual({ view: "events", events: [] });
    expect(JSON.parse(inferredTimeseries)).toEqual(
      expect.objectContaining({ view: "timeseries", metric: "watch_seconds" })
    );
    expect(JSON.parse(inferredDashboard)).toEqual(
      expect.objectContaining({ view: "dashboard", rangeDays: 30 })
    );
  });
});
