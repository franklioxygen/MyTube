// Idempotent daily rollup worker.
//
// Behavior (design §7.4):
// - every accepted event marks its `day` as dirty
// - the worker runs at startup and every 5 minutes
// - the worker recomputes all dirty (and not sealed) days from raw events,
//   then clears the dirty flag
// - because recomputation is idempotent, a crash mid-rollup is recovered by
//   rerunning dirty days on next startup

import { sqlite } from "../../db";
import { logger } from "../../utils/logger";
import {
  canonicalDimensionsJson,
  dimensionsHash,
  parseDurationSeconds,
} from "./normalizers";

interface DirtyDayRow {
  day: string;
}

interface EventRow {
  id: string;
  eventType: string;
  recordedAt: number;
  sessionId: string | null;
  videoId: string | null;
  subscriptionId: string | null;
  rssTokenId: string | null;
  actorRole: string;
  platform: string | null;
  sourceKind: string | null;
  durationSeconds: number | null;
  value: number | null;
  payload: string;
  relatedEventId: string | null;
}

interface WatchSessionRun {
  start: number;
  end: number;
  seconds: number;
  sessionId: string;
  videoId: string;
  platform: string;
  actorRole: string;
}

const DIRTY_BATCH_LIMIT = 32;

interface DailyAccumulator {
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
}

function emptyAccumulator(): DailyAccumulator {
  return { count: 0, sum: 0, min: null, max: null };
}

function bump(acc: DailyAccumulator, value = 1): void {
  acc.count += 1;
  acc.sum += value;
  acc.min = acc.min === null ? value : Math.min(acc.min, value);
  acc.max = acc.max === null ? value : Math.max(acc.max, value);
}

interface UpsertKey {
  metricKey: string;
  dimensions: Record<string, unknown>;
}

function makeKey(k: UpsertKey): string {
  return `${k.metricKey}|${canonicalDimensionsJson(k.dimensions)}`;
}

class DailyAggregator {
  private readonly map = new Map<string, { key: UpsertKey; acc: DailyAccumulator }>();

  add(key: UpsertKey, value = 1): void {
    const stringKey = makeKey(key);
    let entry = this.map.get(stringKey);
    if (!entry) {
      entry = { key, acc: emptyAccumulator() };
      this.map.set(stringKey, entry);
    }
    bump(entry.acc, value);
  }

  entries(): Array<{ key: UpsertKey; acc: DailyAccumulator }> {
    return Array.from(this.map.values());
  }
}

function getDirtyDays(limit = DIRTY_BATCH_LIMIT): string[] {
  const rows = sqlite
    .prepare(
      `SELECT day FROM usage_statistics_rollup_days
       WHERE dirty = 1 AND sealed = 0
       ORDER BY day ASC
       LIMIT ?`
    )
    .all(limit) as DirtyDayRow[];
  return rows.map((r) => r.day);
}

function getEventsForDay(day: string): EventRow[] {
  return sqlite
    .prepare(
      `SELECT id, event_type AS eventType, recorded_at AS recordedAt,
              session_id AS sessionId, video_id AS videoId,
              subscription_id AS subscriptionId, rss_token_id AS rssTokenId,
              actor_role AS actorRole, platform, source_kind AS sourceKind,
              duration_seconds AS durationSeconds, value, payload,
              related_event_id AS relatedEventId
       FROM usage_statistics_events
       WHERE day = ?
       ORDER BY recorded_at ASC`
    )
    .all(day) as EventRow[];
}

function safeParseJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function getVideoDurations(videoIds: string[]): Map<string, number | null> {
  const durationByVideoId = new Map<string, number | null>();
  if (videoIds.length === 0) {
    return durationByVideoId;
  }

  const placeholders = videoIds.map(() => "?").join(", ");
  const rows = sqlite
    .prepare(
      `SELECT id, duration
       FROM videos
       WHERE id IN (${placeholders})`
    )
    .all(...videoIds) as Array<{ id: string; duration: string | null }>;

  for (const row of rows) {
    durationByVideoId.set(row.id, parseDurationSeconds(row.duration));
  }

  for (const videoId of videoIds) {
    if (!durationByVideoId.has(videoId)) {
      durationByVideoId.set(videoId, null);
    }
  }

  return durationByVideoId;
}

function getCompletionBucket(completionRatio: number): string {
  if (completionRatio < 0.1) return "0-10";
  if (completionRatio < 0.5) return "10-50";
  if (completionRatio < 0.9) return "50-90";
  return "90-100";
}

