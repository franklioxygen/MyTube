// Read-side queries for the statistics dashboard.
//
// Live SQL on existing tables answers download/library/subscription/RSS questions
// per the design's metric-sourcing strategy (§6.0). Daily rollups answer event-sourced
// long-range trends. Snapshot cards are computed live from current tables.

import fs from "fs";
import { VIDEOS_DIR } from "../../config/paths";
import { sqlite } from "../../db";
import {
  normalizeSafeAbsolutePath,
  statTrustedSync,
} from "../../utils/security";
import * as storageService from "../storageService";
import { getResolvedTimezone } from "./collector";
import { bucketDownloadError, dayBucket } from "./normalizers";

export interface OverviewSnapshot {
  totalVideos: number;
  totalStorageBytes: number;
  activeSubscriptions: number;
  pausedSubscriptions: number;
  activeRssTokens: number;
  collectionCoverage: number;
  subtitleCoverage: number;
  thumbnailCoverage: number;
  downloadSuccessRate: number | null;
  downloadVolumeBytes: number;
  netNewVideos: number;
  watchSecondsLastRange: number;
  alerts: AlertCard[];
}

export interface AlertCard {
  key: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail?: string;
}

export interface RangeFilter {
  fromMs: number;
  toMs: number;
}

function rangeOf(days: number): RangeFilter {
  const toMs = Date.now();
  const fromMs = toMs - days * 24 * 60 * 60 * 1000;
  return { fromMs, toMs };
}

interface StatisticsStorageSettings {
  cloudDriveEnabled?: boolean;
  mountDirectories?: string;
}

