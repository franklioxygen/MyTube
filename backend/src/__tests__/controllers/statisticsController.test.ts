import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIngestBatch = vi.fn();
const mockIsStatisticsEnabled = vi.fn();
const mockShouldTrackVisitorActivity = vi.fn();
const mockExportRawEvents = vi.fn();
const mockGetHealthSnapshot = vi.fn();
const mockGetOverview = vi.fn();
const mockGetTimeseries = vi.fn();
const mockGetRanking = vi.fn();
const mockRecomputeAllUnsealedDays = vi.fn();
const mockClearAllStatisticsData = vi.fn();
const mockEstimateDiskRunway = vi.fn();

vi.mock("../../services/statistics", () => ({
  clearAllStatisticsData: (...args: any[]) => mockClearAllStatisticsData(...args),
  estimateDiskRunway: () => mockEstimateDiskRunway(),
  exportRawEvents: (...args: any[]) => mockExportRawEvents(...args),
  getHealthSnapshot: () => mockGetHealthSnapshot(),
  getOverview: (...args: any[]) => mockGetOverview(...args),
  getRanking: (...args: any[]) => mockGetRanking(...args),
  getTimeseries: (...args: any[]) => mockGetTimeseries(...args),
  ingestBatch: (...args: any[]) => mockIngestBatch(...args),
  isStatisticsEnabled: () => mockIsStatisticsEnabled(),
  recomputeAllUnsealedDays: () => mockRecomputeAllUnsealedDays(),
  shouldTrackVisitorActivity: () => mockShouldTrackVisitorActivity(),
}));

vi.mock("../../utils/security", () => ({
  getClientIp: vi.fn(() => "203.0.113.55"),
}));

import {
  clearEndpoint,
  exportEndpoint,
  getHealthEndpoint,
  getOverviewEndpoint,
  getRankingEndpoint,
  getTimeseriesEndpoint,
  ingestEvents,
  recomputeEndpoint,
  statisticsEventsJsonParser,
} from "../../controllers/statisticsController";

const createResponse = () => {
  const response: any = {};
  response.status = vi.fn().mockReturnValue(response);
  response.json = vi.fn().mockReturnValue(response);
  response.type = vi.fn().mockReturnValue(response);
  response.send = vi.fn().mockReturnValue(response);
  response.end = vi.fn().mockReturnValue(response);
  response.setHeader = vi.fn().mockReturnValue(response);
  return response;
};

const createEvents = (count: number, sessionId: string) =>
  Array.from({ length: count }, (_value, index) => ({
    eventType: "search_submitted",
    sessionId,
    payload: { index },
  }));