function recomputeDay(day: string): void {
  const events = getEventsForDay(day);

  const aggregator = new DailyAggregator();

  // Track watch-chunk runs per (sessionId, videoId) to merge contiguous segments
  // for completion math. "Adjacent" = next chunk's start within 90s of prev end.
  const sessionRuns = new Map<string, WatchSessionRun[]>();

  for (const e of events) {
    const platform = e.platform ?? "unknown";
    const role = e.actorRole;
    const sourceKind = e.sourceKind ?? "unknown";
    const payload = safeParseJson(e.payload);

    switch (e.eventType) {
      case "search_submitted": {
        aggregator.add({
          metricKey: "search_submitted",
          dimensions: { actor_role: role },
        });
        const local = Number(payload.localResultCount ?? 0);
        const ext = Number(payload.externalResultCount ?? 0);
        if (local + ext === 0) {
          aggregator.add({
            metricKey: "search_zero_result",
            dimensions: { actor_role: role },
          });
        }
        break;
      }
      case "video_play_started": {
        aggregator.add({
          metricKey: "video_play_started",
          dimensions: { platform, actor_role: role },
        });
        break;
      }
      case "video_watch_chunk_recorded": {
        const seconds = Math.max(0, Math.round(Number(e.durationSeconds ?? 0)));
        if (seconds > 0) {
          aggregator.add(
            {
              metricKey: "watch_seconds",
              dimensions: { platform, actor_role: role },
            },
            seconds
          );

          if (e.sessionId && e.videoId) {
            const key = `${e.sessionId}|${e.videoId}`;
            const list = sessionRuns.get(key) ?? [];
            const start = e.recordedAt - seconds * 1000;
            const end = e.recordedAt;
            const last = list[list.length - 1];
            if (last && start - last.end <= 90_000) {
              last.end = end;
              last.seconds += seconds;
            } else {
              list.push({
                start,
                end,
                seconds,
                sessionId: e.sessionId,
                videoId: e.videoId,
                platform,
                actorRole: role,
              });
            }
            sessionRuns.set(key, list);
          }
        }
        break;
      }
      case "download_enqueued": {
        aggregator.add({
          metricKey: "download_enqueued",
          dimensions: { platform, source_kind: sourceKind, actor_role: role },
        });
        break;
      }
      case "download_started": {
        aggregator.add({
          metricKey: "download_started",
          dimensions: { platform, source_kind: sourceKind, actor_role: role },
        });
        // Queue wait calculation requires looking up the linked download_enqueued
        // event; the read-time queries layer joins instead, so don't double-count here.
        break;
      }
      case "library_video_added": {
        const reason = (payload.reason as string) || "manual";
        aggregator.add({
          metricKey: "library_video_added",
          dimensions: { platform, reason },
        });
        const bytes = Number(payload.fileSizeBytes ?? 0);
        if (bytes > 0) {
          aggregator.add(
            { metricKey: "library_bytes_added", dimensions: { platform } },
            bytes
          );
        }
        break;
      }
      case "library_video_deleted": {
        const reason = (payload.reason as string) || "manual";
        aggregator.add({
          metricKey: "library_video_deleted",
          dimensions: { platform, reason },
        });
        const bytes = Number(payload.fileSizeBytes ?? 0);
        if (bytes > 0) {
          aggregator.add(
            { metricKey: "library_bytes_deleted", dimensions: { platform } },
            bytes
          );
        }
        break;
      }
      case "subscription_check_completed": {
        const status = (payload.status as string) || "success";
        aggregator.add({
          metricKey: "subscription_check_completed",
          dimensions: { status },
        });
        const newVideos = Number(payload.newVideoCount ?? 0);
        if (newVideos > 0) {
          aggregator.add(
            { metricKey: "subscription_new_videos", dimensions: { status } },
            newVideos
          );
        }
        break;
      }
      case "retention_delete_completed": {
        const count = Number(payload.deletedCount ?? 1);
        aggregator.add(
          { metricKey: "retention_delete_completed", dimensions: { reason: "retention" } },
          count
        );
        break;
      }
      case "rss_feed_accessed": {
        aggregator.add({
          metricKey: "rss_feed_accessed",
          dimensions: { rss_token_id: e.rssTokenId ?? "unknown" },
        });
        break;
      }
      default:
        break;
    }
  }

  const durationByVideoId = getVideoDurations(
    Array.from(
      new Set(
        Array.from(sessionRuns.values()).flatMap((runs) =>
          runs.map((run) => run.videoId)
        )
      )
    )
  );
  const rewatchQualifiedByVideo = new Map<
    string,
    { count: number; platform: string; actorRole: string }
  >();

  // Persist completion-aware play sessions per day.
  for (const runs of sessionRuns.values()) {
    for (const run of runs) {
      aggregator.add({
        metricKey: "play_sessions",
        dimensions: { platform: run.platform, actor_role: run.actorRole },
      });
      aggregator.add(
        {
          metricKey: "play_session",
          dimensions: {
            platform: run.platform,
            actor_role: run.actorRole,
            video_id: run.videoId,
          },
        },
        run.seconds
      );

      const durationSeconds = durationByVideoId.get(run.videoId) ?? null;
      if (durationSeconds === null || durationSeconds <= 0) {
        continue;
      }

      const completionRatio = Math.min(run.seconds / durationSeconds, 1);
      aggregator.add({
        metricKey: "completion_bucket",
        dimensions: {
          platform: run.platform,
          actor_role: run.actorRole,
          bucket: getCompletionBucket(completionRatio),
        },
      });

      if (completionRatio >= 0.9) {
        aggregator.add({
          metricKey: "completed_play_sessions",
          dimensions: { platform: run.platform, actor_role: run.actorRole },
        });
      }

      if (completionRatio >= 0.5) {
        const current = rewatchQualifiedByVideo.get(run.videoId);
        rewatchQualifiedByVideo.set(run.videoId, {
          count: (current?.count ?? 0) + 1,
          platform: run.platform,
          actorRole: run.actorRole,
        });
      }
    }
  }

  for (const [videoId, info] of rewatchQualifiedByVideo.entries()) {
    if (info.count < 2) {
      continue;
    }

    aggregator.add({
      metricKey: "rewatched_videos",
      dimensions: {
        platform: info.platform,
        actor_role: info.actorRole,
        video_id: videoId,
      },
    });
  }

  const updatedAt = Date.now();
  const upsertStmt = sqlite.prepare(
    `INSERT INTO usage_statistics_daily
       (day, metric_key, schema_version, platform, actor_role, source_kind,
        dimension_key, dimension_value, dimensions_hash, dimensions_json,
        count, sum, min, max, updated_at)
     VALUES (?, ?, 1, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, metric_key, dimensions_hash) DO UPDATE SET
       count = excluded.count,
       sum = excluded.sum,
       min = excluded.min,
       max = excluded.max,
       platform = excluded.platform,
       actor_role = excluded.actor_role,
       source_kind = excluded.source_kind,
       dimensions_json = excluded.dimensions_json,
       updated_at = excluded.updated_at`
  );

  // Clear existing rows for this day so removed dimensions don't linger.
  sqlite
    .prepare("DELETE FROM usage_statistics_daily WHERE day = ?")
    .run(day);

  const txn = sqlite.transaction((entries: Array<{ key: UpsertKey; acc: DailyAccumulator }>) => {
    for (const { key, acc } of entries) {
      const json = canonicalDimensionsJson(key.dimensions);
      const hash = dimensionsHash(json);
      const platform = (key.dimensions.platform as string | undefined) ?? null;
      const actorRole = (key.dimensions.actor_role as string | undefined) ?? null;
      const sourceKind = (key.dimensions.source_kind as string | undefined) ?? null;
      upsertStmt.run(
        day,
        key.metricKey,
        platform,
        actorRole,
        sourceKind,
        hash,
        json,
        acc.count,
        acc.sum,
        acc.min,
        acc.max,
        updatedAt
      );
    }
    sqlite
      .prepare(
        `UPDATE usage_statistics_rollup_days
         SET dirty = 0, last_rolled_up_at = ?
         WHERE day = ? AND sealed = 0`
      )
      .run(updatedAt, day);
  });

  txn(aggregator.entries());
}

