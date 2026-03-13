import { Request, Response } from "express";
import {
  clearAuthCookie,
  getAuthCookieName,
  revokeAllAuthSessionsForRole,
  revokeAuthSession,
  setAuthCookie,
} from "../services/authService";
import { recordSecurityAuditEvent } from "../services/securityAuditService";
import { getClientIp as getTrustedClientIp } from "../utils/security";
import * as passwordService from "../services/passwordService";

const getRequestClientIp = (req: Request): string => {
  const trustedIp = getTrustedClientIp(req);
  if (trustedIp !== "unknown") {
    return trustedIp;
  }
  return typeof req.ip === "string" && req.ip.trim().length > 0
    ? req.ip.trim()
    : "unknown";
};

const readRecoveryToken = (req: Request): string => {
  const headerToken = req.headers?.["x-mytube-recovery-token"];
  const tokenFromHeader =
    typeof headerToken === "string"
      ? headerToken
      : Array.isArray(headerToken)
        ? headerToken[0]
        : "";
  if (tokenFromHeader.trim().length > 0) {
    return tokenFromHeader.trim();
  }

  const bodyToken =
    typeof req.body?.recoveryToken === "string" ? req.body.recoveryToken : "";
  if (bodyToken.trim().length > 0) {
    return bodyToken.trim();
  }

  return "";
};

const hasDeprecatedQueryRecoveryToken = (req: Request): boolean => {
  const queryTokenRaw = (req.query as Record<string, unknown> | undefined)
    ?.recoveryToken;
  if (typeof queryTokenRaw === "string") {
    return queryTokenRaw.trim().length > 0;
  }
  return (
    Array.isArray(queryTokenRaw) &&
    typeof queryTokenRaw[0] === "string" &&
    queryTokenRaw[0].trim().length > 0
  );
};

const getClientUserAgent = (req: Request): string => {
  const userAgent = req.headers?.["user-agent"];
  if (typeof userAgent === "string" && userAgent.trim().length > 0) {
    return userAgent.trim();
  }
  if (Array.isArray(userAgent) && typeof userAgent[0] === "string") {
    return userAgent[0].trim();
  }
  return "unknown";
};

const getRecoverySourceKey = (req: Request): string =>
  `${getRequestClientIp(req)}|${getClientUserAgent(req)}`;

const getCurrentSessionId = (req: Request): string | undefined => {
  const cookieName = getAuthCookieName();
  const cookieValue = req.cookies?.[cookieName];
  if (typeof cookieValue !== "string") {
    return undefined;
  }
  const normalized = cookieValue.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const recordLoginFailure = (
  req: Request,
  message: string,
  metadata: Record<string, unknown> = {}
): void => {
  recordSecurityAuditEvent({
    eventType: "auth.login.failed",
    req,
    result: "failure",
    target: req.originalUrl || req.path,
    summary: message || "login failed",
    metadata,
    level: "warn",
  });
};

/**
 * Check if password authentication is enabled
 * Errors are automatically handled by asyncHandler middleware
 */
export const getPasswordEnabled = async (
  req: Request,
  res: Response
): Promise<void> => {
  const result = passwordService.isPasswordEnabled();
  // Return format expected by frontend: { enabled: boolean, waitTime?: number }
  res.json({
    ...result,
    authenticatedRole: req.user?.role ?? null,
  });
};

/**
 * Verify password for authentication
 * @deprecated Use verifyAdminPassword or verifyVisitorPassword instead for better security
 * Errors are automatically handled by asyncHandler middleware
 */
export const verifyPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { password } = req.body;

  const result = await passwordService.verifyPassword(password);

  if (result.success && result.token && result.role) {
    // Set HTTP-only cookie with authentication token
    setAuthCookie(res, result.token, result.role, {
      authMethod: "password",
      ip: getRequestClientIp(req),
      userAgent: getClientUserAgent(req),
      previousSessionId: getCurrentSessionId(req),
    });
    // Return format expected by frontend: { success: boolean, role? }
    // Token is now in HTTP-only cookie, not in response body
    res.json({ 
      success: true,
      role: result.role
    });
  } else {
    // Return wait time information
    // Return 200 OK to suppress browser console errors, but include status code and success: false
    const statusCode = result.waitTime ? 429 : 401;
    recordLoginFailure(req, result.message || "verify-password failed", {
      statusCode,
      waitTimeMs: result.waitTime ?? null,
      failedAttempts: result.failedAttempts ?? null,
      endpoint: "verify-password",
    });
    res.json({
      success: false,
      waitTime: result.waitTime,
      failedAttempts: result.failedAttempts,
      message: result.message,
      statusCode
    });
  }
};

/**
 * Verify admin password for authentication
 * Only checks admin password, not visitor password
 * Errors are automatically handled by asyncHandler middleware
 */
