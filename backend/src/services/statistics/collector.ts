// Best-effort statistics event collector.
// All write paths must be fire-and-forget: never let a statistics insert
// fail a download, playback session, search action, RSS response, or settings save.

import crypto from "crypto";
import { sqlite } from "../../db";
import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import { Settings } from "../../types/settings";
import {
  StatisticsEventInput,
  StatisticsEventType,
} from "./eventTypes";
import {
  dayBucket,
  normalizePlatform,
  normalizeSourceKind,
  normalizeSurface,
} from "./normalizers";

const SETTING_TZ_KEY = "statisticsTimezone";

let cachedSettings: Settings | null = null;
let cachedSettingsLoadedAt = 0;
const SETTINGS_REFRESH_MS = 5_000;

function loadSettings(): Settings {
  const now = Date.now();
  if (cachedSettings && now - cachedSettingsLoadedAt < SETTINGS_REFRESH_MS) {
    return cachedSettings;
  }
  const raw = storageService.getSettings();
  cachedSettings = raw as Settings;
  cachedSettingsLoadedAt = now;
  return cachedSettings;
}

export function invalidateStatisticsSettingsCache(): void {
  cachedSettings = null;
  cachedSettingsLoadedAt = 0;
}

export function isStatisticsEnabled(): boolean {
  try {
    return loadSettings().statisticsEnabled === true;
  } catch {
    return false;
  }
}

export function shouldTrackVisitorActivity(): boolean {
  try {
    return loadSettings().statisticsTrackVisitorActivity === true;
  } catch {
    return false;
  }
}

