// Best-effort statistics event collector.
// All write paths must be fire-and-forget: never let a statistics insert
// fail a download, playback session, search action, RSS response, or settings save.

import crypto from "crypto";
import { sqlite } from "../../db";
import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import { Settings } from "../../types/settings";
import {
  FRONTEND_EVENT_TYPES,
  StatisticsEventInput,
  StatisticsEventType,
} from "./eventTypes";
import {
  dayBucket,
  normalizePlatform,
  normalizeSourceKind,
  normalizeSurface,
} from "./normalizers";

const STATISTICS_TIMEZONE_FIELD = "statisticsTimezone";

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
    { [STATISTICS_TIMEZONE_FIELD]: timezone },
    { extraWhitelistedKeys: [STATISTICS_TIMEZONE_FIELD] }
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

interface PersistedStatisticsEvent {
  id: string;
  schemaVersion: number;
  eventType: StatisticsEventType;
  recordedAt: number;
  clientOccurredAt: number | null;
  day: string;
  actorRole: "admin" | "visitor" | "system";
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
  payloadJson: string;
}

interface PersistedStatisticsEventOverrides {
  id?: string;
  schemaVersion?: number;
  eventType?: StatisticsEventType;
  recordedAt?: number;
  clientOccurredAt?: number | null;
  day?: string;
  actorRole?: "admin" | "visitor" | "system";
  surface?: string;
  sessionId?: string | null;
  relatedEventId?: string | null;
  videoId?: string | null;
  collectionId?: string | null;
  subscriptionId?: string | null;
  rssTokenId?: string | null;
  platform?: string | null;
  sourceKind?: string | null;
  durationSeconds?: number | null;
  value?: number | null;
  payloadJson?: string;
}

