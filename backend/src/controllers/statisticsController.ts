import express, { Request, RequestHandler, Response } from "express";
import {
  clearAllStatisticsData,
  estimateDiskRunway,
  exportRawEvents,
  getHealthSnapshot,
  getOverview,
  getRanking,
  getTimeseries,
  ingestBatch,
  isStatisticsEnabled,
  recomputeAllUnsealedDays,
  shouldTrackVisitorActivity,
} from "../services/statistics";
import { getClientIp } from "../utils/security";
import { logger } from "../utils/logger";
import { sendBadRequest } from "../utils/response";

const MAX_EVENTS_PER_REQUEST = 50;
const MAX_REQUEST_SIZE_BYTES = 128 * 1024;
const MAX_REQUEST_SIZE_LABEL = "128kb";
const MAX_EVENTS_PER_SESSION_PER_MINUTE = 300;

type SessionEventQuota = {
  count: number;
  minuteBucket: number;
};

const statisticsEventsJsonParserImpl = express.json({
  limit: MAX_REQUEST_SIZE_LABEL,
});

const sessionEventQuotaByKey = new Map<string, SessionEventQuota>();

export const statisticsEventsJsonParser: RequestHandler = (
  req,
  res,
  next
) => {
  statisticsEventsJsonParserImpl(req, res, (error?: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      (error as { type?: string }).type === "entity.too.large"
    ) {
      res.status(413).json({ success: false, error: "Payload too large." });
      return;
    }
    next(error as any);
  });
};

const isAdminCaller = (req: Request): boolean => {
  if (req.apiKeyAuthenticated === true) return false;
  if (!req.user) {
    // When loginEnabled = false we treat caller as owner-equivalent.
    return true;
  }
  return req.user.role === "admin";
};

const isVisitorCaller = (req: Request): boolean => {
  return req.user?.role === "visitor";
};

const requireAdminAccess = (req: Request, res: Response): boolean => {
  if (req.apiKeyAuthenticated === true) {
    res
      .status(403)
      .json({ success: false, error: "API key authentication cannot access statistics." });
    return false;
  }
  if (!req.user) {
    return true;
  }
  if (req.user.role === "admin") return true;
  res.status(403).json({ success: false, error: "Admin access is required." });
  return false;
};

const detectSurface = (req: Request): "web" | "extension" | "api" => {
  const headerName = "x-mytube-client";
  const value = req.headers[headerName];
  if (typeof value === "string" && value.toLowerCase() === "extension") {
    return "extension";
  }
  if (req.apiKeyAuthenticated === true) return "api";
  return "web";
};

const cleanupExpiredSessionQuotas = (currentMinuteBucket: number): void => {
  for (const [key, value] of sessionEventQuotaByKey.entries()) {
    if (value.minuteBucket < currentMinuteBucket) {
      sessionEventQuotaByKey.delete(key);
    }
  }
};

const takeSessionEventQuota = (
  events: unknown[],
  fallbackSessionKey: string
): { allowedEvents: unknown[]; droppedCount: number } => {
  const currentMinuteBucket = Math.floor(Date.now() / 60_000);
  cleanupExpiredSessionQuotas(currentMinuteBucket);

  const allowedEvents: unknown[] = [];
  let droppedCount = 0;

  for (const event of events) {
    const eventSessionId =
      typeof event === "object" &&
      event !== null &&
      typeof (event as { sessionId?: unknown }).sessionId === "string" &&
      (event as { sessionId: string }).sessionId.trim().length > 0
        ? (event as { sessionId: string }).sessionId.trim()
        : fallbackSessionKey;

    const currentQuota = sessionEventQuotaByKey.get(eventSessionId);
    const quota: SessionEventQuota =
      currentQuota && currentQuota.minuteBucket === currentMinuteBucket
        ? currentQuota
        : { count: 0, minuteBucket: currentMinuteBucket };

    if (quota.count >= MAX_EVENTS_PER_SESSION_PER_MINUTE) {
      droppedCount += 1;
      continue;
    }

    quota.count += 1;
    sessionEventQuotaByKey.set(eventSessionId, quota);
    allowedEvents.push(event);
  }

  return { allowedEvents, droppedCount };
};

