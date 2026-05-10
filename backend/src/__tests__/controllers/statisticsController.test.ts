import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIngestBatch = vi.fn();
const mockIsStatisticsEnabled = vi.fn();
const mockShouldTrackVisitorActivity = vi.fn();
const mockExportRawEvents = vi.fn();

vi.mock("../../services/statistics", () => ({
  clearAllStatisticsData: vi.fn(),
  estimateDiskRunway: vi.fn(),
  exportRawEvents: (...args: any[]) => mockExportRawEvents(...args),
  getHealthSnapshot: vi.fn(),
  getOverview: vi.fn(),
  getRanking: vi.fn(),
  getTimeseries: vi.fn(),
  ingestBatch: (...args: any[]) => mockIngestBatch(...args),
  isStatisticsEnabled: () => mockIsStatisticsEnabled(),
  recomputeAllUnsealedDays: vi.fn(),
  shouldTrackVisitorActivity: () => mockShouldTrackVisitorActivity(),
}));

vi.mock("../../utils/security", () => ({
  getClientIp: vi.fn(() => "203.0.113.55"),
}));

import {
  exportEndpoint,
  ingestEvents,
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
});
