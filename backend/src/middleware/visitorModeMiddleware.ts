import { NextFunction, Request, Response } from "express";
import * as storageService from "../services/storageService";

/**
 * Middleware to block write operations when visitor mode is enabled
 * Only allows disabling visitor mode (POST /settings with visitorMode: false)
 */
export const visitorModeMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const settings = storageService.getSettings();
  const visitorMode = settings.visitorMode === true;

  if (!visitorMode) {
    // Visitor mode is not enabled, allow all requests
    next();
    return;
  }

  // If user is Admin, allow all requests
  if (req.user?.role === "admin") {
    next();
    return;
  }

  // Visitor mode is enabled
  // Allow GET requests (read-only)
  if (req.method === "GET") {
    next();
    return;
  }

  // Check if the request is trying to disable visitor mode or verify password
  if (req.method === "POST") {
    const body = req.body || {};
    
    // Allow verify-password requests
    // Check path for verify-password (assuming mounted on /api or similar)
    if (req.path.includes("/verify-password") || req.url.includes("/verify-password")) {
      next();
      return;
    }

    // Allow passkey authentication
    if (req.path.includes("/settings/passkeys/authenticate") || req.url.includes("/settings/passkeys/authenticate")) {
      next();
      return;
    }

    // Check if the request is trying to disable visitor mode
    if (body.visitorMode === false) {
      // Allow disabling visitor mode
      next();
      return;
    }
    // Block all other settings updates
    res.status(403).json({
      success: false,
      error: "Visitor mode is enabled. Only disabling visitor mode is allowed.",
    });
    return;
  }

  // Block all other write operations (PUT, DELETE, PATCH)
  res.status(403).json({
    success: false,
    error: "Visitor mode is enabled. Write operations are not allowed.",
  });
};

