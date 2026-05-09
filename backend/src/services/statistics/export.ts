// CSV/JSON export helpers for the statistics dashboard.

import { sqlite } from "../../db";
import * as storageService from "../storageService";
import { getHealthSnapshot } from "./health";
import { getOverview, getRanking, getTimeseries } from "./queries";

interface SettingsLike {
  statisticsCaptureSearchText?: boolean;
}

type ExportView = "dashboard" | "events" | "ranking" | "timeseries";

interface RawEventRow {
  id: string;
  schemaVersion: number;
  eventType: string;
  recordedAt: number;
  clientOccurredAt: number | null;
  day: string;
  actorRole: string;
  surface: string;
  sessionId: string | null;
  relatedEventId: string | null;
  videoId: string | null;
  collectionId: string | null;
  subscriptionId: string | null;
  rssTokenId: string | null;
  platform: string | null;
  sourceKind: string | null;
  durationSeconds: number | null;
  value: number | null;
  payload: string;
}

export interface ExportOptions {
  format: "csv" | "json";
  view?: ExportView;
  metric?: string;
  fromDay?: string;
  toDay?: string;
  rangeDays?: number;
  platform?: string;
  actorRole?: string;
  sourceKind?: string;
  limit?: number;
}

function shouldIncludeSearchText(): boolean {
  try {
    return (
      (storageService.getSettings() as SettingsLike).statisticsCaptureSearchText ===
      true
    );
  } catch {
    return false;
  }
}

function sanitizePayload(eventType: string, payload: string): string {
  if (eventType !== "search_submitted") return payload;
  if (shouldIncludeSearchText()) return payload;
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === "object") {
      delete (parsed as Record<string, unknown>).query;
      delete (parsed as Record<string, unknown>).queryText;
      return JSON.stringify(parsed);
    }
  } catch {
    return "{}";
  }
  return payload;
}

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function normalizeRangeDays(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.floor(value), 365);
  }
  return 30;
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.floor(value), 200);
  }
  return 20;
}

function getRawEvents(options: ExportOptions): RawEventRow[] {
  const args: unknown[] = [];
  let where = "";
  if (options.fromDay) {
    where += where ? " AND " : " WHERE ";
    where += "day >= ?";
    args.push(options.fromDay);
  }
  if (options.toDay) {
    where += where ? " AND " : " WHERE ";
    where += "day <= ?";
    args.push(options.toDay);
  }

  const rows = sqlite
    .prepare(
      `SELECT
         id,
         schema_version AS schemaVersion,
         event_type AS eventType,
         recorded_at AS recordedAt,
         client_occurred_at AS clientOccurredAt,
         day,
         actor_role AS actorRole,
         surface,
         session_id AS sessionId,
         related_event_id AS relatedEventId,
         video_id AS videoId,
         collection_id AS collectionId,
         subscription_id AS subscriptionId,
         rss_token_id AS rssTokenId,
         platform,
         source_kind AS sourceKind,
         duration_seconds AS durationSeconds,
         value,
         payload
       FROM usage_statistics_events
       ${where}
       ORDER BY recorded_at ASC`
    )
    .all(...args) as RawEventRow[];

  return rows.map((row) => ({
    ...row,
    payload: sanitizePayload(row.eventType, row.payload),
  }));
}

function exportEvents(options: ExportOptions): string {
  const rows = getRawEvents(options);
  if (options.format === "json") {
    return JSON.stringify({ view: "events", events: rows });
  }

  const header = [
    "id",
    "schema_version",
    "event_type",
    "recorded_at",
    "client_occurred_at",
    "day",
    "actor_role",
    "surface",
    "session_id",
    "related_event_id",
    "video_id",
    "collection_id",
    "subscription_id",
    "rss_token_id",
    "platform",
    "source_kind",
    "duration_seconds",
    "value",
    "payload",
  ];
  const lines = [header.join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.schemaVersion,
        row.eventType,
        row.recordedAt,
        row.clientOccurredAt ?? "",
        row.day,
        row.actorRole,
        row.surface,
        row.sessionId ?? "",
        row.relatedEventId ?? "",
        row.videoId ?? "",
        row.collectionId ?? "",
        row.subscriptionId ?? "",
        row.rssTokenId ?? "",
        row.platform ?? "",
        row.sourceKind ?? "",
        row.durationSeconds ?? "",
        row.value ?? "",
        csvEscape(row.payload),
      ].join(",")
    );
  }

  return lines.join("\n");
}

function exportTimeseries(options: ExportOptions): string {
  const metric = options.metric || "watch_seconds";
  const rangeDays = normalizeRangeDays(options.rangeDays);
  const filters = {
    platform: options.platform,
    actorRole: options.actorRole,
    sourceKind: options.sourceKind,
  };
  const points = getTimeseries(metric, rangeDays, filters);

  if (options.format === "json") {
    return JSON.stringify({
      view: "timeseries",
      metric,
      rangeDays,
      filters,
      points,
    });
  }

  const lines = ["day,count,sum"];
  for (const point of points) {
    lines.push([point.day, point.count, point.sum].join(","));
  }
  return lines.join("\n");
}

