import { NextFunction, Request, Response } from "express";
import { isStrictSecurityModel } from "../config/securityModel";
import { isLoginRequired } from "../services/passwordService";
import { recordSecurityAuditEvent } from "../services/securityAuditService";

/**
 * Check if the current request is to a public endpoint that doesn't require authentication
 */
const isPublicEndpoint = (req: Request, strictMode: boolean): boolean => {
  const requestTarget = `${req.path || ""} ${req.url || ""}`;
  const recoveryTokenHeader = req.headers?.["x-mytube-recovery-token"];
  const hasRecoveryTokenHeader =
    (typeof recoveryTokenHeader === "string" &&
      recoveryTokenHeader.trim().length > 0) ||
    (Array.isArray(recoveryTokenHeader) &&
      typeof recoveryTokenHeader[0] === "string" &&
      recoveryTokenHeader[0].trim().length > 0);
  const hasRecoveryTokenBody =
    typeof req.body?.recoveryToken === "string" &&
    req.body.recoveryToken.trim().length > 0;

  // Allow password verification endpoints (for login)
  if (
    requestTarget.includes("/verify-password") ||
    requestTarget.includes("/verify-admin-password") ||
    requestTarget.includes("/verify-visitor-password")
  ) {
    return true;
  }

  // Allow passkey authentication endpoints (for login)
  if (requestTarget.includes("/passkeys/authenticate")) {
    return true;
  }

  // Allow read-only auth status endpoints.
  if (
    requestTarget.includes("/password-enabled") ||
    requestTarget.includes("/reset-password-cooldown") ||
    requestTarget.includes("/passkeys/exists")
  ) {
    return true;
  }

  // One-time bootstrap endpoint in strict mode.
  if (strictMode && requestTarget.includes("/bootstrap")) {
    return true;
  }

  // Password reset via one-time recovery token.
  if (requestTarget.includes("/reset-password") && (hasRecoveryTokenHeader || hasRecoveryTokenBody)) {
    return true;
  }

  // Allow logout endpoint (can be called without auth)
  if (requestTarget.includes("/logout")) {
    return true;
  }

  return false;
};

const isWriteMethod = (method: string | undefined): boolean =>
  method === "POST" ||
  method === "PUT" ||
  method === "PATCH" ||
  method === "DELETE";

const recordSettingsAuthzDenied = (
  req: Request,
  statusCode: number,
  reason: string
): void => {
  recordSecurityAuditEvent({
    eventType: "authz.denied",
    req,
    result: "denied",
    target: req.originalUrl || req.path,
    summary: reason,
    metadata: {
      statusCode,
      method: req.method,
      scope: "settings",
    },
    level: "warn",
  });
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
    });
    recordSettingsAuthzDenied(req, 403, "api key denied on settings endpoint");
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
      // Define allowlist for visitor GET requests
      // This strict allowlist prevents access to sensitive endpoints like /export-database
      const visitorAllowedGetPaths = [
        "/", // General settings
        "/cloudflared/status",
        "/password-enabled",
        "/reset-password-cooldown",
        "/passkeys",
        "/passkeys/exists",
        "/check-cookies",
        "/hooks/status",
        "/last-backup-info",
      ];

      // Check if the requested path is in the allowlist
      // We check both exact match and if the path starts with allowed prefixes
      // This handles potential sub-paths (though most here do not have them)
      const isAllowed = visitorAllowedGetPaths.some(
        (allowedPath) =>
          req.path === allowedPath ||
          req.url === allowedPath ||
          req.path.startsWith(`${allowedPath}/`) ||
          req.url.startsWith(`${allowedPath}/`)
      );

      if (isAllowed) {
        next();
        return;
      }

      // If not in allowlist, block the request
      // This specifically blocks /export-database and any other sensitive GET endpoints
      res.status(403).json({
        success: false,
        error: "Visitor role: Access to this resource is restricted.",
      });
      recordSettingsAuthzDenied(req, 403, "visitor denied restricted settings GET");
      return;
    }

    // For write requests, allow only auth endpoints and CloudFlare settings updates.
    if (req.method === "POST" || req.method === "PATCH") {
      // Allow verify-password requests (including verify-admin-password and verify-visitor-password)
      if (
        req.path.includes("/verify-password") ||
        req.url.includes("/verify-password") ||
        req.path.includes("/verify-admin-password") ||
        req.url.includes("/verify-admin-password") ||
        req.path.includes("/verify-visitor-password") ||
        req.url.includes("/verify-visitor-password")
      ) {
        next();
        return;
      }

      // Allow passkey authentication
      if (
        req.path.includes("/passkeys/authenticate") ||
        req.url.includes("/passkeys/authenticate")
      ) {
        next();
        return;
      }

      // Allow logout endpoint
      if (
        req.path.includes("/logout") ||
        req.url.includes("/logout")
      ) {
        next();
        return;
      }

      const body = req.body || {};

      // Allow CloudFlare tunnel settings updates (read-only access mechanism)
      const isOnlyCloudflareUpdate =
        (body.cloudflaredTunnelEnabled !== undefined ||
          body.cloudflaredToken !== undefined) &&
        Object.keys(body).every(
          (key) =>
            key === "cloudflaredTunnelEnabled" ||
            key === "cloudflaredToken"
        );

      if (isOnlyCloudflareUpdate) {
        // Allow CloudFlare settings updates
        next();
        return;
      }

      // Block all other settings updates
      res.status(403).json({
        success: false,
        error:
          "Visitor role: Only reading settings and updating CloudFlare settings is allowed.",
      });
      recordSettingsAuthzDenied(req, 403, "visitor denied settings write");
      return;
    }

    // Block all other write operations (PUT, DELETE, etc.)
    res.status(403).json({
      success: false,
      error: "Visitor role: Write operations are not allowed.",
    });
    recordSettingsAuthzDenied(req, 403, "visitor denied non-GET settings method");
    return;
  }

  // For unauthenticated users, check if login is required
  if (!req.user) {
    const strictMode = isStrictSecurityModel();
    const loginRequired = isLoginRequired();

    if (isPublicEndpoint(req, strictMode)) {
      next();
      return;
    }

    // Legacy compatibility: when login is disabled, keep historical anonymous
    // settings access so upgraded instances can complete migration in-place.
    if (!strictMode && !loginRequired) {
      next();
      return;
    }

    if (isWriteMethod(req.method)) {
      res.status(401).json({
        success: false,
        error: "Authentication required. Please log in to perform write operations.",
      });
      recordSettingsAuthzDenied(
        req,
        401,
        strictMode
          ? "strict mode unauthenticated settings write denied"
          : "unauthenticated settings write denied in legacy mode"
      );
      return;
    }

    // If login is required and this is not a public endpoint, reject the request
    if (loginRequired) {
      res.status(401).json({
        success: false,
        error: "Authentication required. Please log in to access this resource.",
      });
      recordSettingsAuthzDenied(req, 401, "login-required unauthenticated settings access denied");
      return;
    }

    // If login is not required, or this is a public endpoint, allow the request
    next();
    return;
  }

  // Fallback: allow the request (should not reach here)
  next();
};
