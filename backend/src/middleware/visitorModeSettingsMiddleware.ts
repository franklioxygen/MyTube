import { NextFunction, Request, Response } from "express";
import * as storageService from "../services/storageService";

/**
 * Middleware specifically for settings routes
 * Allows disabling visitor mode even when visitor mode is enabled
 */
export const visitorModeSettingsMiddleware = (
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

  // Visitor mode is enabled
  // Allow GET requests (read-only)
  if (req.method === "GET") {
    next();
    return;
  }

  // For POST requests, check if it's trying to disable visitor mode or verify password
  if (req.method === "POST") {
    // Allow verify-password requests
    if (req.path.includes("/verify-password") || req.url.includes("/verify-password")) {
       next();
       return;
    }

    const body = req.body || {};
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
