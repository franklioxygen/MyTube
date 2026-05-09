// Retention worker for statistics tables.
//
// - prunes raw events older than statisticsRetentionDays
// - before deleting a day's raw events, runs the rollup for that day if dirty
// - then writes sealed = 1 on the rollup_day row so future late events are dropped
// - never prunes the current local statistics day while sessions are still active

import { sqlite } from "../../db";
import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import { dayBucket } from "./normalizers";
import { runRollupCycle } from "./rollups";
import { getResolvedTimezone } from "./collector";

let retentionTimer: ReturnType<typeof setInterval> | null = null;

interface SettingsLike {
  statisticsRetentionDays?: number | null;
}

function getRetentionDays(): number | null {
  try {
    const settings = storageService.getSettings() as SettingsLike;
    if (settings.statisticsRetentionDays === null) return null;
    if (typeof settings.statisticsRetentionDays === "number" && settings.statisticsRetentionDays > 0) {
      return Math.floor(settings.statisticsRetentionDays);
    }
    return 365;
  } catch {
    return 365;
  }
}

function pruneOldIngestionMinutes(): void {
  // Keep the trailing 24 hours, drop older.
  const cutoff = Math.floor(Date.now() / 60_000) - 60 * 24;
  try {
    sqlite
      .prepare(
        "DELETE FROM usage_statistics_ingestion_minutes WHERE minute_bucket < ?"
      )
      .run(cutoff);
  } catch (error) {
    logger.debug(
      "Failed to prune old ingestion minute buckets",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

interface DistinctDayRow {
  day: string;
}

function getDistinctEventDays(): string[] {
  try {
    const rows = sqlite
      .prepare(
        "SELECT DISTINCT day FROM usage_statistics_events ORDER BY day ASC"
      )
      .all() as DistinctDayRow[];
    return rows.map((r) => r.day);
  } catch {
    return [];
  }
}

export async function runRetentionCycle(): Promise<{ sealedDays: number; minuteBucketsPruned: boolean }> {
  pruneOldIngestionMinutes();

  const days = getRetentionDays();
  if (days === null) {
    return { sealedDays: 0, minuteBucketsPruned: true };
  }

  const tz = getResolvedTimezone();
  const today = dayBucket(Date.now(), tz);
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const cutoffDay = dayBucket(cutoffMs, tz);

  const candidateDays = getDistinctEventDays().filter(
    (d) => d < cutoffDay && d < today
  );
  if (candidateDays.length === 0) {
    return { sealedDays: 0, minuteBucketsPruned: true };
  }

  const markDirty = sqlite.prepare(
    `INSERT INTO usage_statistics_rollup_days (day, dirty, sealed)
     VALUES (?, 1, 0)
     ON CONFLICT(day) DO UPDATE SET dirty = CASE WHEN sealed = 1 THEN dirty ELSE 1 END`
  );
  for (const day of candidateDays) {
    try {
      markDirty.run(day);
    } catch (error) {
      logger.debug(
        `Could not mark day ${day} dirty for retention pre-rollup`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Run rollup so each candidate day has correct totals before we drop raw events.
  await runRollupCycle();

  let sealedDays = 0;
  const sealStmt = sqlite.prepare(
    `UPDATE usage_statistics_rollup_days
     SET sealed = 1, dirty = 0
     WHERE day = ?`
  );
  const deleteEvents = sqlite.prepare(
    "DELETE FROM usage_statistics_events WHERE day = ?"
  );

  for (const day of candidateDays) {
    try {
      const txn = sqlite.transaction(() => {
        deleteEvents.run(day);
        sealStmt.run(day);
      });
      txn();
      sealedDays += 1;
    } catch (error) {
      logger.warn(
        `Failed to seal/prune statistics day ${day}`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  return { sealedDays, minuteBucketsPruned: true };
}

export function startRetentionWorker(): void {
  if (retentionTimer !== null) return;
  // Initial run after 1 minute, then hourly.
  setTimeout(() => {
    void runRetentionCycle().catch((error) =>
      logger.warn(
        "Initial retention cycle failed",
        error instanceof Error ? error : new Error(String(error))
      )
    );
  }, 60_000);
  retentionTimer = setInterval(() => {
    void runRetentionCycle().catch((error) =>
      logger.warn(
        "Periodic retention cycle failed",
        error instanceof Error ? error : new Error(String(error))
      )
    );
  }, 60 * 60 * 1000);
}

export function stopRetentionWorker(): void {
  if (retentionTimer !== null) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}

// Used by DELETE /api/statistics: clear everything statistics-owned.
export function clearAllStatisticsData(): void {
  try {
    sqlite
      .prepare("DELETE FROM usage_statistics_events")
      .run();
    sqlite
      .prepare("DELETE FROM usage_statistics_daily")
      .run();
    sqlite
      .prepare("DELETE FROM usage_statistics_rollup_days")
      .run();
    sqlite
      .prepare("DELETE FROM usage_statistics_ingestion_minutes")
      .run();
  } catch (error) {
    logger.error(
      "Failed to clear statistics tables",
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}
