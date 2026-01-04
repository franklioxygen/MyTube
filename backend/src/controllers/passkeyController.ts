import { Request, Response } from "express";
import { setAuthCookie } from "../services/authService";
import * as passkeyService from "../services/passkeyService";

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

/**
 * Generate registration options for creating a new passkey
 * Errors are automatically handled by asyncHandler middleware
 */
export const generateRegistrationOptions = async (
  req: Request,
  res: Response
): Promise<void> => {
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
    setAuthCookie(res, result.token, result.role);
    // Return format expected by frontend: { success: boolean, role? }
    // Token is now in HTTP-only cookie, not in response body
    res.json({ success: true, role: result.role });
  } else {
    res.status(401).json({ success: false, error: "Authentication failed" });
  }
};

/**
 * Remove all passkeys
 * Errors are automatically handled by asyncHandler middleware
 */
export const removeAllPasskeys = async (
  _req: Request,
  res: Response
): Promise<void> => {
  passkeyService.removeAllPasskeys();
  res.json({ success: true });
};
