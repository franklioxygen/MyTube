import { NextFunction, Request, Response } from "express";
import apiRoutes from "../routes/api";
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
  "/settings/passkeys/exists",
  "/settings/logout",
] as const;

const PUBLIC_PREFIX_PATHS = [
  "/settings/passkeys/authenticate",
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

const API_KEY_ALLOWED_READ_ROUTE_PATHS = new Set([
  "/collections",
  "/mount-video/:id",
  "/videos",
  "/videos/:id",
]);

type ApiRouteLayer = {
  match?: (path: string) => boolean;
  route?: {
    path?: string | string[];
    methods?: Record<string, boolean>;
  };
};

const getMatchedApiRoutePath = (req: Request): string | null => {
  const requestPath = getNormalizedRequestPath(req);
  const requestMethod = req.method.toLowerCase();
  const routeLayers =
    ((apiRoutes as unknown as { stack?: ApiRouteLayer[] }).stack ?? []);

  for (const layer of routeLayers) {
    if (!layer.route || typeof layer.match !== "function") {
      continue;
    }

    const routePath = layer.route.path;
    if (typeof routePath !== "string") {
      continue;
    }

    const methods = layer.route.methods ?? {};
    const handlesMethod =
      requestMethod === "head"
        ? methods.head === true || methods.get === true
        : methods[requestMethod] === true;

    if (!handlesMethod) {
      continue;
    }

    if (layer.match(requestPath)) {
      return routePath;
    }
  }

  return null;
};

const isApiKeyReadOnlyEndpoint = (req: Request): boolean => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const matchedRoutePath = getMatchedApiRoutePath(req);
  return (
    matchedRoutePath !== null &&
    API_KEY_ALLOWED_READ_ROUTE_PATHS.has(matchedRoutePath)
  );
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
  // API keys are restricted to task submission and a minimal read-only library surface.
  if (req.apiKeyAuthenticated === true) {
    if (isApiKeyDownloadEndpoint(req) || isApiKeyReadOnlyEndpoint(req)) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      error:
        "API key authentication only allows POST /api/download and read-only library endpoints.",
    });
    return;
  }

  const loginRequired = isLoginRequired();

  // When login is disabled, requests should not remain scoped by a stale visitor role.
  if (!loginRequired) {
    next();
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
