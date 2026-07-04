import { NextFunction, Request, Response } from "express";
import { isLoginRequired } from "../services/passwordService";
import {
  matchesExactPath,
  matchesPathOrSubpath,
} from "../utils/requestPath";

const PUBLIC_EXACT_PATHS = [
  "/verify-password",
  "/verify-admin-password",
  "/verify-user-login",
  "/verify-visitor-password",
  "/logout",
  "/password-enabled",
  "/passkeys/exists",
] as const;

const PUBLIC_PREFIX_PATHS = [
  "/passkeys/authenticate",
] as const;

const VISITOR_ALLOWED_GET_PATHS = [
  "/",
  "/cloudflared/status",
  "/password-enabled",
  "/passkeys",
  "/passkeys/exists",
  "/check-cookies",
  "/hooks/status",
  "/last-backup-info",
] as const;

const VISITOR_ALLOWED_WRITE_EXACT_PATHS = [
  "/verify-password",
  "/verify-admin-password",
  "/verify-user-login",
  "/verify-visitor-password",
  "/logout",
] as const;

const VISITOR_ALLOWED_WRITE_PREFIX_PATHS = ["/passkeys/authenticate"] as const;

/**
 * Check if the current request is to a public endpoint that doesn't require authentication
 */
const isPublicEndpoint = (req: Request): boolean => {
  return (
    matchesExactPath(req, PUBLIC_EXACT_PATHS) ||
    matchesPathOrSubpath(req, PUBLIC_PREFIX_PATHS)
  );
};

/**
 * Middleware specifically for settings routes with role-based access control
 * Visitors can only read settings and update CloudFlare tunnel settings
 * Admins have full access to all settings
 * Unauthenticated users are blocked when loginEnabled is true (except for public endpoints)
 */
export const roleBasedSettingsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.apiKeyAuthenticated === true) {
    res.status(403).json({
      success: false,
      error: "API key authentication cannot access settings endpoints.",
      errorKey: "settingsApiKeyForbidden",
    });
    return;
  }

  const loginRequired = isLoginRequired();

  // When login is disabled, all settings requests should behave as admin access.
  if (!loginRequired) {
    next();
    return;
  }

  // If user is Admin, allow all requests
  if (req.user?.role === "admin") {
    next();
    return;
  }

  // If user is Visitor, restrict to read-only and CloudFlare updates
  if (req.user?.role === "visitor") {
    // Allow GET requests (read-only)
    if (req.method === "GET") {
      const isAllowed = matchesPathOrSubpath(req, VISITOR_ALLOWED_GET_PATHS);

      if (isAllowed) {
        next();
        return;
      }

      // If not in allowlist, block the request
      // This specifically blocks /export-database and any other sensitive GET endpoints
      res.status(403).json({
        success: false,
        error: "Visitor role: Access to this resource is restricted.",
        errorKey: "settingsVisitorAccessRestricted",
      });
      return;
    }

    // For write requests, allow only auth endpoints. Settings writes — including
    // Cloudflare tunnel config (cloudflaredToken / cloudflaredTunnelEnabled) — are
    // admin-only: a visitor must not be able to repoint or disable the tunnel.
    if (req.method === "POST" || req.method === "PATCH") {
      if (matchesExactPath(req, VISITOR_ALLOWED_WRITE_EXACT_PATHS)) {
        next();
        return;
      }

      if (matchesPathOrSubpath(req, VISITOR_ALLOWED_WRITE_PREFIX_PATHS)) {
        next();
        return;
      }

      // Block all settings updates (including Cloudflare tunnel config)
      res.status(403).json({
        success: false,
        error: "Visitor role: Write operations are not allowed. Read-only access only.",
        errorKey: "settingsVisitorWriteRestricted",
      });
      return;
    }

    // Block all other write operations (PUT, DELETE, etc.)
    res.status(403).json({
      success: false,
      error: "Visitor role: Write operations are not allowed.",
      errorKey: "settingsVisitorWriteForbidden",
    });
    return;
  }

  // For unauthenticated users, check if login is required
  if (!req.user) {
    // If login is required and this is not a public endpoint, reject the request
    if (!isPublicEndpoint(req)) {
      res.status(401).json({
        success: false,
        error: "Authentication required. Please log in to access this resource.",
        errorKey: "settingsAuthRequired",
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