export const verifyAdminPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { password } = req.body;

  const result = await passwordService.verifyAdminPassword(password);

  if (result.success && result.token && result.role) {
    // Set HTTP-only cookie with authentication token
    setAuthCookie(res, result.token, result.role, {
      authMethod: "password",
      ip: getRequestClientIp(req),
      userAgent: getClientUserAgent(req),
      previousSessionId: getCurrentSessionId(req),
    });
    // Return format expected by frontend: { success: boolean, role? }
    // Token is now in HTTP-only cookie, not in response body
    res.json({ 
      success: true,
      role: result.role
    });
  } else {
    const statusCode = result.waitTime ? 429 : 401;
    recordLoginFailure(req, result.message || "verify-admin-password failed", {
      statusCode,
      waitTimeMs: result.waitTime ?? null,
      failedAttempts: result.failedAttempts ?? null,
      endpoint: "verify-admin-password",
    });
    res.json({
      success: false,
      waitTime: result.waitTime,
      failedAttempts: result.failedAttempts,
      message: result.message,
      statusCode
    });
  }
};

/**
 * Verify visitor password for authentication
 * Only checks visitor password, not admin password
 * Errors are automatically handled by asyncHandler middleware
 */
export const verifyVisitorPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { password } = req.body;

  const result = await passwordService.verifyVisitorPassword(password);

  if (result.success && result.token && result.role) {
    // Set HTTP-only cookie with authentication token
    setAuthCookie(res, result.token, result.role, {
      authMethod: "password",
      ip: getRequestClientIp(req),
      userAgent: getClientUserAgent(req),
      previousSessionId: getCurrentSessionId(req),
    });
    // Return format expected by frontend: { success: boolean, role? }
    // Token is now in HTTP-only cookie, not in response body
    res.json({ 
      success: true,
      role: result.role
    });
  } else {
    const statusCode = result.waitTime ? 429 : 401;
    recordLoginFailure(req, result.message || "verify-visitor-password failed", {
      statusCode,
      waitTimeMs: result.waitTime ?? null,
      failedAttempts: result.failedAttempts ?? null,
      endpoint: "verify-visitor-password",
    });
    res.json({
      success: false,
      waitTime: result.waitTime,
      failedAttempts: result.failedAttempts,
      message: result.message,
      statusCode
    });
  }
};

/**
 * Get the remaining cooldown time for password reset
 * Errors are automatically handled by asyncHandler middleware
 */
export const getResetPasswordCooldown = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const remainingCooldown = passwordService.getResetPasswordCooldown();
  res.json({
    cooldown: remainingCooldown,
  });
};

/**
 * Bootstrap the first admin account in strict mode.
 * This endpoint is one-time only and becomes unavailable after completion.
 */
export const bootstrapAdmin = async (
  req: Request,
  res: Response
): Promise<void> => {
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  if (password.trim().length < 8) {
    res.status(400).json({
      success: false,
      error: "Password must be at least 8 characters.",
    });
    return;
  }

  const result = await passwordService.bootstrapAdminPassword(password);
  if (!result.success) {
    res.status(409).json({
      success: false,
      error: result.message,
      reason: result.reason,
    });
    return;
  }

  const adminLoginResult = await passwordService.verifyAdminPassword(password);
  if (
    adminLoginResult.success &&
    adminLoginResult.token &&
    adminLoginResult.role
  ) {
    setAuthCookie(res, adminLoginResult.token, adminLoginResult.role, {
      authMethod: "bootstrap",
      ip: getRequestClientIp(req),
      userAgent: getClientUserAgent(req),
      previousSessionId: getCurrentSessionId(req),
    });
  }

  res.status(201).json({
    success: true,
    message: "Bootstrap completed.",
  });
};

/**
 * Issue a one-time password recovery token.
 * Requires authenticated admin.
 */
export const createRecoveryToken = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (req.user?.role !== "admin") {
    recordSecurityAuditEvent({
      eventType: "auth.password.recovery_token.issue.denied",
      req,
      result: "denied",
      target: req.originalUrl || req.path,
      summary: "recovery token issuance denied: missing admin authentication",
      metadata: {
        endpoint: "reset-password/recovery-token",
      },
      level: "warn",
    });
    res.status(403).json({
      success: false,
      error: "Admin authentication is required to issue a recovery token.",
    });
    return;
  }

  const issued = passwordService.issuePasswordRecoveryToken();
  recordSecurityAuditEvent({
    eventType: "auth.password.recovery_token.issued",
    req,
    result: "success",
    target: req.originalUrl || req.path,
    summary: "one-time password recovery token issued",
    metadata: {
      expiresAt: issued.expiresAt,
      ttlMs: Math.max(0, issued.expiresAt - Date.now()),
      endpoint: "reset-password/recovery-token",
    },
  });
  res.status(201).json({
    success: true,
    token: issued.token,
    expiresAt: issued.expiresAt,
  });
};

/**
 * Reset password to a random 8-character string
 * Errors are automatically handled by asyncHandler middleware
 */
