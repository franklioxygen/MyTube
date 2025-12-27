/**
 * Standardized API response utilities
 * Provides consistent response formats across all controllers
 */

import { Response } from "express";

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Create a successful API response
 * @param data - The data to return
 * @param message - Optional success message
 * @returns Standardized success response
 */
export function successResponse<T>(data: T, message?: string): ApiResponse<T> {
  return {
    success: true,
    data,
    ...(message && { message }),
  };
}

/**
 * Create an error API response
 * @param error - Error message
 * @returns Standardized error response
 */
export function errorResponse(error: string): ApiResponse<never> {
  return {
    success: false,
    error,
  };
}

/**
 * Create a success response with a message (no data)
 * @param message - Success message
 * @returns Standardized success response
 */
export function successMessage(message: string): ApiResponse<null> {
  return {
    success: true,
    message,
  };
}

/**
 * Send a successful response (200 OK)
 * @param res - Express response object
 * @param data - The data to return
 * @param message - Optional success message
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message?: string
): void {
  res.status(200).json(successResponse(data, message));
}

/**
 * Send a successful response with just a message (200 OK)
 * @param res - Express response object
 * @param message - Success message
 */
export function sendSuccessMessage(res: Response, message: string): void {
  res.status(200).json(successMessage(message));
}

/**
 * Send data directly (for backward compatibility - returns data directly, not wrapped)
 * @param res - Express response object
 * @param data - The data to return directly
 */
export function sendData<T>(res: Response, data: T): void {
  res.status(200).json(data);
}

/**
 * Send an error response (400 Bad Request)
 * @param res - Express response object
 * @param error - Error message
 */
export function sendBadRequest(res: Response, error: string): void {
  res.status(400).json(errorResponse(error));
}

/**
 * Send a not found response (404 Not Found)
 * @param res - Express response object
 * @param error - Error message (default: "Resource not found")
 */
export function sendNotFound(res: Response, error: string = "Resource not found"): void {
  res.status(404).json(errorResponse(error));
}

/**
 * Send a conflict response (409 Conflict)
 * @param res - Express response object
 * @param error - Error message
 */
export function sendConflict(res: Response, error: string): void {
  res.status(409).json(errorResponse(error));
}

/**
 * Send an internal server error response (500 Internal Server Error)
 * @param res - Express response object
 * @param error - Error message (default: "Internal server error")
 */
export function sendInternalError(
  res: Response,
  error: string = "Internal server error"
): void {
  res.status(500).json(errorResponse(error));
}

/**
 * Send a custom status code response
 * @param res - Express response object
 * @param statusCode - HTTP status code
 * @param data - The data to return
 */
export function sendStatus<T>(
  res: Response,
  statusCode: number,
  data: T
): void {
  res.status(statusCode).json(data);
}
