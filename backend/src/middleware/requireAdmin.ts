import { NextFunction, Request, Response } from "express";
import { isLoginRequired } from "../services/passwordService";

const hasApiKeyCredential = (req: Request): boolean =>
  Boolean(req.headers?.["x-api-key"]) ||
  req.headers?.authorization?.startsWith("ApiKey ") === true;

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.apiKeyAuthenticated === true || hasApiKeyCredential(req)) {
    res.status(403).json({
      success: false,
      error: "API key authentication cannot manage RSS tokens.",
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