function exportRanking(options: ExportOptions): string {
  const metric = options.metric || "top_watched_videos";
  const limit = normalizeLimit(options.limit);
  const rows = getRanking(metric, limit);

  if (options.format === "json") {
    return JSON.stringify({
      view: "ranking",
      metric,
      limit,
      rows,
    });
  }

  const lines = ["key,label,count,sum"];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.key),
        csvEscape(row.label),
        row.count,
        row.sum,
      ].join(",")
    );
  }
  return lines.join("\n");
}

function exportDashboard(options: ExportOptions): string {
  const rangeDays = normalizeRangeDays(options.rangeDays);
  const filters = {
    platform: options.platform,
    actorRole: options.actorRole,
    sourceKind: options.sourceKind,
  };
  const dashboard = {
    view: "dashboard" as const,
    rangeDays,
    overview: getOverview(rangeDays),
    health: getHealthSnapshot(),
    timeseries: {
      watch_seconds: getTimeseries("watch_seconds", rangeDays, filters),
      downloads_completed_by_day: getTimeseries(
        "downloads_completed_by_day",
        rangeDays,
        filters
      ),
      downloads_failed_by_day: getTimeseries(
        "downloads_failed_by_day",
        rangeDays,
        filters
      ),
      library_added_by_day: getTimeseries(
        "library_added_by_day",
        rangeDays,
        filters
      ),
    },
    rankings: {
      top_watched_videos: getRanking("top_watched_videos", 10),
      most_productive_subscriptions: getRanking(
        "most_productive_subscriptions",
        10
      ),
      most_accessed_rss_feeds: getRanking("most_accessed_rss_feeds", 10),
      most_common_failure_buckets: getRanking(
        "most_common_failure_buckets",
        10
      ),
      largest_never_watched: getRanking("largest_never_watched", 10),
    },
  };

  if (options.format === "json") {
    return JSON.stringify(dashboard);
  }

  const lines: string[] = ["section,key,label,value,count,sum,meta"];

  lines.push(
    [
      "overview",
      "range_days",
      "Range days",
      rangeDays,
      "",
      "",
      "",
    ].join(",")
  );

  for (const [key, value] of Object.entries(dashboard.overview)) {
    if (key === "alerts" && Array.isArray(value)) {
      for (const alert of value) {
        lines.push(
          [
            "overview_alert",
            csvEscape(alert.key),
            csvEscape(alert.title),
            alert.severity,
            "",
            "",
            csvEscape(alert.detail ?? ""),
          ].join(",")
        );
      }
      continue;
    }

    if (typeof value === "object") {
      lines.push(
        [
          "overview",
          csvEscape(key),
          csvEscape(key),
          "",
          "",
          "",
          csvEscape(JSON.stringify(value)),
        ].join(",")
      );
      continue;
    }

    lines.push(
      ["overview", csvEscape(key), csvEscape(key), csvEscape(value), "", "", ""].join(
        ","
      )
    );
  }

  lines.push(
    [
      "health",
      "warning",
      "warning",
      dashboard.health.warning,
      "",
      "",
      csvEscape(JSON.stringify(dashboard.health.trailingHour)),
    ].join(",")
  );
  lines.push(
    [
      "health",
      "dirty_day_count",
      "dirty_day_count",
      dashboard.health.dirtyDayCount,
      "",
      "",
      "",
    ].join(",")
  );
  lines.push(
    [
      "health",
      "sealed_day_count",
      "sealed_day_count",
      dashboard.health.sealedDayCount,
      "",
      "",
      "",
    ].join(",")
  );

  for (const [metricKey, points] of Object.entries(dashboard.timeseries)) {
    for (const point of points) {
      lines.push(
        [
          "timeseries",
          csvEscape(metricKey),
          point.day,
          "",
          point.count,
          point.sum,
          "",
        ].join(",")
      );
    }
  }

  for (const [metricKey, rows] of Object.entries(dashboard.rankings)) {
    for (const row of rows) {
      lines.push(
        [
          "ranking",
          csvEscape(metricKey),
          csvEscape(row.label),
          csvEscape(row.key),
          row.count,
          row.sum,
          csvEscape(JSON.stringify(row.meta ?? {})),
        ].join(",")
      );
    }
  }

  return lines.join("\n");
}

export function exportRawEvents(options: ExportOptions): string {
  const view =
    options.view ??
    (options.fromDay || options.toDay
      ? "events"
      : options.metric
        ? "timeseries"
        : "dashboard");

  switch (view) {
    case "events":
      return exportEvents(options);
    case "timeseries":
      return exportTimeseries(options);
    case "ranking":
      return exportRanking(options);
    case "dashboard":
    default:
      return exportDashboard(options);
  }
}
