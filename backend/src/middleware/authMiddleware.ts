import { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import {
  getAuthCookieName,
  getUserPayloadFromSession,
  UserPayload,
  verifyToken,
} from "../services/authService";
import * as storageService from "../services/storageService";
import { defaultSettings } from "../types/settings";

// Extend Express Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
      apiKeyAuthenticated?: boolean;
    }
  }
}

const readHeaderValue = (
  value: string | string[] | undefined
): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0];
  }
  return undefined;
};

const getApiKeyFromRequest = (req: Request): string | null => {
  const directHeaderKey = readHeaderValue(req.headers["x-api-key"]);
  if (typeof directHeaderKey === "string" && directHeaderKey.trim().length > 0) {
    return directHeaderKey.trim();
  }

  const authorizationHeader = readHeaderValue(req.headers.authorization);
  if (
    typeof authorizationHeader === "string" &&
    authorizationHeader.startsWith("ApiKey ")
  ) {
    const apiKey = authorizationHeader.slice("ApiKey ".length).trim();
    return apiKey.length > 0 ? apiKey : null;
  }

  return null;
};

const isApiKeyMatch = (providedApiKey: string, storedApiKey: string): boolean => {
  // Hash both keys with HMAC-SHA256 before comparing so the digests are
  // always 32 bytes regardless of input length. This lets timingSafeEqual
  // run in constant time without leaking length information via an early return.
  const secret = Buffer.from("mytube-api-key-comparison", "utf8");
  const providedHash = crypto.createHmac("sha256", secret).update(providedApiKey).digest();
  const storedHash = crypto.createHmac("sha256", secret).update(storedApiKey).digest();
  return crypto.timingSafeEqual(providedHash, storedHash);
};

const isApiKeyAuthorized = (req: Request): boolean => {
  const providedApiKey = getApiKeyFromRequest(req);
  if (!providedApiKey) {
    return false;
  }

  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };
  if (mergedSettings.apiKeyEnabled !== true) {
    return false;
  }

  const storedApiKey =
    typeof mergedSettings.apiKey === "string"
      ? mergedSettings.apiKey.trim()
      : "";
  if (storedApiKey.length === 0) {
    return false;
  }

  return isApiKeyMatch(providedApiKey, storedApiKey);
};

/**
 * Middleware to resolve authenticated user and attach user to request
 * Checks HTTP-only session cookie first, then Authorization header JWT for backward compatibility.
 * Does NOT block requests if token is missing/invalid, just leaves req.user undefined
 * Blocking logic should be handled by specific route guards or role-based middleware
 */
export const authMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  // First, try to get user from HTTP-only session cookie (preferred method)
  const cookieName = getAuthCookieName();
  const sessionIdFromCookie = req.cookies?.[cookieName];

  // Security: session IDs are opaque random values. User identity is resolved
  // from trusted in-memory server-side session state only.
  if (sessionIdFromCookie) {
    const sessionPayload = getUserPayloadFromSession(sessionIdFromCookie);
    if (sessionPayload) {
      req.user = sessionPayload;
      next();
      return;
    }
  }

  // Fallback to Authorization header for backward compatibility
  // Security: Similar to above - authHeader is user-controlled, but security decision
  // is based on verifyToken() which performs server-side JWT signature verification.
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    // Only set req.user if token is valid (server-verified)
    if (decoded) {
      req.user = decoded;
      next();
      return;
    }
  }

  // API key is an alternate auth path for automation clients that do not use session login.
  if (isApiKeyAuthorized(req)) {
    req.apiKeyAuthenticated = true;
    next();
    return;
  }

  next();
};
