import { NextFunction, Request, Response } from "express";
import { isLoginRequired } from "../services/passwordService";
import {
  getNormalizedRequestPath,
  matchesExactPath,
  matchesPathOrSubpath,
} from "../utils/requestPath";

const PUBLIC_EXACT_PATHS = [
  "/settings/verify-password",
  "/settings/verify-admin-password",
  "/settings/verify-visitor-password",
  "/settings/password-enabled",
  "/settings/reset-password-cooldown",
  "/settings/reset-password",
  "/settings/passkeys/exists",
  "/settings/logout",
] as const;

const PUBLIC_PREFIX_PATHS = [
  "/settings/passkeys/authenticate",
  "/settings/passkeys/register",
] as const;

const VISITOR_ALLOWED_POST_EXACT_PATHS = [
  "/settings/verify-password",
  "/settings/verify-admin-password",
  "/settings/verify-visitor-password",
  "/settings/logout",
] as const;

const VISITOR_ALLOWED_POST_PREFIX_PATHS = [
  "/settings/passkeys/authenticate",
] as const;

/**
 * Check if the current request is to a public endpoint that doesn't require authentication
 */
const isPublicEndpoint = (req: Request): boolean => {
  return (
    matchesExactPath(req, PUBLIC_EXACT_PATHS) ||
    matchesPathOrSubpath(req, PUBLIC_PREFIX_PATHS)
  );
};

const isApiKeyDownloadEndpoint = (req: Request): boolean => {
  return req.method === "POST" && getNormalizedRequestPath(req) === "/download";
};

const isAdminUploadEndpoint = (req: Request): boolean => {
  const requestPath = getNormalizedRequestPath(req);
  return (
    req.method === "POST" &&
    (requestPath === "/upload" || requestPath === "/upload/batch")
  );
};

/**
 * Middleware to enforce role-based access control
 * Visitors (userRole === 'visitor') are restricted to read-only operations
 * Admins (userRole === 'admin') have full access
 * Unauthenticated users are blocked when loginEnabled is true (except for public endpoints)
 */
export const roleBasedAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // API keys are intentionally restricted to task submission only.
  if (req.apiKeyAuthenticated === true) {
    if (isApiKeyDownloadEndpoint(req)) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      error:
        "API key authentication only allows POST /api/download requests.",
    });
    return;
  }

  // If user is Admin, allow all requests
  if (req.user?.role === "admin") {
    next();
    return;
  }

  // If user is Visitor, restrict to read-only
  if (req.user?.role === "visitor") {
    // Allow GET requests (read-only)
    if (req.method === "GET") {
      next();
      return;
    }

    // Allow authentication-related POST requests
    if (req.method === "POST") {
      if (matchesExactPath(req, VISITOR_ALLOWED_POST_EXACT_PATHS)) {
        next();
        return;
      }

      if (matchesPathOrSubpath(req, VISITOR_ALLOWED_POST_PREFIX_PATHS)) {
        next();
        return;
      }
    }

    // Block all other write operations (POST, PUT, DELETE, PATCH)
    res.status(403).json({
      success: false,
      error: "Visitor role: Write operations are not allowed. Read-only access only.",
    });
    return;
  }

  // For unauthenticated users, check if login is required
  if (!req.user) {
    const loginRequired = isLoginRequired();

    if (loginRequired && isAdminUploadEndpoint(req)) {
      res.status(401).json({
        success: false,
        error:
          "Video upload endpoints require an authenticated admin session.",
      });
      return;
    }

    // If login is required and this is not a public endpoint, reject the request
    if (loginRequired && !isPublicEndpoint(req)) {
      res.status(401).json({
        success: false,
        error: "Authentication required. Please log in to access this resource.",
      });
      return;
    }

    // If login is not required, or this is a public endpoint, allow the request
    next();
    return;
  }

  // Fallback: allow the request (should not reach here)
  next();
};
