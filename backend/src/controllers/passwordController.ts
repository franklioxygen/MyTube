import { Request, Response } from "express";
import * as passwordService from "../services/passwordService";
import { successMessage } from "../utils/response";

/**
 * Check if password authentication is enabled
 * Errors are automatically handled by asyncHandler middleware
 */
export const getPasswordEnabled = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const result = passwordService.isPasswordEnabled();
  // Return format expected by frontend: { enabled: boolean, waitTime?: number }
  res.json(result);
};

/**
 * Verify password for authentication
 * Errors are automatically handled by asyncHandler middleware
 */
export const verifyPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { password } = req.body;

  const result = await passwordService.verifyPassword(password);

  if (result.success) {
    // Return format expected by frontend: { success: boolean }
    res.json({ success: true });
  } else {
    // Return wait time information
    res.status(result.waitTime ? 429 : 401).json({
      success: false,
      waitTime: result.waitTime,
      failedAttempts: result.failedAttempts,
      message: result.message,
    });
  }
};

/**
 * Reset password to a random 8-character string
 * Errors are automatically handled by asyncHandler middleware
 */
export const resetPassword = async (
  _req: Request,
  res: Response
): Promise<void> => {
  await passwordService.resetPassword();

  // Return success (but don't send password to frontend for security)
  res.json({
    success: true,
    message:
      "Password has been reset. Check backend logs for the new password.",
  });
};

