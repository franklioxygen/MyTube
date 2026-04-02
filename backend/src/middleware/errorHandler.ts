import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { DownloadError, ServiceError } from "../errors/DownloadErrors";
import { isCsrfTokenError } from "./csrfMiddleware";
import { logger } from "../utils/logger";

/**
 * Global error handling middleware
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Handle Multer errors (file size exceeded, unexpected field, etc.)
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? req.path.includes("/subtitles")
          ? "File too large. Maximum size is 10 MB."
          : "File too large. Maximum size is 100 GB per file."
        : err.message;
    res.status(status).json({ error: message, type: "validation" });
    return;
  }

  // Handle DownloadErrors (expected errors during download/processing)
  if (err instanceof DownloadError) {
    logger.warn(`[DownloadError] ${err.type}: ${err.message}`);

    res.status(400).json({
      error: err.message,
      type: err.type,
      recoverable: err.recoverable,
    });
    return;
  }

  // Handle ServiceErrors (business logic errors)
  if (err instanceof ServiceError) {
    logger.warn(`[ServiceError] ${err.type}: ${err.message}`);

    // Determine status code based on error type
    let statusCode = 400;
    if (err.type === "not_found") statusCode = 404;
    else if (err.type === "duplicate") statusCode = 409; // Conflict
    else if (err.type === "execution") statusCode = 500;
    else if (err.type === "database") statusCode = 500;
    else if (err.type === "migration") statusCode = 500;

    res.status(statusCode).json({
      error: err.message,
      type: err.type,
      recoverable: err.recoverable,
    });
    return;
  }

  if (isCsrfTokenError(err)) {
    logger.warn(`[CSRF] ${err.message}`);
    res.status(403).json({
      error: err.message || "invalid csrf token",
      type: "csrf",
    });
    return;
  }

  // Handle unknowns
  logger.error("Unhandled error", err);

  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
}

/**
 * Wrapper for async route handlers to catch errors
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
