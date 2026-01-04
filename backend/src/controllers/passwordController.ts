import { Request, Response } from "express";
import * as passwordService from "../services/passwordService";

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
 * @deprecated Use verifyAdminPassword or verifyVisitorPassword instead for better security
 * Errors are automatically handled by asyncHandler middleware
 */
export const verifyPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { password } = req.body;

  const result = await passwordService.verifyPassword(password);

  if (result.success) {
    // Return format expected by frontend: { success: boolean, role?, token? }
    res.json({ 
      success: true,
      role: result.role,
      token: result.token
    });
  } else {
    // Return wait time information
    // Return 200 OK to suppress browser console errors, but include status code and success: false
    const statusCode = result.waitTime ? 429 : 401;
    res.json({
      success: false,
      waitTime: result.waitTime,
      failedAttempts: result.failedAttempts,
      message: result.message,
      statusCode
    });
  }
};

/**
 * Verify admin password for authentication
 * Only checks admin password, not visitor password
 * Errors are automatically handled by asyncHandler middleware
 */
export const verifyAdminPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { password } = req.body;

  const result = await passwordService.verifyAdminPassword(password);

  if (result.success) {
    res.json({ 
      success: true,
      role: result.role,
      token: result.token
    });
  } else {
    const statusCode = result.waitTime ? 429 : 401;
    res.json({
      success: false,
      waitTime: result.waitTime,
      failedAttempts: result.failedAttempts,
      message: result.message,
      statusCode
    });
  }
};

/**
 * Verify visitor password for authentication
 * Only checks visitor password, not admin password
 * Errors are automatically handled by asyncHandler middleware
 */
export const verifyVisitorPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { password } = req.body;

  const result = await passwordService.verifyVisitorPassword(password);

  if (result.success) {
    res.json({ 
      success: true,
      role: result.role,
      token: result.token
    });
  } else {
    const statusCode = result.waitTime ? 429 : 401;
    res.json({
      success: false,
      waitTime: result.waitTime,
      failedAttempts: result.failedAttempts,
      message: result.message,
      statusCode
    });
  }
};

/**
 * Get the remaining cooldown time for password reset
 * Errors are automatically handled by asyncHandler middleware
 */
export const getResetPasswordCooldown = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const remainingCooldown = passwordService.getResetPasswordCooldown();
  res.json({
    cooldown: remainingCooldown,
  });
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
