// Statistics health snapshot for the dashboard health card and GET /api/statistics/health.

import { sqlite } from "../../db";
import { getRollupHealth } from "./rollups";

export interface StatisticsHealthSnapshot {
  rollup: { running: boolean; lastRunAt: number | null };
  dirtyDayCount: number;
  sealedDayCount: number;
  trailingHour: {
    accepted: number;
    dropped: number;
    error: number;
    sealedDayDrop: number;
  };
  warning: boolean;
}

export function getHealthSnapshot(): StatisticsHealthSnapshot {
  const rollup = getRollupHealth();
  const dirty = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM usage_statistics_rollup_days WHERE dirty = 1 AND sealed = 0"
    )
    .get() as { c: number } | undefined;
  const sealed = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM usage_statistics_rollup_days WHERE sealed = 1"
    )
    .get() as { c: number } | undefined;

  const minuteCutoff = Math.floor(Date.now() / 60_000) - 60;
  const totals = sqlite
    .prepare(
      `SELECT
         COALESCE(SUM(accepted_count),0)        AS acc,
         COALESCE(SUM(dropped_count),0)         AS dropped,
         COALESCE(SUM(error_count),0)           AS errors,
         COALESCE(SUM(sealed_day_drop_count),0) AS sealedDayDrop
       FROM usage_statistics_ingestion_minutes
       WHERE minute_bucket >= ?`
    )
    .get(minuteCutoff) as
    | { acc: number; dropped: number; errors: number; sealedDayDrop: number }
    | undefined;

  const lastRunAt = rollup.lastRunAt > 0 ? rollup.lastRunAt : null;
  const trailingHour = {
    accepted: totals?.acc ?? 0,
    dropped: totals?.dropped ?? 0,
    error: totals?.errors ?? 0,
    sealedDayDrop: totals?.sealedDayDrop ?? 0,
  };
  const stale =
    lastRunAt === null
      ? false // worker has not yet run on this fresh install
      : Date.now() - lastRunAt > 30 * 60 * 1000;
  const warning =
    stale ||
    trailingHour.dropped > 0 ||
    trailingHour.error > 0 ||
    trailingHour.sealedDayDrop > 0;

  return {
    rollup: { running: rollup.running, lastRunAt },
    dirtyDayCount: dirty?.c ?? 0,
    sealedDayCount: sealed?.c ?? 0,
    trailingHour,
    warning,
  };
}
