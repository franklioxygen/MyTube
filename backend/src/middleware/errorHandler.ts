import { NextFunction, Request, Response } from "express";
import { DownloadError, ServiceError } from "../errors/DownloadErrors";
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
