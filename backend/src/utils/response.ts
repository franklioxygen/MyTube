/**
 * Standardized API response utilities
 * Provides consistent response formats across all controllers
 */

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