export const resetPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const isAdmin = req.user?.role === "admin";
  if (isAdmin) {
    await passwordService.resetPassword();
    recordSecurityAuditEvent({
      eventType: "auth.password.reset.admin",
      req,
      result: "success",
      target: req.originalUrl || req.path,
      summary: "admin password reset executed",
      metadata: {
        endpoint: "reset-password",
        method: "admin_authenticated",
      },
    });
    res.json({
      success: true,
      message:
        "Password has been reset. Check backend logs for the new password.",
    });
    return;
  }

  const recoveryToken = readRecoveryToken(req);
  if (!recoveryToken && hasDeprecatedQueryRecoveryToken(req)) {
    recordSecurityAuditEvent({
      eventType: "auth.password.recovery_token.query_rejected",
      req,
      result: "rejected",
      target: req.originalUrl || req.path,
      summary: "recovery token in query string rejected",
      metadata: {
        endpoint: "reset-password",
        acceptedLocations: ["x-mytube-recovery-token header", "recoveryToken body"],
      },
      level: "warn",
    });
    res.status(400).json({
      success: false,
      error:
        "Recovery token query parameter is not supported. Use the x-mytube-recovery-token header or recoveryToken request body.",
      reason: "QUERY_TOKEN_NOT_ALLOWED",
    });
    return;
  }
  const recoveryResult = await passwordService.resetPasswordWithRecoveryToken(
    recoveryToken,
    getRecoverySourceKey(req)
  );
  if (!recoveryResult.success) {
    const status = recoveryResult.reason === "RATE_LIMITED" ? 429 : 403;
    recordSecurityAuditEvent({
      eventType: "auth.password.recovery_token.reset.failed",
      req,
      result:
        recoveryResult.reason === "RATE_LIMITED" ? "denied" : "failure",
      target: req.originalUrl || req.path,
      summary: recoveryResult.message || "recovery token reset failed",
      metadata: {
        endpoint: "reset-password",
        reason: recoveryResult.reason,
        statusCode: status,
        retryAfterMs: recoveryResult.retryAfterMs ?? null,
      },
      level: "warn",
    });
    res.status(status).json({
      success: false,
      error: recoveryResult.message,
      reason: recoveryResult.reason,
      retryAfterMs: recoveryResult.retryAfterMs,
    });
    return;
  }

  recordSecurityAuditEvent({
    eventType: "auth.password.recovery_token.reset.success",
    req,
    result: "success",
    target: req.originalUrl || req.path,
    summary: "password reset completed using one-time recovery token",
    metadata: {
      endpoint: "reset-password",
      method: "recovery_token",
    },
  });

  // Return success (but don't send password to frontend for security)
  res.json({
    success: true,
    message:
      "Password has been reset. Check backend logs for the new password.",
  });
};

/**
 * Logout endpoint - clears authentication cookies
 * Errors are automatically handled by asyncHandler middleware
 */
export const logout = async (
  req: Request,
  res: Response
): Promise<void> => {
  const allDevices = req.body?.allDevices === true;
  const currentSessionId = getCurrentSessionId(req);

  if (allDevices) {
    if (!req.user?.role) {
      recordSecurityAuditEvent({
        eventType: "auth.session.revoke_all.denied",
        req,
        result: "denied",
        target: req.originalUrl || req.path,
        summary: "logout all devices denied without authenticated user",
        metadata: { reason: "missing_authenticated_user" },
        level: "warn",
      });
      res.status(401).json({
        success: false,
        error: "Authentication required to log out from all devices.",
      });
      return;
    }

    const revokedCount = revokeAllAuthSessionsForRole(
      req.user.role,
      "logout_all_devices"
    );
    clearAuthCookie(res);
    recordSecurityAuditEvent({
      eventType: "auth.session.revoke_all",
      req,
      result: "success",
      target: req.originalUrl || req.path,
      summary: `revoked ${revokedCount} session(s) for role ${req.user.role}`,
      metadata: {
        revokedSessions: revokedCount,
        role: req.user.role,
      },
    });
    res.json({
      success: true,
      message: "Logged out from all devices successfully",
      revokedSessions: revokedCount,
    });
    return;
  }

  if (currentSessionId) {
    const revoked = revokeAuthSession(currentSessionId, "logout");
    recordSecurityAuditEvent({
      eventType: "auth.session.revoke",
      req,
      result: revoked ? "success" : "failure",
      target: req.originalUrl || req.path,
      summary: revoked
        ? "current session revoked"
        : "current session revoke skipped (missing/expired)",
      metadata: {
        sessionIdPresent: true,
      },
    });
  } else {
    recordSecurityAuditEvent({
      eventType: "auth.session.revoke",
      req,
      result: "failure",
      target: req.originalUrl || req.path,
      summary: "logout without active session cookie",
      metadata: {
        sessionIdPresent: false,
      },
      level: "warn",
    });
  }

  clearAuthCookie(res);
  res.json({ success: true, message: "Logged out successfully" });
};