export const ingestEvents = async (
  req: Request,
  res: Response
): Promise<void> => {
  // Per-route gate: visitor writes only allowed when statisticsTrackVisitorActivity = true.
  // We do not relax the global VISITOR_ALLOWED_POST_EXACT_PATHS list. The roleBasedAuthMiddleware
  // already runs ahead of us, so visitors normally would not reach POST handlers; we mount the
  // gate inside the route handler rather than the global allowlist.
  if (isVisitorCaller(req) && !shouldTrackVisitorActivity()) {
    res.status(403).json({
      success: false,
      error: "Visitor statistics ingestion is disabled.",
    });
    return;
  }

  if (!isStatisticsEnabled()) {
    // Quietly accept without writing so the client doesn't get a noisy error.
    res.status(202).json({ acceptedCount: 0, droppedCount: 0, sealedDayDropCount: 0 });
    return;
  }

  if (req.headers["content-length"]) {
    const length = Number(req.headers["content-length"]);
    if (Number.isFinite(length) && length > MAX_REQUEST_SIZE_BYTES) {
      res.status(413).json({ success: false, error: "Payload too large." });
      return;
    }
  }

  const events = Array.isArray(req.body?.events) ? req.body.events : null;
  if (!events) {
    sendBadRequest(res, "Invalid events payload.");
    return;
  }
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    sendBadRequest(
      res,
      `Too many events in one batch (max ${MAX_EVENTS_PER_REQUEST}).`
    );
    return;
  }

  const actorRole: "admin" | "visitor" = isVisitorCaller(req) ? "visitor" : "admin";
  const surface = detectSurface(req);
  const fallbackSessionKey = `${surface}:${getClientIp(req)}`;
  const { allowedEvents, droppedCount: rateLimitedDropCount } =
    takeSessionEventQuota(events, fallbackSessionKey);
  const result =
    allowedEvents.length > 0
      ? ingestBatch(allowedEvents as Parameters<typeof ingestBatch>[0], {
          actorRole,
          surface,
        })
      : {
          acceptedCount: 0,
          droppedCount: 0,
          sealedDayDropCount: 0,
        };
  result.droppedCount += rateLimitedDropCount;
  res.status(202).json(result);
};

export const getOverviewEndpoint = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!requireAdminAccess(req, res)) return;
  const range = parseRange(req.query.range);
  try {
    const overview = getOverview(range);
    const runway = estimateDiskRunway();
    res.json({ ...overview, diskRunway: runway, statisticsEnabled: isStatisticsEnabled() });
  } catch (error) {
    logger.warn(
      "statistics overview failed",
      error instanceof Error ? error : new Error(String(error))
    );
    res.status(500).json({ success: false, error: "Failed to load statistics overview." });
  }
};

export const getTimeseriesEndpoint = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!requireAdminAccess(req, res)) return;
  const metric = String(req.params.metric || "");
  if (!metric) {
    sendBadRequest(res, "Metric name is required.");
    return;
  }
  const range = parseRange(req.query.range);
  const filters = {
    platform:
      typeof req.query.platform === "string" ? req.query.platform : undefined,
    actorRole:
      typeof req.query.actorRole === "string" ? req.query.actorRole : undefined,
    sourceKind:
      typeof req.query.sourceKind === "string" ? req.query.sourceKind : undefined,
  };
  res.json({ metric, points: getTimeseries(metric, range, filters) });
};

export const getRankingEndpoint = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!requireAdminAccess(req, res)) return;
  const metric = String(req.params.metric || "");
  if (!metric) {
    sendBadRequest(res, "Metric name is required.");
    return;
  }
  const limit =
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 20;
  res.json({ metric, rows: getRanking(metric, Number.isFinite(limit) ? limit : 20) });
};

export const getHealthEndpoint = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!requireAdminAccess(req, res)) return;
  res.json(getHealthSnapshot());
};

export const exportEndpoint = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!requireAdminAccess(req, res)) return;
  const format = req.query.format === "csv" ? "csv" : "json";
  const view =
    typeof req.query.view === "string" ? req.query.view : undefined;
  const fromDay = typeof req.query.fromDay === "string" ? req.query.fromDay : undefined;
  const toDay = typeof req.query.toDay === "string" ? req.query.toDay : undefined;
  const metric =
    typeof req.query.metric === "string" ? req.query.metric : undefined;
  const rangeDays =
    typeof req.query.range === "string"
      ? parseRange(req.query.range)
      : undefined;
  const limit =
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
  const body = exportRawEvents({
    format,
    view:
      view === "dashboard" ||
      view === "events" ||
      view === "ranking" ||
      view === "timeseries"
        ? view
        : undefined,
    metric,
    fromDay,
    toDay,
    rangeDays,
    platform:
      typeof req.query.platform === "string" ? req.query.platform : undefined,
    actorRole:
      typeof req.query.actorRole === "string" ? req.query.actorRole : undefined,
    sourceKind:
      typeof req.query.sourceKind === "string" ? req.query.sourceKind : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  if (format === "csv") {
    res.type("text/csv").send(body);
  } else {
    res.type("application/json").send(body);
  }
};

export const recomputeEndpoint = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!requireAdminAccess(req, res)) return;
  const daysProcessed = await recomputeAllUnsealedDays();
  res.json({ success: true, daysProcessed });
};

export const clearEndpoint = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!requireAdminAccess(req, res)) return;
  try {
    clearAllStatisticsData();
    res.json({ success: true });
  } catch (error) {
    logger.error(
      "failed to clear statistics data",
      error instanceof Error ? error : new Error(String(error))
    );
    res.status(500).json({ success: false, error: "Failed to clear statistics data." });
  }
};

function parseRange(value: unknown): number {
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 365) return parsed;
  }
  return 30;
}

// Suppress TS unused complaint when admin caller is locally not used.
void isAdminCaller;
