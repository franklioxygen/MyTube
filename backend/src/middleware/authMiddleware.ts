import { NextFunction, Request, Response } from "express";
import { getAuthCookieName, UserPayload, verifyToken } from "../services/authService";

// Extend Express Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

/**
 * Middleware to verify JWT token and attach user to request
 * Checks both HTTP-only cookies (preferred) and Authorization header (for backward compatibility)
 * Does NOT block requests if token is missing/invalid, just leaves req.user undefined
 * Blocking logic should be handled by specific route guards or role-based middleware
 */
export const authMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  // First, try to get token from HTTP-only cookie (preferred method)
  const cookieName = getAuthCookieName();
  const tokenFromCookie = req.cookies?.[cookieName];

  // Security: Even though tokenFromCookie comes from user input (cookies),
  // the security decision is based on verifyToken() which verifies the JWT signature server-side.
  // If the token is invalid or tampered with, verifyToken() returns null and req.user remains undefined.
  if (tokenFromCookie) {
    const decoded = verifyToken(tokenFromCookie);
    // Only set req.user if token is valid (server-verified)
    if (decoded) {
      req.user = decoded;
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
