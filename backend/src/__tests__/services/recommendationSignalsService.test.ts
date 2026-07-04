import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrepare = vi.fn();
const mockIsStatisticsEnabled = vi.fn();

vi.mock("../../db", () => ({
  sqlite: {
    prepare: (...args: unknown[]) => mockPrepare(...args),
  },
}));

vi.mock("../../services/statistics/collector", () => ({
  isStatisticsEnabled: () => mockIsStatisticsEnabled(),
}));

import {
  getRecommendationSignals,
  invalidateRecommendationSignalsCache,
} from "../../services/recommendationSignalsService";

interface MockRows {
  videos?: unknown[];
  events?: unknown[];
  subscriptions?: unknown[];
}

const installRows = (rows: MockRows): void => {
  mockPrepare.mockImplementation((sql: string) => {
    const all = vi.fn(() => {
      if (sql.includes("FROM videos")) return rows.videos ?? [];
      if (sql.includes("FROM usage_statistics_events")) return rows.events ?? [];
      if (sql.includes("FROM subscriptions")) return rows.subscriptions ?? [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    return { all };
  });
};

describe("recommendationSignalsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00Z"));
    mockIsStatisticsEnabled.mockReturnValue(true);
    invalidateRecommendationSignalsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null without querying when statistics are disabled", () => {
    mockIsStatisticsEnabled.mockReturnValue(false);

    expect(getRecommendationSignals()).toBeNull();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it("aggregates watch, affinity, and co-play signals", () => {
    const now = Date.now();
    installRows({
      videos: [
        {
          id: "v1",
          author: "Ada",
          channelUrl: "https://example.com/ada",
          tags: JSON.stringify(["React"]),
          duration: "100",
          rating: 5,
          viewCount: 2,
          progress: 0,
          lastPlayedAt: null,
          visibility: 1,
        },
        {
          id: "v2",
          author: "Grace",
          channelUrl: "https://example.com/grace",
          tags: JSON.stringify(["React", "TypeScript"]),
          duration: "100",
          rating: 4,
          viewCount: 1,
          progress: 0,
          lastPlayedAt: null,
          visibility: 1,
        },
      ],
      subscriptions: [
        { author: "Ada", authorUrl: "https://example.com/ada" },
      ],
      events: [
        {
          eventType: "video_play_started",
          recordedAt: now - 10_000,
          sessionId: "s1",
          videoId: "v1",
          durationSeconds: null,
        },
        {
          eventType: "video_watch_chunk_recorded",
          recordedAt: now - 9_000,
          sessionId: "s1",
          videoId: "v1",
          durationSeconds: 100,
        },
        {
          eventType: "video_play_started",
          recordedAt: now - 8_000,
          sessionId: "s1",
          videoId: "v2",
          durationSeconds: null,
        },
        {
          eventType: "video_watch_chunk_recorded",
          recordedAt: now - 7_000,
          sessionId: "s1",
          videoId: "v2",
          durationSeconds: 95,
        },
        {
          eventType: "video_play_started",
          recordedAt: now - 6_000,
          sessionId: "s2",
          videoId: "v1",
          durationSeconds: null,
        },
        {
          eventType: "video_watch_chunk_recorded",
          recordedAt: now - 5_000,
          sessionId: "s2",
          videoId: "v1",
          durationSeconds: 10,
        },
      ],
    });

    const signals = getRecommendationSignals();

    expect(signals).not.toBeNull();
    expect(signals?.perVideo.v1.ws).toBeGreaterThan(0);
    expect(signals?.perVideo.v1.ar).toBe(0.5);
    expect(signals?.perVideo.v1.rw).toBe(0.5);
    expect(signals?.perVideo.v1.nb[0][0]).toBe("v2");
    expect(signals?.authorAffinity["https://example.com/ada"]).toBeGreaterThan(0.15);
    expect(signals?.tagAffinity.react).toBeGreaterThan(0);
    expect(
      (signals?.durationBands ?? []).reduce(
        (sum: number, value: number) => sum + value,
        0
      )
    ).toBeCloseTo(1);
  });

  it("filters hidden videos and neighbors for visitor signals", () => {
    const now = Date.now();
    installRows({
      videos: [
        {
          id: "visible",
          author: "Ada",
          channelUrl: null,
          tags: JSON.stringify(["public"]),
          duration: "100",
          rating: null,
          viewCount: 1,
          progress: 0,
          lastPlayedAt: null,
          visibility: 1,
        },
        {
          id: "hidden",
          author: "Hidden",
          channelUrl: null,
          tags: JSON.stringify(["private"]),
          duration: "100",
          rating: null,
          viewCount: 1,
          progress: 0,
          lastPlayedAt: null,
          visibility: 0,
        },
      ],
      events: [
        {
          eventType: "video_play_started",
          recordedAt: now - 3_000,
          sessionId: "s1",
          videoId: "visible",
          durationSeconds: null,
        },
        {
          eventType: "video_watch_chunk_recorded",
          recordedAt: now - 2_000,
          sessionId: "s1",
          videoId: "visible",
          durationSeconds: 100,
        },
        {
          eventType: "video_play_started",
          recordedAt: now - 1_000,
          sessionId: "s1",
          videoId: "hidden",
          durationSeconds: null,
        },
        {
          eventType: "video_watch_chunk_recorded",
          recordedAt: now - 500,
          sessionId: "s1",
          videoId: "hidden",
          durationSeconds: 100,
        },
      ],
    });

    const signals = getRecommendationSignals("visitor");

    expect(signals?.perVideo.visible).toBeDefined();
    expect(signals?.perVideo.hidden).toBeUndefined();
    expect(signals?.perVideo.visible.nb).toEqual([]);
    expect(signals?.tagAffinity.private).toBeUndefined();
  });

  it("segments repeated watches of the same video by play instance", () => {
    const now = Date.now();
    installRows({
      videos: [
        {
          id: "repeat",
          author: "Ada",
          channelUrl: null,
          tags: "[]",
          duration: "100",
          rating: null,
          viewCount: 1,
          progress: 0,
          lastPlayedAt: null,
          visibility: 1,
        },
      ],
      events: [
        {
          eventType: "video_play_started",
          recordedAt: now - 4_000,
          sessionId: "s1",
          videoId: "repeat",
          durationSeconds: null,
        },
        {
          eventType: "video_watch_chunk_recorded",
          recordedAt: now - 3_000,
          sessionId: "s1",
          videoId: "repeat",
          durationSeconds: 20,
        },
        {
          eventType: "video_play_started",
          recordedAt: now - 2_000,
          sessionId: "s1",
          videoId: "repeat",
          durationSeconds: null,
        },
        {
          eventType: "video_watch_chunk_recorded",
          recordedAt: now - 1_000,
          sessionId: "s1",
          videoId: "repeat",
          durationSeconds: 20,
        },
      ],
    });

    const signals = getRecommendationSignals();

    expect(signals?.perVideo.repeat.cr).toBe(0.2);
    expect(signals?.perVideo.repeat.ar).toBe(1);
    expect(signals?.perVideo.repeat.rw).toBe(0.5);
    expect(signals?.perVideo.repeat.lf).toBeNull();
  });

  it("does not count fully watched short videos as abandoned", () => {
    const now = Date.now();
    installRows({
      videos: [
        {
          id: "short",
          author: "Ada",
          channelUrl: null,
          tags: "[]",
          duration: "20",
          rating: null,
          viewCount: 1,
          progress: 0,
          lastPlayedAt: null,
          visibility: 1,
        },
        {
          id: "next",
          author: "Ada",
          channelUrl: null,
          tags: "[]",
          duration: "60",
          rating: null,
          viewCount: 1,
          progress: 0,
          lastPlayedAt: null,
          visibility: 1,
        },
      ],
      events: [
        {
          eventType: "video_play_started",
          recordedAt: now - 4_000,
          sessionId: "s1",
          videoId: "short",
          durationSeconds: null,
        },
        {
          eventType: "video_watch_chunk_recorded",
          recordedAt: now - 3_000,
          sessionId: "s1",
          videoId: "short",
          durationSeconds: 20,
        },
        {
          eventType: "video_play_started",
          recordedAt: now - 2_000,
          sessionId: "s1",
          videoId: "next",
          durationSeconds: null,
        },
        {
          eventType: "video_watch_chunk_recorded",
          recordedAt: now - 1_000,
          sessionId: "s1",
          videoId: "next",
          durationSeconds: 60,
        },
      ],
    });

    const signals = getRecommendationSignals();

    expect(signals?.perVideo.short.cr).toBe(1);
    expect(signals?.perVideo.short.ar).toBe(0);
    expect(signals?.perVideo.short.nb[0][0]).toBe("next");
  });
});
