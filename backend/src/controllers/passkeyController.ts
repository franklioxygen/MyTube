import { Request, Response } from "express";
import { getAuthCookieName, setAuthCookie } from "../services/authService";
import * as passkeyService from "../services/passkeyService";
import { recordSecurityAuditEvent } from "../services/securityAuditService";
import { getClientIp as getTrustedClientIp } from "../utils/security";

const getRequestClientIp = (req: Request): string => {
  const trustedIp = getTrustedClientIp(req);
  if (trustedIp !== "unknown") {
    return trustedIp;
  }
  return typeof req.ip === "string" && req.ip.trim().length > 0
    ? req.ip.trim()
    : "unknown";
};

/**
 * Get all passkeys
 * Errors are automatically handled by asyncHandler middleware
 */
export const getPasskeys = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const passkeys = passkeyService.getPasskeys();
  // Don't send sensitive credential data to frontend
  const safePasskeys = passkeys.map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
  }));
  res.json({ passkeys: safePasskeys });
};

/**
 * Check if passkeys exist
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkPasskeysExist = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const passkeys = passkeyService.getPasskeys();
  res.json({ exists: passkeys.length > 0 });
};

/**
 * Get origin and RP ID from request
 */
function getOriginAndRPID(req: Request): { origin: string; rpID: string } {
  // Get origin from headers
  let origin = req.headers.origin;
  if (!origin && req.headers.referer) {
    // Extract origin from referer
    try {
      const refererUrl = new URL(req.headers.referer);
      origin = refererUrl.origin;
    } catch (e) {
      origin = req.headers.referer;
    }
  }
  if (!origin) {
    const protocol =
      req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
    const host = req.headers.host || "localhost:5550";
    origin = `${protocol}://${host}`;
  }

  // Extract hostname for RP_ID
  let hostname = "localhost";
  try {
    const originUrl = new URL(origin as string);
    hostname = originUrl.hostname;
  } catch (e) {
    // Fallback: extract from host header
    hostname = req.headers.host?.split(":")[0] || "localhost";
  }

  // RP_ID should be the domain name (without port)
  // For localhost/127.0.0.1, use 'localhost', otherwise use the full hostname
  const rpID =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
      ? "localhost"
      : hostname;

  return { origin: origin as string, rpID };
}

function getClientUserAgent(req: Request): string {
  const userAgent = req.headers?.["user-agent"];
  if (typeof userAgent === "string" && userAgent.trim().length > 0) {
    return userAgent.trim();
  }
  if (Array.isArray(userAgent) && typeof userAgent[0] === "string") {
    return userAgent[0].trim();
  }
  return "unknown";
}

function getCurrentSessionId(req: Request): string | undefined {
  const cookieName = getAuthCookieName();
  const cookieValue = req.cookies?.[cookieName];
  if (typeof cookieValue !== "string") {
    return undefined;
  }
  const normalized = cookieValue.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function requireAdminPasskeyManagement(
  req: Request,
  res: Response,
  action: string
): boolean {
  if (req.user?.role === "admin") {
    return true;
  }

  recordSecurityAuditEvent({
    eventType: "authz.denied",
    req,
    result: "denied",
    target: req.originalUrl || req.path,
    summary: `passkey management denied: ${action}`,
    metadata: {
      endpoint: action,
      requiredRole: "admin",
    },
    level: "warn",
  });
  res.status(403).json({
    success: false,
    error: "Admin authentication is required for passkey management.",
  });
  return false;
}

/**
 * Generate registration options for creating a new passkey
 * Errors are automatically handled by asyncHandler middleware
 */
export const generateRegistrationOptions = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!requireAdminPasskeyManagement(req, res, "passkeys/register")) {
    return;
  }
  const userName = req.body.userName || "MyTube User";
  const { origin, rpID } = getOriginAndRPID(req);
  const result = await passkeyService.generatePasskeyRegistrationOptions(
    userName,
    origin,
    rpID
  );
  res.json(result);
};

/**
 * Verify and store a new passkey
 * Errors are automatically handled by asyncHandler middleware
 */
export const verifyRegistration = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!requireAdminPasskeyManagement(req, res, "passkeys/register/verify")) {
    return;
  }
  const { body, challenge } = req.body;
  if (!body || !challenge) {
    res.status(400).json({ error: "Missing body or challenge" });
    return;
  }

  const { origin, rpID } = getOriginAndRPID(req);
  const result = await passkeyService.verifyPasskeyRegistration(
    body,
    challenge,
    origin,
    rpID
  );

  if (result.verified) {
    res.json({ success: true, passkey: result.passkey });
  } else {
    res.status(400).json({ success: false, error: "Verification failed" });
  }
};

/**
 * Generate authentication options for passkey login
 * Errors are automatically handled by asyncHandler middleware
 */
export const generateAuthenticationOptions = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { rpID } = getOriginAndRPID(req);
    const result = await passkeyService.generatePasskeyAuthenticationOptions(
      rpID
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No passkeys available",
    });
  }
};

/**
 * Verify passkey authentication
 * Errors are automatically handled by asyncHandler middleware
 */
export const verifyAuthentication = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { body, challenge } = req.body;
  if (!body || !challenge) {
    res.status(400).json({ error: "Missing body or challenge" });
    return;
  }

  const { origin, rpID } = getOriginAndRPID(req);
  const result = await passkeyService.verifyPasskeyAuthentication(
    body,
    challenge,
    origin,
    rpID
  );

  if (result.verified && result.token && result.role) {
    // Set HTTP-only cookie with authentication token
    setAuthCookie(res, result.token, result.role, {
      authMethod: "passkey",
      ip: getRequestClientIp(req),
      userAgent: getClientUserAgent(req),
      previousSessionId: getCurrentSessionId(req),
    });
    // Return format expected by frontend: { success: boolean, role? }
    // Token is now in HTTP-only cookie, not in response body
    res.json({ success: true, role: result.role });
  } else {
    recordSecurityAuditEvent({
      eventType: "auth.login.failed",
      req,
      result: "failure",
      target: req.originalUrl || req.path,
      summary: "passkey authentication failed",
      metadata: {
        endpoint: "passkeys/authenticate/verify",
      },
      level: "warn",
    });
    res.status(401).json({ success: false, error: "Authentication failed" });
  }
};

/**
 * Remove all passkeys
 * Errors are automatically handled by asyncHandler middleware
 */
export const removeAllPasskeys = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!requireAdminPasskeyManagement(req, res, "passkeys/delete")) {
    return;
  }
  passkeyService.removeAllPasskeys();
  res.json({ success: true });
};
