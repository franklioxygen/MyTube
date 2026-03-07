import type { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { sqlite } from "../db";
import {
  SECURITY_ALERT_WINDOWS_SCHEMA,
  SECURITY_AUDIT_LOGS_SCHEMA,
  ensureSqliteTableSchema,
  type SQLiteDatabaseLike,
} from "../db/sqliteStorageSchemas";
import { getClientIp as getTrustedClientIp } from "../utils/security";
import { logger } from "../utils/logger";

export type SecurityAuditResult =
  | "success"
  | "failure"
  | "denied"
  | "rejected"
  | "alert";

interface SecurityAuditRecord {
  eventType: string;
  actor: string;
  sourceIp: string;
  userAgent: string;
  target: string;
  result: SecurityAuditResult;
  summary: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export interface RecordSecurityAuditEventInput {
  eventType: string;
  req?: Request;
  actor?: string;
  sourceIp?: string;
  userAgent?: string;
  target?: string;
  result?: SecurityAuditResult;
  summary?: string;
  metadata?: Record<string, unknown>;
  timestamp?: number;
  level?: "info" | "warn";
}

interface AlertWindowState {
  timestamps: number[];
  lastAlertAt: number;
}

interface AlertRule {
  name:
    | "anomalous_login"
    | "permission_denied_burst"
    | "dangerous_config_rejected_burst"
    | "path_traversal_burst";
  eventType: string;
  windowMs: number;
  threshold: number;
  cooldownMs: number;
  message: string;
}

const MAX_TEXT_LENGTH = 512;
const MAX_METADATA_KEYS = 50;
const IS_TEST_ENV =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const SENSITIVE_METADATA_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|authorization|cookie)/i;

const ALERT_RULES: readonly AlertRule[] = [
  {
    name: "anomalous_login",
    eventType: "auth.login.success",
    windowMs: 10 * 60 * 1000,
    threshold: 10,
    cooldownMs: 5 * 60 * 1000,
    message: "Abnormal login burst detected",
  },
  {
    name: "permission_denied_burst",
    eventType: "authz.denied",
    windowMs: 5 * 60 * 1000,
    threshold: 20,
    cooldownMs: 2 * 60 * 1000,
    message: "Permission denied burst detected",
  },
  {
    name: "dangerous_config_rejected_burst",
    eventType: "config.dangerous_rejected",
    windowMs: 10 * 60 * 1000,
    threshold: 5,
    cooldownMs: 5 * 60 * 1000,
    message: "Dangerous config rejection burst detected",
  },
  {
    name: "path_traversal_burst",
    eventType: "path.traversal_attempt",
    windowMs: 10 * 60 * 1000,
    threshold: 3,
    cooldownMs: 5 * 60 * 1000,
    message: "Path traversal attempt burst detected",
  },
];

const alertWindows = new Map<string, AlertWindowState>();
let storageInitialized = false;

const normalizeText = (value: unknown, fallback = "unknown"): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.replace(/[\x00-\x1F\x7F]/g, " ").trim();
  if (normalized.length === 0) {
    return fallback;
  }
  return normalized.slice(0, MAX_TEXT_LENGTH);
};

const readHeaderValue = (value: string | string[] | undefined): string => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return "";
};

const getRequestClientIp = (req: Request): string => {
  const trustedIp = getTrustedClientIp(req);
  if (trustedIp !== "unknown") {
    return trustedIp;
  }
  return typeof req.ip === "string" && req.ip.trim().length > 0
    ? req.ip.trim()
    : "unknown";
};

const getSourceIpFromRequest = (req?: Request): string => {
  if (!req) {
    return "unknown";
  }
  return normalizeText(getRequestClientIp(req), "unknown");
};

const getUserAgentFromRequest = (req?: Request): string =>
  normalizeText(readHeaderValue(req?.headers?.["user-agent"]), "unknown");

const getTargetFromRequest = (req?: Request): string => {
  if (!req) {
    return "unknown";
  }
  const candidate = req.originalUrl || req.url || req.path;
  return normalizeText(candidate, "unknown");
};

