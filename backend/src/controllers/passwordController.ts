import { Request, Response } from "express";
import { clearAuthCookie, setAuthCookie } from "../services/authService";
import * as passwordService from "../services/passwordService";

type FailedAuthResult = {
  message?: string;
};

const sendAuthFailure = (
  res: Response,
  result: FailedAuthResult,
  statusCode = 401
): void => {
  res.status(statusCode).json({
    success: false,
    message: result.message,
  });
};

/**
 * Check if password authentication is enabled
 * Errors are automatically handled by asyncHandler middleware
 */
export const getPasswordEnabled = async (
  req: Request,
  res: Response
): Promise<void> => {
  const result = passwordService.isPasswordEnabled();
  // Return format expected by frontend: password-login capability and context.
  res.json({
    ...result,
    authenticatedRole: req.user?.role ?? null,
  });
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
    sendAuthFailure(res, result);
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
    sendAuthFailure(res, result);
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
    sendAuthFailure(res, result);
  }
};

/**
 * Re-authenticate an already-authenticated admin for sensitive settings actions.
 * Errors are automatically handled by asyncHandler middleware.
 */
export const confirmAdminPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { password } = req.body;

  const result = await passwordService.confirmAdminPassword(password);

  if (result.success) {
    res.json({ success: true });
    return;
  }

  sendAuthFailure(res, result);
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