describe("statisticsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsStatisticsEnabled.mockReturnValue(true);
    mockShouldTrackVisitorActivity.mockReturnValue(true);
    mockExportRawEvents.mockReturnValue('export-data');
    mockIngestBatch.mockImplementation((events: any[]) => ({
      acceptedCount: events.length,
      droppedCount: 0,
      sealedDayDropCount: 0,
    }));
  });

  it("drops events that exceed the per-session 300 events/minute cap", async () => {
    const sessionId = "statistics-session-cap";

    for (let i = 0; i < 6; i += 1) {
      const req: any = {
        body: { events: createEvents(50, sessionId) },
        headers: {},
        user: { role: "admin" },
        apiKeyAuthenticated: false,
      };
      const res = createResponse();

      await ingestEvents(req, res);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        acceptedCount: 50,
        droppedCount: 0,
        sealedDayDropCount: 0,
      });
    }

    const req: any = {
      body: { events: createEvents(1, sessionId) },
      headers: {},
      user: { role: "admin" },
      apiKeyAuthenticated: false,
    };
    const res = createResponse();

    await ingestEvents(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      acceptedCount: 0,
      droppedCount: 1,
      sealedDayDropCount: 0,
    });
  });

  it("rejects oversized statistics bodies with a real 128 KB parser", async () => {
    const app = express();
    app.post(
      "/api/statistics/events",
      statisticsEventsJsonParser,
      (_req, res) => {
        res.status(204).send();
      }
    );

    const response = await request(app)
      .post("/api/statistics/events")
      .set("Content-Type", "application/json")
      .send({
        events: [
          {
            eventType: "search_submitted",
            sessionId: "oversized-session",
            payload: {
              queryText: "x".repeat(130 * 1024),
            },
          },
        ],
      });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      success: false,
      error: "Payload too large.",
    });
  });

  it("exports dashboard views with range and filter options", async () => {
    const req: any = {
      query: {
        format: "csv",
        view: "dashboard",
        range: "90",
        platform: "youtube",
        actorRole: "admin",
        sourceKind: "subscription",
        limit: "15",
      },
      apiKeyAuthenticated: false,
      user: { role: "admin" },
    };
    const res = createResponse();

    await exportEndpoint(req, res);

    expect(mockExportRawEvents).toHaveBeenCalledWith({
      format: "csv",
      view: "dashboard",
      metric: undefined,
      fromDay: undefined,
      toDay: undefined,
      rangeDays: 90,
      platform: "youtube",
      actorRole: "admin",
      sourceKind: "subscription",
      limit: 15,
    });
    expect(res.type).toHaveBeenCalledWith("text/csv; charset=utf-8");
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Content-Type-Options",
      "nosniff"
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="statistics-export.csv"'
    );
    expect(res.end).toHaveBeenCalledWith("export-data", "utf8");
  });

  it("exports JSON format with correct headers", async () => {
    mockExportRawEvents.mockReturnValue('{"data":[]}');
    const req: any = {
      query: { format: "json" },
      apiKeyAuthenticated: false,
      user: { role: "admin" },
    };
    const res = createResponse();

    await exportEndpoint(req, res);

    expect(res.type).toHaveBeenCalledWith("application/json");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="statistics-export.json"'
    );
  });

  it("returns 500 on JSON parse failure in exportEndpoint", async () => {
    mockExportRawEvents.mockReturnValue("not-valid-json");
    const req: any = {
      query: { format: "json" },
      apiKeyAuthenticated: false,
      user: { role: "admin" },
    };
    const res = createResponse();

    await exportEndpoint(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 403 when API key tries to access exportEndpoint", async () => {
    const req: any = {
      query: { format: "csv" },
      apiKeyAuthenticated: true,
    };
    const res = createResponse();

    await exportEndpoint(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("getHealthEndpoint returns health snapshot", async () => {
    mockGetHealthSnapshot.mockReturnValue({ warning: false, dirtyDayCount: 0 });
    const req: any = { apiKeyAuthenticated: false, user: { role: "admin" } };
    const res = createResponse();

    await getHealthEndpoint(req, res);

    expect(res.json).toHaveBeenCalledWith({ warning: false, dirtyDayCount: 0 });
  });

  it("getHealthEndpoint returns 403 for non-admin user", async () => {
    const req: any = { apiKeyAuthenticated: false, user: { role: "visitor" } };
    const res = createResponse();

    await getHealthEndpoint(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("getOverviewEndpoint returns merged overview and runway", async () => {
    mockGetOverview.mockReturnValue({ totalEvents: 42 });
    mockEstimateDiskRunway.mockReturnValue({ status: "ok" });
    mockIsStatisticsEnabled.mockReturnValue(true);
    const req: any = {
      query: { range: "7" },
      apiKeyAuthenticated: false,
      user: { role: "admin" },
    };
    const res = createResponse();

    await getOverviewEndpoint(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ totalEvents: 42, diskRunway: { status: "ok" } })
    );
  });

  it("getOverviewEndpoint returns 500 when getOverview throws", async () => {
    mockGetOverview.mockImplementation(() => { throw new Error("query failed"); });
    const req: any = {
      query: {},
      apiKeyAuthenticated: false,
      user: { role: "admin" },
    };
    const res = createResponse();

    await getOverviewEndpoint(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("getTimeseriesEndpoint returns timeseries data", async () => {
    mockGetTimeseries.mockReturnValue([{ day: "2024-01-01", value: 5 }]);
    const req: any = {
      params: { metric: "search_submitted" },
      query: { range: "30" },
      apiKeyAuthenticated: false,
      user: { role: "admin" },
    };
    const res = createResponse();

    await getTimeseriesEndpoint(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ metric: "search_submitted" })
    );
  });

  it("getTimeseriesEndpoint returns 400 when metric is missing", async () => {
    const req: any = {
      params: { metric: "" },
      query: {},
      apiKeyAuthenticated: false,
      user: { role: "admin" },
    };
    const res = createResponse();

    await getTimeseriesEndpoint(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("getRankingEndpoint returns ranking rows", async () => {
    mockGetRanking.mockReturnValue([{ videoId: "v1", count: 10 }]);
    const req: any = {
      params: { metric: "video_play_started" },
      query: { limit: "10" },
      apiKeyAuthenticated: false,
      user: { role: "admin" },
    };
    const res = createResponse();

    await getRankingEndpoint(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ metric: "video_play_started" })
    );
  });

  it("getRankingEndpoint returns 400 when metric is missing", async () => {
    const req: any = {
      params: { metric: "" },
      query: {},
      apiKeyAuthenticated: false,
      user: { role: "admin" },
    };
    const res = createResponse();

    await getRankingEndpoint(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("recomputeEndpoint calls recomputeAllUnsealedDays and returns result", async () => {
    mockRecomputeAllUnsealedDays.mockResolvedValue(5);
    const req: any = { apiKeyAuthenticated: false, user: { role: "admin" } };
    const res = createResponse();

    await recomputeEndpoint(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, daysProcessed: 5 });
  });

  it("clearEndpoint clears all statistics data", async () => {
    const req: any = { apiKeyAuthenticated: false, user: { role: "admin" } };
    const res = createResponse();

    await clearEndpoint(req, res);

    expect(mockClearAllStatisticsData).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("clearEndpoint returns 500 when clearAllStatisticsData throws", async () => {
    mockClearAllStatisticsData.mockImplementation(() => { throw new Error("disk error"); });
    const req: any = { apiKeyAuthenticated: false, user: { role: "admin" } };
    const res = createResponse();

    await clearEndpoint(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("rejects any endpoint when user role is visitor", async () => {
    const req: any = { apiKeyAuthenticated: false, user: { role: "visitor" } };
    const res = createResponse();

    await getHealthEndpoint(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it("allows access when there is no user (loginEnabled = false)", async () => {
    mockGetHealthSnapshot.mockReturnValue({ warning: false });
    const req: any = { apiKeyAuthenticated: false, user: undefined };
    const res = createResponse();

    await getHealthEndpoint(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ warning: false }));
  });

  it("ingestEvents returns 400 when events array is missing", async () => {
    const req: any = {
      body: {},
      headers: {},
      user: { role: "admin" },
      apiKeyAuthenticated: false,
    };
    const res = createResponse();

    await ingestEvents(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("ingestEvents returns 400 when events exceeds 50", async () => {
    const req: any = {
      body: { events: new Array(51).fill({ eventType: "search_submitted", sessionId: "s" }) },
      headers: {},
      user: { role: "admin" },
      apiKeyAuthenticated: false,
    };
    const res = createResponse();

    await ingestEvents(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