function hasAnyNonCloudVideos(): boolean {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS c
       FROM videos
       WHERE video_path IS NULL OR video_path NOT LIKE 'cloud:%'`
    )
    .get() as { c: number } | undefined;
  return (row?.c ?? 0) > 0;
}

function getWritableLocalMediaRoots(): string[] {
  const roots = new Set<string>();
  const settings = storageService.getSettings() as StatisticsStorageSettings;
  const mountRoots: string[] = [];

  if (typeof settings.mountDirectories === "string") {
    for (const line of settings.mountDirectories.split(/[\r\n]+/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const safeRoot = normalizeSafeAbsolutePath(trimmed);
        if (statTrustedSync(safeRoot).isDirectory()) {
          mountRoots.push(safeRoot);
        }
      } catch {
        // Ignore unreadable roots.
      }
    }
  }

  if (
    settings.cloudDriveEnabled === true &&
    mountRoots.length === 0 &&
    !hasAnyNonCloudVideos()
  ) {
    return [];
  }

  try {
    const safeVideosRoot = normalizeSafeAbsolutePath(VIDEOS_DIR);
    if (statTrustedSync(safeVideosRoot).isDirectory()) {
      roots.add(safeVideosRoot);
    }
  } catch {
    // Ignore unreadable root.
  }

  for (const root of mountRoots) {
    roots.add(root);
  }

  return Array.from(roots);
}

function getFreeBytes(rootPath: string): number | null {
  try {
    const statfsSync = (
      fs as unknown as {
        statfsSync?: (path: string) => {
          bavail?: number;
          bsize?: number;
        };
      }
    ).statfsSync;
    if (typeof statfsSync !== "function") {
      return null;
    }

    const stats = statfsSync(rootPath);
    if (
      typeof stats.bavail !== "number" ||
      typeof stats.bsize !== "number"
    ) {
      return null;
    }

    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

export function getOverview(rangeDays = 30): OverviewSnapshot {
  const range = rangeOf(rangeDays);

  const totalVideos = (sqlite
    .prepare("SELECT COUNT(*) AS c FROM videos")
    .get() as { c: number } | undefined)?.c ?? 0;

  const storageRow = sqlite
    .prepare(
      "SELECT COALESCE(SUM(CAST(file_size AS INTEGER)), 0) AS bytes FROM videos WHERE file_size IS NOT NULL"
    )
    .get() as { bytes: number } | undefined;
  const totalStorageBytes = storageRow?.bytes ?? 0;

  const subActive = (sqlite
    .prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE COALESCE(paused, 0) = 0")
    .get() as { c: number } | undefined)?.c ?? 0;
  const subPaused = (sqlite
    .prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE COALESCE(paused, 0) = 1")
    .get() as { c: number } | undefined)?.c ?? 0;

  const rssActive = (sqlite
    .prepare("SELECT COUNT(*) AS c FROM rss_tokens WHERE is_active = 1")
    .get() as { c: number } | undefined)?.c ?? 0;

  const collectionCoverage = (sqlite
    .prepare(
      "SELECT COUNT(DISTINCT video_id) AS c FROM collection_videos"
    )
    .get() as { c: number } | undefined)?.c ?? 0;

  const subtitleRow = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM videos WHERE subtitles IS NOT NULL AND subtitles != '' AND subtitles != '[]'"
    )
    .get() as { c: number } | undefined;
  const subtitleCoverage = subtitleRow?.c ?? 0;

  const thumbnailRow = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM videos WHERE (thumbnail_filename IS NOT NULL AND thumbnail_filename != '') OR (thumbnail_path IS NOT NULL AND thumbnail_path != '')"
    )
    .get() as { c: number } | undefined;
  const thumbnailCoverage = thumbnailRow?.c ?? 0;

  // Download success rate: completed = success+deleted; failed = failed; skipped excluded.
  const dh = sqlite
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('success','deleted') THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status IN ('success','deleted') THEN COALESCE(CAST(total_size AS INTEGER), 0) ELSE 0 END) AS bytes
       FROM download_history
       WHERE finished_at >= ? AND finished_at <= ?`
    )
    .get(range.fromMs, range.toMs) as
    | { completed: number; failed: number; bytes: number }
    | undefined;
  const completed = dh?.completed ?? 0;
  const failed = dh?.failed ?? 0;
  const downloadSuccessRate =
    completed + failed > 0 ? completed / (completed + failed) : null;
  const downloadVolumeBytes = dh?.bytes ?? 0;

  const fromDay = statisticsDay(range.fromMs);
  const toDay = statisticsDay(range.toMs);
  const netNewRollup = sqlite
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN metric_key = 'library_video_added' THEN count ELSE 0 END), 0) AS added,
         COALESCE(SUM(CASE WHEN metric_key = 'library_video_deleted' THEN count ELSE 0 END), 0) AS deleted,
         COUNT(*) AS rowCount
       FROM usage_statistics_daily
       WHERE day >= ? AND day <= ?
         AND metric_key IN ('library_video_added', 'library_video_deleted')`
    )
    .get(fromDay, toDay) as
    | { added: number; deleted: number; rowCount: number }
    | undefined;
  const netNewFallback = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM videos WHERE created_at >= ?"
    )
    .get(new Date(range.fromMs).toISOString()) as { c: number } | undefined;
  const netNewVideos =
    (netNewRollup?.rowCount ?? 0) > 0
      ? (netNewRollup?.added ?? 0) - (netNewRollup?.deleted ?? 0)
      : (netNewFallback?.c ?? 0);

  const watchRow = sqlite
    .prepare(
      `SELECT COALESCE(SUM(sum), 0) AS s FROM usage_statistics_daily
       WHERE metric_key = 'watch_seconds' AND day >= ? AND day <= ?`
    )
    .get(fromDay, toDay) as { s: number } | undefined;
  const watchSecondsLastRange = watchRow?.s ?? 0;

  const alerts = computeAlerts(rangeDays);

  return {
    totalVideos,
    totalStorageBytes,
    activeSubscriptions: subActive,
    pausedSubscriptions: subPaused,
    activeRssTokens: rssActive,
    collectionCoverage,
    subtitleCoverage,
    thumbnailCoverage,
    downloadSuccessRate,
    downloadVolumeBytes,
    netNewVideos,
    watchSecondsLastRange,
    alerts,
  };
}

function statisticsDay(ms: number): string {
  return dayBucket(ms, getResolvedTimezone());
}

function bucketRowsByDay<T>(
  rows: T[],
  getTimestampMs: (row: T) => number | null,
  getSumDelta: (row: T) => number
): TimeseriesPoint[] {
  const buckets = new Map<string, TimeseriesPoint>();

  for (const row of rows) {
    const timestampMs = getTimestampMs(row);
    if (timestampMs === null) continue;
    const day = statisticsDay(timestampMs);
    const existing = buckets.get(day);
    if (existing) {
      existing.count += 1;
      existing.sum += getSumDelta(row);
      continue;
    }
    buckets.set(day, {
      day,
      count: 1,
      sum: getSumDelta(row),
    });
  }

  return Array.from(buckets.values()).sort((a, b) => a.day.localeCompare(b.day));
}

export interface TimeseriesPoint {
  day: string;
  count: number;
  sum: number;
}

export function getTimeseries(
  metric: string,
  rangeDays = 30,
  filters: { platform?: string; actorRole?: string; sourceKind?: string } = {}
): TimeseriesPoint[] {
  const range = rangeOf(rangeDays);
  const fromDay = statisticsDay(range.fromMs);
  const toDay = statisticsDay(range.toMs);

  // Live SQL metrics that don't depend on rollups
  if (metric === "downloads_completed_by_day") {
    const rows = sqlite
      .prepare(
        `SELECT
           finished_at AS finishedAt,
           COALESCE(CAST(total_size AS INTEGER), 0) AS totalSize
         FROM download_history
         WHERE finished_at >= ? AND finished_at <= ?
           AND status IN ('success','deleted')
         ORDER BY finished_at ASC`
      )
      .all(range.fromMs, range.toMs) as Array<{
      finishedAt: number;
      totalSize: number;
    }>;
    return bucketRowsByDay(
      rows,
      (row) => row.finishedAt,
      (row) => row.totalSize
    );
  }

  if (metric === "downloads_failed_by_day") {
    const rows = sqlite
      .prepare(
        `SELECT
           finished_at AS finishedAt
         FROM download_history
         WHERE finished_at >= ? AND finished_at <= ?
           AND status = 'failed'
         ORDER BY finished_at ASC`
      )
      .all(range.fromMs, range.toMs) as Array<{ finishedAt: number }>;
    return bucketRowsByDay(
      rows,
      (row) => row.finishedAt,
      () => 0
    );
  }

  if (metric === "library_added_by_day") {
    const rows = sqlite
      .prepare(
        `SELECT
           created_at AS createdAt
         FROM videos
         WHERE created_at >= ?
         ORDER BY created_at ASC`
      )
      .all(new Date(range.fromMs).toISOString()) as Array<{ createdAt: string }>;
    return bucketRowsByDay(
      rows,
      (row) => {
        const timestampMs = Date.parse(row.createdAt);
        return Number.isFinite(timestampMs) ? timestampMs : null;
      },
      () => 0
    );
  }

  // Otherwise: rollup-sourced metric.
  const dimensionFilter: string[] = [];
  const args: any[] = [metric, fromDay, toDay];
  if (filters.platform) {
    dimensionFilter.push("platform = ?");
    args.push(filters.platform);
  }
  if (filters.actorRole) {
    dimensionFilter.push("actor_role = ?");
    args.push(filters.actorRole);
  }
  if (filters.sourceKind) {
    dimensionFilter.push("source_kind = ?");
    args.push(filters.sourceKind);
  }
  const where =
    dimensionFilter.length > 0
      ? ` AND ${dimensionFilter.join(" AND ")}`
      : "";
  return sqlite
    .prepare(
      `SELECT day, SUM(count) AS count, SUM(sum) AS sum
       FROM usage_statistics_daily
       WHERE metric_key = ? AND day >= ? AND day <= ?${where}
       GROUP BY day
       ORDER BY day ASC`
    )
    .all(...args) as TimeseriesPoint[];
}

export interface RankingRow {
  key: string;
  label: string;
  count: number;
  sum: number;
  meta?: Record<string, unknown>;
}

export function getRanking(
  metric: string,
  limit = 20
): RankingRow[] {
  if (metric === "top_watched_videos") {
    // Rank by completion-aware play sessions from the daily rollup so repeated
    // sessions for the same tab/video are counted correctly.
    return sqlite
      .prepare(
        `SELECT
           json_extract(d.dimensions_json, '$.video_id') AS key,
           COALESCE(v.title, 'Unknown') AS label,
           SUM(d.count) AS count,
           SUM(d.sum) AS sum
         FROM usage_statistics_daily d
         LEFT JOIN videos v
           ON v.id = json_extract(d.dimensions_json, '$.video_id')
         WHERE d.metric_key = 'play_session'
           AND json_extract(d.dimensions_json, '$.video_id') IS NOT NULL
         GROUP BY json_extract(d.dimensions_json, '$.video_id')
         ORDER BY sum DESC
         LIMIT ?`
      )
      .all(limit) as RankingRow[];
  }

  if (metric === "most_productive_subscriptions") {
    return sqlite
      .prepare(
        `SELECT
           s.id AS key,
           s.author AS label,
           SUM(CASE WHEN dh.status IN ('success','deleted') THEN 1 ELSE 0 END) AS count,
           0 AS sum
         FROM subscriptions s
         LEFT JOIN download_history dh ON dh.subscription_id = s.id
         GROUP BY s.id
         ORDER BY count DESC
         LIMIT ?`
      )
      .all(limit) as RankingRow[];
  }

  if (metric === "most_accessed_rss_feeds") {
    return sqlite
      .prepare(
        `SELECT
           id AS key,
           label AS label,
           access_count AS count,
           0 AS sum
         FROM rss_tokens
         ORDER BY access_count DESC
         LIMIT ?`
      )
      .all(limit) as RankingRow[];
  }

  if (metric === "most_common_failure_buckets") {
    const rows = sqlite
      .prepare(
        `SELECT id, error FROM download_history WHERE status = 'failed'`
      )
      .all() as Array<{ id: string; error: string | null }>;
    const buckets = new Map<string, number>();
    for (const r of rows) {
      const bucket = bucketDownloadError(r.error);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .map(([bucket, count]) => ({
        key: bucket,
        label: bucket,
        count,
        sum: 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  if (metric === "largest_never_watched") {
    return sqlite
      .prepare(
        `SELECT id AS key, title AS label, COALESCE(view_count, 0) AS count,
                COALESCE(CAST(file_size AS INTEGER), 0) AS sum
         FROM videos
         WHERE COALESCE(view_count, 0) = 0 AND file_size IS NOT NULL
         ORDER BY sum DESC
         LIMIT ?`
      )
      .all(limit) as RankingRow[];
  }

  return [];
}

function computeAlerts(rangeDays: number): AlertCard[] {
  const alerts: AlertCard[] = [];

  // Subscription consecutive-failure-streak alert
  try {
    const failingSubs = sqlite
      .prepare(
        `SELECT id, author, consecutive_failure_count
         FROM subscriptions
         WHERE COALESCE(consecutive_failure_count, 0) >= 5
         ORDER BY consecutive_failure_count DESC
         LIMIT 5`
      )
      .all() as Array<{
        id: string;
        author: string;
        consecutive_failure_count: number;
      }>;
    for (const s of failingSubs) {
      alerts.push({
        key: `subscription_failure_streak:${s.id}`,
        severity: "warning",
        title: `Subscription "${s.author}" has failed ${s.consecutive_failure_count} checks in a row`,
      });
    }
  } catch {
    // ignore
  }

  // Per-platform success rate regression: compare last N days vs prior N days
  try {
    const halfRangeMs = (rangeDays * 24 * 60 * 60 * 1000) / 2;
    const now = Date.now();
    const recent = sqlite
      .prepare(
        `SELECT platform,
                SUM(CASE WHEN status IN ('success','deleted') THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM download_history
         WHERE finished_at >= ? AND finished_at <= ?
         GROUP BY platform`
      )
      .all(now - halfRangeMs, now) as Array<{
        platform: string | null;
        completed: number;
        failed: number;
      }>;
    const prior = sqlite
      .prepare(
        `SELECT platform,
                SUM(CASE WHEN status IN ('success','deleted') THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM download_history
         WHERE finished_at >= ? AND finished_at < ?
         GROUP BY platform`
      )
      .all(now - 2 * halfRangeMs, now - halfRangeMs) as Array<{
        platform: string | null;
        completed: number;
        failed: number;
      }>;
    const priorByPlatform = new Map(prior.map((p) => [p.platform ?? "unknown", p]));
    for (const r of recent) {
      const platform = r.platform ?? "unknown";
      const recentTotal = r.completed + r.failed;
      if (recentTotal < 5) continue;
      const recentRate = r.completed / recentTotal;
      const p = priorByPlatform.get(platform);
      if (!p) continue;
      const priorTotal = p.completed + p.failed;
      if (priorTotal < 5) continue;
      const priorRate = p.completed / priorTotal;
      const drop = priorRate - recentRate;
      if (drop >= 0.18) {
        alerts.push({
          key: `platform_success_drop:${platform}`,
          severity: "warning",
          title: `${platform} success rate is down ${Math.round(drop * 100)} points versus the previous ${Math.round(rangeDays / 2)} days`,
        });
      }
    }
  } catch {
    // ignore
  }

  return alerts;
}

// Disk runway estimate: returns null when not derivable (cloud-only or insufficient activity).
export interface DiskRunway {
  status: "ok" | "unavailable_storage" | "insufficient_activity";
  daysRemaining?: number;
  freeBytes?: number;
  netDailyBytes?: number;
  rootPath?: string;
  volumes?: Array<{
    rootPath: string;
    freeBytes: number;
    daysRemaining: number;
  }>;
}

export function estimateDiskRunway(rangeDays = 14): DiskRunway {
  const fromDay = statisticsDay(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  const toDay = statisticsDay(Date.now());
  const dailyRows = sqlite
    .prepare(
      `SELECT
         day,
         COALESCE(SUM(CASE WHEN metric_key = 'library_bytes_added' THEN sum ELSE 0 END), 0) AS added,
         COALESCE(SUM(CASE WHEN metric_key = 'library_bytes_deleted' THEN sum ELSE 0 END), 0) AS deleted,
         COALESCE(SUM(CASE WHEN metric_key = 'retention_delete_completed' THEN count ELSE 0 END), 0) AS retentionDeletes
       FROM usage_statistics_daily
       WHERE day >= ? AND day <= ?
         AND metric_key IN (
           'library_bytes_added',
           'library_bytes_deleted',
           'retention_delete_completed'
         )
       GROUP BY day
       ORDER BY day ASC`
    )
    .all(fromDay, toDay) as Array<{
    day: string;
    added: number;
    deleted: number;
    retentionDeletes: number;
  }>;

  const qualifyingRows = dailyRows.filter((row) => row.retentionDeletes === 0);

  if (qualifyingRows.length < 7) {
    return { status: "insufficient_activity" };
  }

  const totalNetBytes = qualifyingRows.reduce(
    (sum, row) => sum + (row.added - row.deleted),
    0
  );
  const netDailyBytes =
    totalNetBytes / Math.max(qualifyingRows.length, 1);
  if (netDailyBytes <= 0) {
    return { status: "insufficient_activity", netDailyBytes };
  }

  const volumes = getWritableLocalMediaRoots()
    .map((rootPath) => {
      const freeBytes = getFreeBytes(rootPath);
      if (freeBytes === null) {
        return null;
      }

      return {
        rootPath,
        freeBytes,
        daysRemaining: freeBytes / netDailyBytes,
      };
    })
    .filter(
      (
        volume
      ): volume is {
        rootPath: string;
        freeBytes: number;
        daysRemaining: number;
      } => volume !== null
    );

  if (volumes.length === 0) {
    return { status: "unavailable_storage", netDailyBytes };
  }

  const tightestVolume = volumes.reduce((current, candidate) =>
    candidate.daysRemaining < current.daysRemaining ? candidate : current
  );

  return {
    status: "ok",
    daysRemaining: tightestVolume.daysRemaining,
    freeBytes: tightestVolume.freeBytes,
    netDailyBytes,
    rootPath: tightestVolume.rootPath,
    volumes,
  };
}