const insertStatement = () =>
  sqlite.prepare(
    `INSERT OR IGNORE INTO usage_statistics_events
       (id, schema_version, event_type, recorded_at, client_occurred_at, day,
        actor_role, surface, session_id, related_event_id, video_id, collection_id,
        subscription_id, rss_token_id, platform, source_kind, duration_seconds, value, payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

function canWriteStatisticsEvent(
  actorRole: "admin" | "visitor" | "system",
  forceWrite = false
): boolean {
  if (!forceWrite && !isStatisticsEnabled()) return false;
  return actorRole !== "visitor" || shouldTrackVisitorActivity();
}

function normalizeOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeClientOccurredAt(
  clientOccurredAt: unknown,
  recordedAt: number,
  maxSkewMs = 10 * 60 * 1000
): number | null {
  const normalized = normalizeOptionalNumber(clientOccurredAt);
  if (normalized === null) return null;
  return Math.abs(recordedAt - normalized) <= maxSkewMs ? normalized : null;
}

function serializePayload(payload: Record<string, unknown> | undefined): string {
  return JSON.stringify(payload ?? {});
}

function buildPersistedStatisticsEvent(
  input: StatisticsEventInput,
  overrides: PersistedStatisticsEventOverrides = {}
): PersistedStatisticsEvent {
  const recordedAt = overrides.recordedAt ?? input.recordedAt ?? Date.now();
  return {
    id: overrides.id ?? input.id ?? crypto.randomUUID(),
    schemaVersion: overrides.schemaVersion ?? input.schemaVersion ?? 1,
    eventType: overrides.eventType ?? input.eventType,
    recordedAt,
    clientOccurredAt:
      overrides.clientOccurredAt ?? normalizeOptionalNumber(input.clientOccurredAt),
    day: overrides.day ?? dayBucket(recordedAt, getResolvedTimezone()),
    actorRole: overrides.actorRole ?? input.actorRole,
    surface: overrides.surface ?? normalizeSurface(input.surface ?? "web"),
    sessionId: overrides.sessionId ?? input.sessionId ?? null,
    relatedEventId: overrides.relatedEventId ?? input.relatedEventId ?? null,
    videoId: overrides.videoId ?? input.videoId ?? null,
    collectionId: overrides.collectionId ?? input.collectionId ?? null,
    subscriptionId: overrides.subscriptionId ?? input.subscriptionId ?? null,
    rssTokenId: overrides.rssTokenId ?? input.rssTokenId ?? null,
    platform:
      overrides.platform ??
      (input.platform ? normalizePlatform(input.platform) : null),
    sourceKind:
      overrides.sourceKind ??
      (input.sourceKind ? normalizeSourceKind(input.sourceKind) : null),
    durationSeconds:
      overrides.durationSeconds ?? normalizeOptionalNumber(input.durationSeconds),
    value: overrides.value ?? normalizeOptionalNumber(input.value),
    payloadJson: overrides.payloadJson ?? serializePayload(input.payload),
  };
}

function writePersistedStatisticsEvent(
  statement: ReturnType<typeof insertStatement>,
  event: PersistedStatisticsEvent
): void {
  statement.run(
    event.id,
    event.schemaVersion,
    event.eventType,
    event.recordedAt,
    event.clientOccurredAt,
    event.day,
    event.actorRole,
    event.surface,
    event.sessionId,
    event.relatedEventId,
    event.videoId,
    event.collectionId,
    event.subscriptionId,
    event.rssTokenId,
    event.platform,
    event.sourceKind,
    event.durationSeconds,
    event.value,
    event.payloadJson
  );
}

function handleSealedDayDrop(result?: BatchIngestResult): void {
  if (result) {
    result.sealedDayDropCount += 1;
    result.droppedCount += 1;
  }
  bumpIngestionMinute("sealed");
  bumpIngestionMinute("dropped");
}

export function recordEvent(
  input: StatisticsEventInput,
  options: RecordEventOptions = {}
): string | null {
  try {
    if (!canWriteStatisticsEvent(input.actorRole, options.forceWrite === true)) {
      return null;
    }

    const event = buildPersistedStatisticsEvent(input);
    if (isDaySealed(event.day)) {
      handleSealedDayDrop();
      return null;
    }

    writePersistedStatisticsEvent(insertStatement(), event);
    markDayDirty(event.day, event.recordedAt);
    bumpIngestionMinute("accepted");
    return event.id;
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

interface BatchIngestOptions {
  actorRole: "admin" | "visitor";
  surface: string;
  serverSessionId?: string;
}

const MAX_VISITOR_WATCH_CHUNK_SECONDS = 120;
const MAX_VISITOR_SEARCH_RESULT_COUNT = 10_000;

function sanitizeBoundedInteger(
  value: unknown,
  maxValue: number
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(Math.max(Math.round(value), 0), maxValue);
}

function sanitizeVisitorDurationSeconds(event: BatchIngestEvent): number | undefined {
  if (event.eventType !== "video_watch_chunk_recorded") {
    return undefined;
  }
  return sanitizeBoundedInteger(
    event.durationSeconds,
    MAX_VISITOR_WATCH_CHUNK_SECONDS
  );
}

function sanitizeVisitorPayload(event: BatchIngestEvent): Record<string, unknown> | undefined {
  if (event.eventType !== "search_submitted") {
    return undefined;
  }

  const payload = event.payload ?? {};
  return {
    localResultCount:
      sanitizeBoundedInteger(
        payload.localResultCount,
        MAX_VISITOR_SEARCH_RESULT_COUNT
      ) ?? 0,
    externalResultCount:
      sanitizeBoundedInteger(
        payload.externalResultCount,
        MAX_VISITOR_SEARCH_RESULT_COUNT
      ) ?? 0,
  };
}

function sanitizeBatchEventForActor(
  event: BatchIngestEvent,
  options: BatchIngestOptions
): BatchIngestEvent {
  if (options.actorRole !== "visitor") {
    return event;
  }

  return {
    ...event,
    sessionId: options.serverSessionId,
    platform: "unknown",
    sourceKind: "unknown",
    surface: normalizeSurface(options.surface),
    durationSeconds: sanitizeVisitorDurationSeconds(event),
    value: undefined,
    payload: sanitizeVisitorPayload(event),
  };
}

// Best-effort batch ingestion for the dedicated POST /api/statistics/events route.
export function ingestBatch(
  events: BatchIngestEvent[],
  options: BatchIngestOptions
): BatchIngestResult {
  const result: BatchIngestResult = {
    acceptedCount: 0,
    droppedCount: 0,
    sealedDayDropCount: 0,
  };

  if (!canWriteStatisticsEvent(options.actorRole)) {
    result.droppedCount = events.length;
    return result;
  }

  const tz = getResolvedTimezone();
  const ins = insertStatement();

  // Ingest the whole batch inside one transaction so the per-event event insert,
  // day-dirty upsert, and ingestion-minute counter upserts commit together once
  // instead of fsync-ing on every event (better-sqlite3 is synchronous). Per-event
  // failures are caught inside the loop, so one bad event never rolls back the rest.
  const ingestAll = sqlite.transaction((batch: BatchIngestEvent[]) => {
    for (const evt of batch) {
      if (!FRONTEND_EVENT_TYPES.has(evt.eventType)) {
        result.droppedCount += 1;
        continue;
      }
      try {
        const safeEvent = sanitizeBatchEventForActor(evt, options);
        const recordedAt = Date.now();
        const day = dayBucket(recordedAt, tz);
        if (isDaySealed(day)) {
          handleSealedDayDrop(result);
          continue;
        }

        writePersistedStatisticsEvent(
          ins,
          buildPersistedStatisticsEvent(
            {
              ...safeEvent,
              actorRole: options.actorRole,
              eventType: safeEvent.eventType,
              platform: safeEvent.platform ? normalizePlatform(safeEvent.platform) : null,
              sourceKind: safeEvent.sourceKind ? normalizeSourceKind(safeEvent.sourceKind) : null,
              surface: normalizeSurface(options.surface),
            },
            {
              recordedAt,
              day,
              clientOccurredAt: sanitizeClientOccurredAt(safeEvent.clientOccurredAt, recordedAt),
              surface: normalizeSurface(safeEvent.surface ?? options.surface ?? "web"),
              subscriptionId: null,
              rssTokenId: null,
            }
          )
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
  });

  try {
    ingestAll(events);
  } catch (error) {
    // A failure at the transaction boundary (e.g. commit-time SQLITE_BUSY or a
    // full disk) rolls the whole batch back — nothing was persisted, even though
    // the in-memory `result` counters were incremented inside the function. Don't
    // let this bubble into a 500; report the batch as dropped and record one
    // ingestion-health error (outside the rolled-back transaction).
    logger.warn(
      "Statistics batch ingest transaction failed; dropping batch",
      error instanceof Error ? error : new Error(String(error))
    );
    bumpIngestionMinute("error");
    return {
      acceptedCount: 0,
      droppedCount: events.length,
      sealedDayDropCount: 0,
    };
  }
  return result;
}
