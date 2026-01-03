import bcrypt from "bcryptjs";
import crypto from "crypto";
import * as loginAttemptService from "./loginAttemptService";
import * as storageService from "./storageService";
import { logger } from "../utils/logger";
import { Settings, defaultSettings } from "../types/settings";

/**
 * Check if login is required (loginEnabled is true)
 */
export function isLoginRequired(): boolean {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };
  return mergedSettings.loginEnabled === true;
}

/**
 * Check if password authentication is enabled
 */
export function isPasswordEnabled(): {
  enabled: boolean;
  waitTime?: number;
  loginRequired?: boolean;
} {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  // Check if password login is allowed (defaults to true for backward compatibility)
  const passwordLoginAllowed = mergedSettings.passwordLoginAllowed !== false;

  // Return true only if login is enabled AND a password is set AND password login is allowed
  const isEnabled = mergedSettings.loginEnabled && !!mergedSettings.password && passwordLoginAllowed;

  // Check for remaining wait time
  const remainingWaitTime = loginAttemptService.canAttemptLogin();

  return {
    enabled: isEnabled,
    waitTime: remainingWaitTime > 0 ? remainingWaitTime : undefined,
    loginRequired: mergedSettings.loginEnabled === true,
  };
}

/**
 * Verify password for authentication
 */
export async function verifyPassword(
  password: string
): Promise<{
  success: boolean;
  waitTime?: number;
  failedAttempts?: number;
  message?: string;
}> {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  // Check if password login is allowed (defaults to true for backward compatibility)
  const passwordLoginAllowed = mergedSettings.passwordLoginAllowed !== false;

  if (!passwordLoginAllowed) {
    return {
      success: false,
      message: "Password login is not allowed. Please use passkey authentication.",
    };
  }

  if (!mergedSettings.password) {
    // If no password set but login enabled, allow access
    return { success: true };
  }

  // Check if user can attempt login (wait time check)
  const remainingWaitTime = loginAttemptService.canAttemptLogin();
  if (remainingWaitTime > 0) {
    // User must wait before trying again
    return {
      success: false,
      waitTime: remainingWaitTime,
      message: "Too many failed attempts. Please wait before trying again.",
    };
  }

  const isMatch = await bcrypt.compare(password, mergedSettings.password);

  if (isMatch) {
    // Reset failed attempts on successful login
    loginAttemptService.resetFailedAttempts();
    return { success: true };
  } else {
    // Record failed attempt and get wait time
    const waitTime = loginAttemptService.recordFailedAttempt();
    const failedAttempts = loginAttemptService.getFailedAttempts();

    return {
      success: false,
      waitTime,
      failedAttempts,
      message: "Incorrect password",
    };
  }
}

/**
 * Hash a password
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

/**
 * Reset password to a random 8-character string
 * Returns the new password (should be logged, not sent to frontend)
 */
export async function resetPassword(): Promise<string> {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  // Check if password reset is allowed (defaults to true for backward compatibility)
  const allowResetPassword = mergedSettings.allowResetPassword !== false;

  if (!allowResetPassword) {
    throw new Error("Password reset is not allowed. The allowResetPassword setting is disabled.");
  }

  // Check if password login is allowed (defaults to true for backward compatibility)
  const passwordLoginAllowed = mergedSettings.passwordLoginAllowed !== false;

  if (!passwordLoginAllowed) {
    throw new Error("Password reset is not allowed when password login is disabled");
  }

  // Generate random 8-character password using cryptographically secure random
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomBytes = crypto.randomBytes(8);
  const newPassword = Array.from(randomBytes, (byte) =>
    chars.charAt(byte % chars.length)
  ).join("");

  // Hash the new password
  const hashedPassword = await hashPassword(newPassword);

  // Update settings with new password
  mergedSettings.password = hashedPassword;
  mergedSettings.loginEnabled = true; // Ensure login is enabled

  storageService.saveSettings(mergedSettings);

  // Log the new password (as requested)
  logger.info(`Password has been reset. New password: ${newPassword}`);

  // Reset failed login attempts
  loginAttemptService.resetFailedAttempts();

  return newPassword;
}


