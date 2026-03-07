import crypto from "crypto";
import { Response } from "express";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { sqlite } from "../db";
import { AUTH_SESSIONS_SCHEMA, ensureSqliteTableSchema } from "../db/sqliteStorageSchemas";
import { recordSecurityAuditEvent } from "./securityAuditService";

const DEVELOPMENT_JWT_SECRET =
  "default_development_secret_do_not_use_in_production";
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;
const JWT_EXPIRES_IN = "24h";
const SESSION_COOKIE_NAME = "mytube_auth_session";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SESSION_ACTIVITY_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

let sessionStorageInitialized = false;

interface AuthSessionRow {
  userRole: string;
  userId: string | null;
  expiresAt: number;
  revokedAt: number | null;
  lastSeenAt: number | null;
}

export interface UserPayload {
  role: "admin" | "visitor";
  id?: string;
}

export type AuthMethod = "password" | "passkey" | "bootstrap" | "unknown";

export interface AuthSessionContext {
  ip?: string;
  userAgent?: string;
  authMethod?: AuthMethod;
  previousSessionId?: string;
}

interface JwtConfigOptions {
  jwtSecret?: string;
  nodeEnv?: string;
}

const sanitizeAuditField = (
  value: string | undefined,
  maxLength: number,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/[\x00-\x1F\x7F]/g, "").trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.slice(0, maxLength);
};

const normalizeJwtSecret = (value: string | undefined): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

export const assertJwtSecretConfiguration = (
  options: JwtConfigOptions = {},
): string => {
  const nodeEnv = (options.nodeEnv ?? process.env.NODE_ENV ?? "")
    .trim()
    .toLowerCase();
  const configuredSecret = normalizeJwtSecret(
    options.jwtSecret ?? process.env.JWT_SECRET,
  );

  if (nodeEnv === "production") {
    if (
      configuredSecret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH ||
      configuredSecret === DEVELOPMENT_JWT_SECRET
    ) {
      throw new Error(
        `JWT_SECRET must be set to at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production.`,
      );
    }
  }

  return configuredSecret || DEVELOPMENT_JWT_SECRET;
};

const getJwtSecret = (): string => assertJwtSecretConfiguration();

const hashSessionId = (sessionId: string): string =>
  crypto.createHash("sha256").update(sessionId).digest("hex");

const ensureSessionStorage = (): void => {
  if (sessionStorageInitialized) {
    return;
  }

  ensureSqliteTableSchema(sqlite, AUTH_SESSIONS_SCHEMA);

  sessionStorageInitialized = true;
};

const pruneExpiredSessions = (): void => {
  ensureSessionStorage();
  sqlite.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(Date.now());
};

