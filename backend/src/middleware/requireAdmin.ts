import { NextFunction, Request, Response } from "express";
import { isLoginRequired } from "../services/passwordService";
import { hasApiKeyCredential } from "../utils/apiKeyAuth";

/**
 * The instance owner in a browser session (an admin, or anyone while login is
 * disabled). API keys never count: they must not reach owner-only data.
 */
export function isOwnerSession(req: Request): boolean {
  if (req.apiKeyAuthenticated === true || hasApiKeyCredential(req)) return false;
  return !isLoginRequired() || req.user?.role === "admin";
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.apiKeyAuthenticated === true || hasApiKeyCredential(req)) {
    res.status(403).json({
      success: false,
      error: "API key authentication cannot access admin management endpoints.",
    });
    return;
  }

  if (!isLoginRequired() || req.user?.role === "admin") {
    next();
    return;
  }

  res.status(req.user ? 403 : 401).json({
    success: false,
    error: "Admin access is required.",
  });
}