const getActorFromRequest = (req?: Request): string => {
  if (!req) {
    return "system";
  }
  if (req.apiKeyAuthenticated === true) {
    return "api_key";
  }
  const role = req.user?.role;
  const id = req.user?.id;
  if (role && id) {
    return `${role}:${id}`;
  }
  if (role) {
    return role;
  }
  return "anonymous";
};

const sanitizeMetadataValue = (value: unknown, depth = 0): unknown => {
  if (depth > 3) {
    return "[truncated]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return normalizeText(value, "");
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_METADATA_KEYS).map((item) =>
      sanitizeMetadataValue(item, depth + 1)
    );
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(value).slice(
      0,
      MAX_METADATA_KEYS
    )) {
      const key = normalizeText(rawKey, "unknown_key");
      if (SENSITIVE_METADATA_KEY_PATTERN.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = sanitizeMetadataValue(rawValue, depth + 1);
      }
    }
    return output;
  }
  return String(value);
};

const sanitizeMetadata = (
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> =>
  (sanitizeMetadataValue(metadata || {}, 0) as Record<string, unknown>) || {};

const getSqlite = (): SQLiteDatabaseLike | null => {
  return IS_TEST_ENV ? null : sqlite;
};

const ensureAuditStorage = (): void => {
  if (IS_TEST_ENV || storageInitialized) {
    return;
  }

  const sqlite = getSqlite();
  if (!sqlite) {
    return;
  }

  ensureSqliteTableSchema(sqlite, SECURITY_AUDIT_LOGS_SCHEMA, (error) => {
    logger.debug(
      "Security audit index creation skipped (may already exist)",
      error instanceof Error ? error : new Error(String(error))
    );
  });
  ensureSqliteTableSchema(sqlite, SECURITY_ALERT_WINDOWS_SCHEMA, (error) => {
    logger.debug(
      "Security alert window index creation skipped (may already exist)",
      error instanceof Error ? error : new Error(String(error))
    );
  });

  storageInitialized = true;
};

const parseAlertWindowTimestamps = (rawValue: string): number[] => {
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((value) => Number.isFinite(value))
      .map((value) => Number(value))
      .sort((a, b) => a - b)
      .slice(-256);
  } catch {
    return [];
  }
};

const getAlertWindowState = (key: string): AlertWindowState => {
  const cached = alertWindows.get(key);
  if (cached) {
    return {
      timestamps: [...cached.timestamps],
      lastAlertAt: cached.lastAlertAt,
    };
  }

  if (IS_TEST_ENV) {
    return { timestamps: [], lastAlertAt: 0 };
  }

  const sqlite = getSqlite();
  if (!sqlite) {
    return { timestamps: [], lastAlertAt: 0 };
  }

  ensureAuditStorage();

  try {
    const row = sqlite
      .prepare(
        `
        SELECT
          timestamps_json AS timestampsJson,
          last_alert_at AS lastAlertAt
        FROM security_alert_windows
        WHERE window_key = ?
        `
      )
      .get?.(key) as
      | {
          timestampsJson: string;
          lastAlertAt: number;
        }
      | undefined;

    if (!row) {
      return { timestamps: [], lastAlertAt: 0 };
    }

    const state = {
      timestamps: parseAlertWindowTimestamps(row.timestampsJson),
      lastAlertAt: Number.isFinite(row.lastAlertAt) ? row.lastAlertAt : 0,
    };
    alertWindows.set(key, state);
    return {
      timestamps: [...state.timestamps],
      lastAlertAt: state.lastAlertAt,
    };
  } catch (error) {
    logger.debug(
      "Failed to load security alert window state",
      error instanceof Error ? error : new Error(String(error))
    );
    return { timestamps: [], lastAlertAt: 0 };
  }
};

const persistAlertWindowState = (
  key: string,
  state: AlertWindowState,
  updatedAt: number
): void => {
  const normalizedState = {
    timestamps: state.timestamps
      .filter((timestamp) => Number.isFinite(timestamp))
      .slice(-256),
    lastAlertAt: Number.isFinite(state.lastAlertAt) ? state.lastAlertAt : 0,
  };

  alertWindows.set(key, normalizedState);

  if (IS_TEST_ENV) {
    return;
  }

  const sqlite = getSqlite();
  if (!sqlite) {
    return;
  }

  ensureAuditStorage();

  try {
    sqlite
      .prepare(
        `
        INSERT OR REPLACE INTO security_alert_windows (
          window_key,
          timestamps_json,
          last_alert_at,
          updated_at
        )
        VALUES (?, ?, ?, ?)
        `
      )
      .run(
        key,
        JSON.stringify(normalizedState.timestamps),
        normalizedState.lastAlertAt,
        updatedAt
      );
  } catch (error) {
    logger.debug(
      "Failed to persist security alert window state",
      error instanceof Error ? error : new Error(String(error))
    );
  }
};

