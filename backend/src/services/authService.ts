import { Response } from "express";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

// Warn if JWT_SECRET is not set in production
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  console.error("WARNING: JWT_SECRET is not set in production environment. This is a security risk!");
}

const JWT_SECRET = process.env.JWT_SECRET || "default_development_secret_do_not_use_in_production";
const JWT_EXPIRES_IN = "24h";
const SESSION_COOKIE_NAME = "mytube_auth_session";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface AuthSession {
  payload: UserPayload;
  expiresAt: number;
}

const authSessions = new Map<string, AuthSession>();

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of authSessions.entries()) {
    if (session.expiresAt <= now) {
      authSessions.delete(sessionId);
    }
  }
}

function createSession(payload: UserPayload): string {
  pruneExpiredSessions();
  const sessionId = uuidv4();
  authSessions.set(sessionId, {
    payload,
    expiresAt: Date.now() + SESSION_MAX_AGE_MS,
  });
  return sessionId;
}

export interface UserPayload {
  role: "admin" | "visitor";
  id?: string;
}

/**
 * Generate a JWT token for a user
 */
export const generateToken = (payload: UserPayload): string => {
  return jwt.sign({ ...payload, id: payload.id || uuidv4() }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

/**
 * Verify a JWT token
 */
export const verifyToken = (token: string): UserPayload | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as UserPayload;
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
  if (!sessionId) {
    return null;
  }

  pruneExpiredSessions();
  const session = authSessions.get(sessionId);
  if (!session) {
    return null;
  }

  return session.payload;
};

/**
 * Set HTTP-only cookie with opaque server-side session id
 * This avoids storing sensitive auth material in clear-text client cookies.
 */
export const setAuthCookie = (res: Response, token: string, role: "admin" | "visitor"): void => {
  const payload = verifyToken(token) ?? { role, id: uuidv4() };
  const sessionId = createSession(payload);
  const isSecure = process.env.SECURE_COOKIES === "true";

  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true, // Not accessible to JavaScript, preventing XSS attacks
    secure: isSecure, // Only sent over HTTPS if explicitly configured
    sameSite: "lax", // Better persistence across navigations
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
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