let workerRunning = false;
let workerHandle: ReturnType<typeof setInterval> | null = null;
let lastRunAt = 0;

export function getRollupHealth(): { running: boolean; lastRunAt: number } {
  return { running: workerRunning, lastRunAt };
}

export async function runRollupCycle(): Promise<{ daysProcessed: number }> {
  if (workerRunning) return { daysProcessed: 0 };
  workerRunning = true;
  let daysProcessed = 0;
  try {
    const days = getDirtyDays();
    for (const day of days) {
      try {
        recomputeDay(day);
        daysProcessed += 1;
      } catch (error) {
        logger.warn(
          `Failed to recompute statistics rollup day ${day}`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
    lastRunAt = Date.now();
  } finally {
    workerRunning = false;
  }
  return { daysProcessed };
}

export function startRollupWorker(): void {
  if (workerHandle !== null) return;
  // Run immediately, then every 5 minutes.
  void runRollupCycle().catch((error) =>
    logger.warn(
      "Initial rollup cycle failed",
      error instanceof Error ? error : new Error(String(error))
    )
  );
  workerHandle = setInterval(() => {
    void runRollupCycle().catch((error) =>
      logger.warn(
        "Periodic rollup cycle failed",
        error instanceof Error ? error : new Error(String(error))
      )
    );
  }, 5 * 60 * 1000);
}

export function stopRollupWorker(): void {
  if (workerHandle !== null) {
    clearInterval(workerHandle);
    workerHandle = null;
  }
}

export async function recomputeAllUnsealedDays(): Promise<number> {
  // Mark every unsealed day dirty, then run the worker.
  sqlite
    .prepare(
      `UPDATE usage_statistics_rollup_days SET dirty = 1 WHERE sealed = 0`
    )
    .run();
  const { daysProcessed } = await runRollupCycle();
  return daysProcessed;
}
