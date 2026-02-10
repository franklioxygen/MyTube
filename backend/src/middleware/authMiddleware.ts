import { NextFunction, Request, Response } from "express";
import {
  getAuthCookieName,
  getUserPayloadFromSession,
  UserPayload,
  verifyToken,
} from "../services/authService";

// Extend Express Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

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
    }
  }

  next();
};