const createSession = (
  payload: UserPayload,
  context: AuthSessionContext,
): { sessionId: string; sessionHash: string } => {
  ensureSessionStorage();
  pruneExpiredSessions();

  const sessionId = crypto.randomBytes(32).toString("base64url");
  const sessionHash = hashSessionId(sessionId);
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_AGE_MS;
  const authMethod = context.authMethod ?? "unknown";
  const loginIp = sanitizeAuditField(context.ip, 128) ?? "unknown";
  const loginUserAgent = sanitizeAuditField(context.userAgent, 512) ?? "unknown";

  sqlite
    .prepare(
      `
      INSERT INTO auth_sessions (
        id,
        session_hash,
        user_role,
        user_id,
        created_at,
        updated_at,
        last_seen_at,
        expires_at,
        auth_method,
        login_ip,
        login_user_agent
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      uuidv4(),
      sessionHash,
      payload.role,
      payload.id ?? null,
      now,
      now,
      now,
      expiresAt,
      authMethod,
      loginIp,
      loginUserAgent,
    );

  recordSecurityAuditEvent({
    eventType: "auth.login.success",
    actor: payload.id ? `${payload.role}:${payload.id}` : payload.role,
    sourceIp: loginIp,
    userAgent: loginUserAgent,
    target: "/api/settings/login",
    result: "success",
    summary: `${authMethod} login succeeded`,
    metadata: {
      role: payload.role,
      authMethod,
      sessionIdHash: sessionHash,
    },
    timestamp: now,
  });

  return { sessionId, sessionHash };
};

export const revokeAuthSession = (
  sessionId: string,
  reason = "manual_logout",
): boolean => {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return false;
  }

  ensureSessionStorage();
  const sessionHash = hashSessionId(sessionId.trim());
  const now = Date.now();
  const safeReason = sanitizeAuditField(reason, 128) ?? "manual_logout";

  const result = sqlite
    .prepare(
      `
      UPDATE auth_sessions
      SET revoked_at = ?, revoked_reason = ?, updated_at = ?
      WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > ?
      `,
    )
    .run(now, safeReason, now, sessionHash, now);

  return result.changes > 0;
};

export const revokeAllAuthSessionsForRole = (
  role: "admin" | "visitor",
  reason = "manual_logout_all",
): number => {
  ensureSessionStorage();
  const now = Date.now();
  const safeReason = sanitizeAuditField(reason, 128) ?? "manual_logout_all";

  const result = sqlite
    .prepare(
      `
      UPDATE auth_sessions
      SET revoked_at = ?, revoked_reason = ?, updated_at = ?
      WHERE user_role = ? AND revoked_at IS NULL AND expires_at > ?
      `,
    )
    .run(now, safeReason, now, role, now);

  return result.changes;
};

const readSessionRow = (sessionId: string): AuthSessionRow | null => {
  ensureSessionStorage();
  const sessionHash = hashSessionId(sessionId);
  const row = sqlite
    .prepare(
      `
      SELECT
        user_role AS userRole,
        user_id AS userId,
        expires_at AS expiresAt,
        revoked_at AS revokedAt,
        last_seen_at AS lastSeenAt
      FROM auth_sessions
      WHERE session_hash = ?
      LIMIT 1
      `,
    )
    .get(sessionHash) as AuthSessionRow | undefined;

  if (!row) {
    return null;
  }

  const now = Date.now();
  if (row.expiresAt <= now || row.revokedAt !== null) {
    return null;
  }

  if (
    row.lastSeenAt === null ||
    now - row.lastSeenAt >= SESSION_ACTIVITY_UPDATE_INTERVAL_MS
  ) {
    sqlite
      .prepare(
        `
        UPDATE auth_sessions
        SET last_seen_at = ?, updated_at = ?
        WHERE session_hash = ?
        `,
      )
      .run(now, now, sessionHash);
  }

  return row;
};

/**
 * Generate a JWT token for a user
 */
export const generateToken = (payload: UserPayload): string => {
  return jwt.sign({ ...payload, id: payload.id || uuidv4() }, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN,
  });
};

/**
 * Verify a JWT token
 */
export const verifyToken = (token: string): UserPayload | null => {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as UserPayload;
    return decoded;
  } catch (error) {
    return null;
  }
};

/**
 * Resolve a session cookie to a user payload.
 */
export const getUserPayloadFromSession = (
  sessionId: string,
): UserPayload | null => {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return null;
  }

  pruneExpiredSessions();
  const session = readSessionRow(sessionId.trim());
  if (!session) {
    return null;
  }

  if (session.userRole !== "admin" && session.userRole !== "visitor") {
    return null;
  }

  return {
    role: session.userRole,
    id: session.userId ?? undefined,
  };
};

/**
 * Set HTTP-only cookie with opaque server-side session id
 * This avoids storing sensitive auth material in clear-text client cookies.
 */
export const setAuthCookie = (
  res: Response,
  token: string,
  role: "admin" | "visitor",
  context: AuthSessionContext = {},
): void => {
  const payload = verifyToken(token) ?? { role, id: uuidv4() };
  const { sessionId, sessionHash } = createSession(payload, context);
  const previousSessionId = context.previousSessionId?.trim();
  if (previousSessionId && previousSessionId !== sessionId) {
    revokeAuthSession(previousSessionId, "session_rotated");
  }
  const isSecure = process.env.SECURE_COOKIES === "true";

  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true, // Not accessible to JavaScript, preventing XSS attacks
    secure: isSecure, // Only sent over HTTPS if explicitly configured
    sameSite: "lax", // Better persistence across navigations
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });

  recordSecurityAuditEvent({
    eventType: "auth.session.issued",
    actor: payload.id ? `${payload.role}:${payload.id}` : payload.role,
    sourceIp: context.ip ?? "unknown",
    userAgent: context.userAgent ?? "unknown",
    target: "/api/settings/login",
    result: "success",
    summary: "new auth session issued",
    metadata: {
      role: payload.role,
      sessionIdHash: sessionHash,
      expiresAt: Date.now() + SESSION_MAX_AGE_MS,
    },
  });
};

/**
 * Clear authentication cookies
 */
export const clearAuthCookie = (res: Response): void => {
  const isSecure = process.env.SECURE_COOKIES === "true";
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
  });
  // Legacy cleanup for older clients.
  res.clearCookie("mytube_role", {
    httpOnly: false,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
  });
};

/**
 * Get cookie name for authentication session id
 */
export const getAuthCookieName = (): string => {
  return SESSION_COOKIE_NAME;
};