export function getResolvedTimezone(): string {
  try {
    const settings = loadSettings();
    if (typeof settings.statisticsTimezone === "string" && settings.statisticsTimezone.length > 0) {
      return settings.statisticsTimezone;
    }
  } catch {
    // fall through
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function ensureFrozenTimezoneOnEnable(): string {
  // Called from saveSettings flow when the toggle moves from disabled -> enabled.
  // If statisticsTimezone is not yet stored, freeze the current resolved timezone.
  const settings = storageService.getSettings();
  if (typeof settings.statisticsTimezone === "string" && settings.statisticsTimezone.length > 0) {
    return settings.statisticsTimezone;
  }
  let timezone = "UTC";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    timezone = "UTC";
  }
  storageService.saveSettings(
    { [SETTING_TZ_KEY]: timezone },
    { extraWhitelistedKeys: [SETTING_TZ_KEY] }
  );
  invalidateStatisticsSettingsCache();
  return timezone;
}

interface SealedDayCheckResult {
  sealed: number;
}

function isDaySealed(day: string): boolean {
  try {
    const row = sqlite
      .prepare(
        "SELECT sealed AS sealed FROM usage_statistics_rollup_days WHERE day = ?"
      )
      .get(day) as SealedDayCheckResult | undefined;
    return row?.sealed === 1;
  } catch {
    return false;
  }
}

function markDayDirty(day: string, recordedAt: number): void {
  try {
    sqlite
      .prepare(
        `INSERT INTO usage_statistics_rollup_days (day, dirty, sealed, last_event_recorded_at)
         VALUES (?, 1, 0, ?)
         ON CONFLICT(day) DO UPDATE SET
           dirty = CASE WHEN sealed = 1 THEN dirty ELSE 1 END,
           last_event_recorded_at = MAX(COALESCE(last_event_recorded_at, 0), excluded.last_event_recorded_at)`
      )
      .run(day, recordedAt);
  } catch (error) {
    logger.debug(
      "markDayDirty failed",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

function bumpIngestionMinute(field: "accepted" | "dropped" | "error" | "sealed"): void {
  try {
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const now = Date.now();
    const updateColumn = (() => {
      switch (field) {
        case "accepted":
          return "accepted_count = accepted_count + 1";
        case "dropped":
          return "dropped_count = dropped_count + 1";
        case "error":
          return "error_count = error_count + 1";
        case "sealed":
          return "sealed_day_drop_count = sealed_day_drop_count + 1";
      }
    })();
    sqlite
      .prepare(
        `INSERT INTO usage_statistics_ingestion_minutes
           (minute_bucket, accepted_count, dropped_count, error_count, sealed_day_drop_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(minute_bucket) DO UPDATE SET
           ${updateColumn},
           updated_at = excluded.updated_at`
      )
      .run(
        minuteBucket,
        field === "accepted" ? 1 : 0,
        field === "dropped" ? 1 : 0,
        field === "error" ? 1 : 0,
        field === "sealed" ? 1 : 0,
        now
      );
  } catch (error) {
    logger.debug(
      "bumpIngestionMinute failed",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export interface RecordEventOptions {
  // When true, ingest even if statisticsEnabled is false (used for one-shot
  // backfills). Defaults to false.
  forceWrite?: boolean;
}

const insertStatement = () =>
  sqlite.prepare(
    `INSERT OR IGNORE INTO usage_statistics_events
       (id, schema_version, event_type, recorded_at, client_occurred_at, day,
        actor_role, surface, session_id, related_event_id, video_id, collection_id,
        subscription_id, rss_token_id, platform, source_kind, duration_seconds, value, payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

export function recordEvent(
  input: StatisticsEventInput,
  options: RecordEventOptions = {}
): string | null {
  try {
    if (!options.forceWrite && !isStatisticsEnabled()) return null;
    if (input.actorRole === "visitor" && !shouldTrackVisitorActivity()) return null;

    const id = input.id ?? crypto.randomUUID();
    const recordedAt = input.recordedAt ?? Date.now();
    const day = dayBucket(recordedAt, getResolvedTimezone());

    if (isDaySealed(day)) {
      bumpIngestionMinute("sealed");
      bumpIngestionMinute("dropped");
      return null;
    }

    insertStatement().run(
      id,
      input.schemaVersion ?? 1,
      input.eventType,
      recordedAt,
      input.clientOccurredAt ?? null,
      day,
      input.actorRole,
      normalizeSurface(input.surface ?? "web"),
      input.sessionId ?? null,
      input.relatedEventId ?? null,
      input.videoId ?? null,
      input.collectionId ?? null,
      input.subscriptionId ?? null,
      input.rssTokenId ?? null,
      input.platform ? normalizePlatform(input.platform) : null,
      input.sourceKind ? normalizeSourceKind(input.sourceKind) : null,
      input.durationSeconds ?? null,
      input.value ?? null,
      JSON.stringify(input.payload ?? {})
    );

    markDayDirty(day, recordedAt);
    bumpIngestionMinute("accepted");
    return id;
  } catch (error) {
    logger.debug(
      "Failed to record statistics event",
      error instanceof Error ? error : new Error(String(error))
    );
    bumpIngestionMinute("error");
    return null;
  }
}

export interface BatchIngestEvent {
  id?: string;
  schemaVersion?: number;
  eventType: StatisticsEventType;
  clientOccurredAt?: number;
  sessionId?: string;
  relatedEventId?: string;
  surface?: string;
  videoId?: string;
  collectionId?: string;
  platform?: string;
  sourceKind?: string;
  durationSeconds?: number;
  value?: number;
  payload?: Record<string, unknown>;
}

export interface BatchIngestResult {
  acceptedCount: number;
  droppedCount: number;
  sealedDayDropCount: number;
}

const FRONTEND_ALLOWED_TYPES: ReadonlySet<StatisticsEventType> = new Set<StatisticsEventType>([
  "search_submitted",
  "video_play_started",
  "video_watch_chunk_recorded",
]);

// Best-effort batch ingestion for the dedicated POST /api/statistics/events route.
export function ingestBatch(
  events: BatchIngestEvent[],
  options: { actorRole: "admin" | "visitor"; surface: string }
): BatchIngestResult {
  const result: BatchIngestResult = {
    acceptedCount: 0,
    droppedCount: 0,
    sealedDayDropCount: 0,
  };

  if (!isStatisticsEnabled()) {
    result.droppedCount = events.length;
    return result;
  }
  if (options.actorRole === "visitor" && !shouldTrackVisitorActivity()) {
    result.droppedCount = events.length;
    return result;
  }

  const tz = getResolvedTimezone();
  const ins = insertStatement();

  for (const evt of events) {
    if (!FRONTEND_ALLOWED_TYPES.has(evt.eventType)) {
      result.droppedCount += 1;
      continue;
    }
    try {
      const id = evt.id ?? crypto.randomUUID();
      const now = Date.now();
      const recordedAt = now;
      const day = dayBucket(recordedAt, tz);

      let clientOccurredAt: number | null = null;
      if (typeof evt.clientOccurredAt === "number" && Number.isFinite(evt.clientOccurredAt)) {
        if (Math.abs(now - evt.clientOccurredAt) <= 10 * 60 * 1000) {
          clientOccurredAt = evt.clientOccurredAt;
        } else {
          clientOccurredAt = null;
        }
      }

      if (isDaySealed(day)) {
        result.sealedDayDropCount += 1;
        result.droppedCount += 1;
        bumpIngestionMinute("sealed");
        bumpIngestionMinute("dropped");
        continue;
      }

      ins.run(
        id,
        evt.schemaVersion ?? 1,
        evt.eventType,
        recordedAt,
        clientOccurredAt,
        day,
        options.actorRole,
        normalizeSurface(evt.surface ?? options.surface ?? "web"),
        evt.sessionId ?? null,
        evt.relatedEventId ?? null,
        evt.videoId ?? null,
        evt.collectionId ?? null,
        null,
        null,
        evt.platform ? normalizePlatform(evt.platform) : null,
        evt.sourceKind ? normalizeSourceKind(evt.sourceKind) : null,
        typeof evt.durationSeconds === "number" ? evt.durationSeconds : null,
        typeof evt.value === "number" ? evt.value : null,
        JSON.stringify(evt.payload ?? {})
      );
      markDayDirty(day, recordedAt);
      result.acceptedCount += 1;
      bumpIngestionMinute("accepted");
    } catch (error) {
      logger.debug(
        "Failed to ingest batch event",
        error instanceof Error ? error : new Error(String(error))
      );
      result.droppedCount += 1;
      bumpIngestionMinute("error");
    }
  }
  return result;
}
