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

const isApiKeyDownloadEndpoint = (req: Request): boolean => {
  const path = req.path || req.url || "";
  return (
    req.method === "POST" &&
    (path === "/download" || path.startsWith("/download?"))
  );
};

const recordAuthzDenied = (
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
    },
    level: "warn",
  });
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
    recordAuthzDenied(
      req,
      403,
      "api key attempted non-download endpoint"
    );
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
        req.path.includes("/settings/passkeys/authenticate") ||
        req.url.includes("/settings/passkeys/authenticate")
      ) {
        next();
        return;
      }

      // Allow logout endpoint
      if (req.path.includes("/logout") || req.url.includes("/logout")) {
        next();
        return;
      }
    }

    // Block all other write operations (POST, PUT, DELETE, PATCH)
    res.status(403).json({
      success: false,
      error: "Visitor role: Write operations are not allowed. Read-only access only.",
    });
    recordAuthzDenied(req, 403, "visitor write access denied");
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
    // read/write behavior during the temporary migration window.
    if (!strictMode && !loginRequired) {
      next();
      return;
    }

    if (isWriteMethod(req.method)) {
      res.status(401).json({
        success: false,
        error: "Authentication required. Please log in to perform write operations.",
      });
      recordAuthzDenied(
        req,
        401,
        strictMode
          ? "strict mode unauthenticated write denied"
          : "unauthenticated write denied in legacy mode"
      );
      return;
    }

    // If login is required and this is not a public endpoint, reject the request
    if (loginRequired) {
      res.status(401).json({
        success: false,
        error: "Authentication required. Please log in to access this resource.",
      });
      recordAuthzDenied(req, 401, "login-required unauthenticated access denied");
      return;
    }

    // If login is not required, or this is a public endpoint, allow the request
    next();
    return;
  }

  // Fallback: allow the request (should not reach here)
  next();
};
