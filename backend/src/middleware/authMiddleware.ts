import { NextFunction, Request, Response } from "express";
import {
  deleteSession,
  getAuthCookieName,
  getUserPayloadFromSession,
  UserPayload,
} from "../services/authService";
import { isUserSessionPayloadValid } from "../services/userService";
import { isApiKeyAuthorized } from "../utils/apiKeyAuth";

// Extend Express Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
      apiKeyAuthenticated?: boolean;
    }
  }
}

/**
 * Middleware to resolve authenticated user and attach user to request
 * Resolves identity from the HTTP-only session cookie, then from the API key path.
 * Does NOT block requests if token is missing/invalid, just leaves req.user undefined
 * Blocking logic should be handled by specific route guards or role-based middleware
 */
export const authMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  // First, try to get user from HTTP-only session cookie (preferred method)
  const sessionIdFromCookie = req.cookies?.[getAuthCookieName()];

  // Security: session IDs are opaque random values. User identity is resolved
  // from trusted in-memory server-side session state only.
  if (sessionIdFromCookie) {
    const sessionPayload = getUserPayloadFromSession(sessionIdFromCookie);
    if (sessionPayload) {
      if (!isUserSessionPayloadValid(sessionPayload)) {
        deleteSession(sessionIdFromCookie);
      } else {
        req.user = sessionPayload;
        next();
        return;
      }
    }
  }

  // NOTE: `Authorization: Bearer <jwt>` is deliberately NOT an authentication
  // path. JWTs are an internal login -> session handoff detail and are never
  // handed to a client, so no legitimate caller sends one. Accepting them only
  // gave anyone who learned the signing key a way to mint a `{ role: "admin" }`
  // token with no bound user record. Automation uses the API key path below.

  // API key is an alternate auth path for automation clients that do not use session login.
  if (isApiKeyAuthorized(req)) {
    req.apiKeyAuthenticated = true;
    next();
    return;
  }

  next();
};