const persistAuditRecord = (record: SecurityAuditRecord): void => {
  if (IS_TEST_ENV) {
    return;
  }

  const sqlite = getSqlite();
  if (!sqlite) {
    return;
  }

  ensureAuditStorage();
  try {
    sqlite
      .prepare(
        `
        INSERT INTO security_audit_logs (
          id,
          event_type,
          actor,
          source_ip,
          user_agent,
          target,
          result,
          summary,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        uuidv4(),
        record.eventType,
        record.actor,
        record.sourceIp,
        record.userAgent,
        record.target,
        record.result,
        record.summary,
        JSON.stringify(record.metadata),
        record.timestamp
      );
  } catch (error) {
    logger.error(
      "Failed to persist security audit record",
      error instanceof Error ? error : new Error(String(error))
    );
  }
};

const emitAlertIfNeeded = (record: SecurityAuditRecord): void => {
  if (record.eventType.startsWith("security.alert.")) {
    return;
  }

  for (const rule of ALERT_RULES) {
    if (rule.eventType !== record.eventType) {
      continue;
    }

    const key = `${rule.name}:${record.sourceIp}`;
    const existing = getAlertWindowState(key);

    const cutoff = record.timestamp - rule.windowMs;
    const kept = existing.timestamps.filter((timestamp) => timestamp >= cutoff);
    kept.push(record.timestamp);
    existing.timestamps = kept;

    const shouldTrigger =
      kept.length >= rule.threshold &&
      record.timestamp - existing.lastAlertAt >= rule.cooldownMs;

    if (!shouldTrigger) {
      persistAlertWindowState(key, existing, record.timestamp);
      continue;
    }

    existing.lastAlertAt = record.timestamp;
    persistAlertWindowState(key, existing, record.timestamp);

    const alertRecord: SecurityAuditRecord = {
      eventType: `security.alert.${rule.name}`,
      actor: "security_monitor",
      sourceIp: record.sourceIp,
      userAgent: record.userAgent,
      target: record.target,
      result: "alert",
      summary: `${rule.message}: ${kept.length} event(s) within ${Math.round(
        rule.windowMs / 60000
      )} minute(s)`,
      metadata: {
        threshold: rule.threshold,
        count: kept.length,
        windowMs: rule.windowMs,
        triggerEventType: record.eventType,
      },
      timestamp: record.timestamp,
    };

    persistAuditRecord(alertRecord);
    logger.warn("Security alert", alertRecord);
  }
};

export const recordSecurityAuditEvent = (
  input: RecordSecurityAuditEventInput
): void => {
  if (!input?.eventType || typeof input.eventType !== "string") {
    return;
  }

  const timestamp = Number.isFinite(input.timestamp)
    ? Number(input.timestamp)
    : Date.now();

  const record: SecurityAuditRecord = {
    eventType: normalizeText(input.eventType, "unknown_event"),
    actor: normalizeText(input.actor, getActorFromRequest(input.req)),
    sourceIp: normalizeText(input.sourceIp, getSourceIpFromRequest(input.req)),
    userAgent: normalizeText(
      input.userAgent,
      getUserAgentFromRequest(input.req)
    ),
    target: normalizeText(input.target, getTargetFromRequest(input.req)),
    result: input.result ?? "success",
    summary: normalizeText(input.summary, "no_summary"),
    metadata: sanitizeMetadata(input.metadata),
    timestamp,
  };

  persistAuditRecord(record);
  if (input.level === "warn" || record.result === "denied" || record.result === "rejected") {
    logger.warn("Security audit event", record);
  } else {
    logger.info("Security audit event", record);
  }
  emitAlertIfNeeded(record);
};
