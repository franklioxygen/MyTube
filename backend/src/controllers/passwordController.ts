import { Request, Response } from "express";
import { clearAuthCookie, setAuthCookie } from "../services/authService";
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

  if (result.success && result.token && result.role) {
    // Set HTTP-only cookie with authentication token
    setAuthCookie(res, result.token, result.role);
    // Return format expected by frontend: { success: boolean, role? }
    // Token is now in HTTP-only cookie, not in response body
    res.json({ 
      success: true,
      role: result.role
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

  if (result.success && result.token && result.role) {
    // Set HTTP-only cookie with authentication token
    setAuthCookie(res, result.token, result.role);
    // Return format expected by frontend: { success: boolean, role? }
    // Token is now in HTTP-only cookie, not in response body
    res.json({ 
      success: true,
      role: result.role
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

  if (result.success && result.token && result.role) {
    // Set HTTP-only cookie with authentication token
    setAuthCookie(res, result.token, result.role);
    // Return format expected by frontend: { success: boolean, role? }
    // Token is now in HTTP-only cookie, not in response body
    res.json({ 
      success: true,
      role: result.role
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

/**
 * Logout endpoint - clears authentication cookies
 * Errors are automatically handled by asyncHandler middleware
 */
export const logout = async (
  _req: Request,
  res: Response
): Promise<void> => {
  clearAuthCookie(res);
  res.json({ success: true, message: "Logged out successfully" });
};
