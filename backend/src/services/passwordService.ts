import bcrypt from "bcryptjs";
import crypto from "crypto";
import { defaultSettings } from "../types/settings";
import { logger } from "../utils/logger";
import * as loginAttemptService from "./loginAttemptService";
import * as storageService from "./storageService";

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
 * @deprecated Use verifyAdminPassword or verifyVisitorPassword instead for better security
 */
import { generateToken } from "./authService";

export async function verifyPassword(
  password: string
): Promise<{
  success: boolean;
  role?: "admin" | "visitor";
  token?: string;
  waitTime?: number;
  failedAttempts?: number;
  message?: string;
}> {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  // Check if password login is allowed (defaults to true for backward compatibility)
  const passwordLoginAllowed = mergedSettings.passwordLoginAllowed !== false;

  // If password login is explicitly disabled, ONLY allow Admin to login via password (if they have one set)?
  // Or just block everyone? The frontend says "When disabled, password login is not available."
  // But typically Admin should always be able to login?
  // For now, let's respect the flag, but maybe we should allow it if we are matching the Admin password?
  // Let's stick to current logic: if blocked, blocked.
  if (!passwordLoginAllowed) {
    return {
      success: false,
      message: "Password login is not allowed. Please use passkey authentication.",
    };
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

  // 1. Check Admin Password
  if (mergedSettings.password) {
    const isAdminMatch = await bcrypt.compare(password, mergedSettings.password);
    if (isAdminMatch) {
      loginAttemptService.resetFailedAttempts();
      const token = generateToken({ role: "admin" });
      return { success: true, role: "admin", token };
    }
  } else {
    // If no admin password set, and login enabled, allow as admin
    if (mergedSettings.loginEnabled) {
       loginAttemptService.resetFailedAttempts();
       const token = generateToken({ role: "admin" });
       return { success: true, role: "admin", token };
    }
  }

  // 2. Check Visitor Password (if visitorPassword is set)
  // Permission control is now based on user role
  // If password matches visitorPassword, assign visitor role
  if (mergedSettings.visitorPassword) {
      const isVisitorMatch = await bcrypt.compare(password, mergedSettings.visitorPassword);
      if (isVisitorMatch) {
          loginAttemptService.resetFailedAttempts();
          const token = generateToken({ role: "visitor" });
          return { success: true, role: "visitor", token };
      }
  }

  // No match
  const waitTime = loginAttemptService.recordFailedAttempt();
  const failedAttempts = loginAttemptService.getFailedAttempts();

  return {
    success: false,
    waitTime,
    failedAttempts,
    message: "Incorrect password",
  };
}

/**
 * Verify admin password for authentication
 * Only checks admin password, not visitor password
 */
export async function verifyAdminPassword(
  password: string
): Promise<{
  success: boolean;
  role?: "admin";
  token?: string;
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

  // Check if user can attempt login (wait time check)
  const remainingWaitTime = loginAttemptService.canAttemptLogin();
  if (remainingWaitTime > 0) {
    return {
      success: false,
      waitTime: remainingWaitTime,
      message: "Too many failed attempts. Please wait before trying again.",
    };
  }

  // Check Admin Password only
  if (mergedSettings.password) {
    const isAdminMatch = await bcrypt.compare(password, mergedSettings.password);
    if (isAdminMatch) {
      loginAttemptService.resetFailedAttempts();
      const token = generateToken({ role: "admin" });
      return { success: true, role: "admin", token };
    }
  } else {
    // If no admin password set, and login enabled, allow as admin
    if (mergedSettings.loginEnabled) {
       loginAttemptService.resetFailedAttempts();
       const token = generateToken({ role: "admin" });
       return { success: true, role: "admin", token };
    }
  }

  // No match - record failed attempt
  const waitTime = loginAttemptService.recordFailedAttempt();
  const failedAttempts = loginAttemptService.getFailedAttempts();

  return {
    success: false,
    waitTime,
    failedAttempts,
    message: "Incorrect admin password",
  };
}

/**
 * Verify visitor password for authentication
 * Only checks visitor password, not admin password
 */
export async function verifyVisitorPassword(
  password: string
): Promise<{
  success: boolean;
  role?: "visitor";
  token?: string;
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

  // Check if user can attempt login (wait time check)
  const remainingWaitTime = loginAttemptService.canAttemptLogin();
  if (remainingWaitTime > 0) {
    return {
      success: false,
      waitTime: remainingWaitTime,
      message: "Too many failed attempts. Please wait before trying again.",
    };
  }

  // Check Visitor Password only
  if (mergedSettings.visitorPassword) {
    const isVisitorMatch = await bcrypt.compare(password, mergedSettings.visitorPassword);
    if (isVisitorMatch) {
      loginAttemptService.resetFailedAttempts();
      const token = generateToken({ role: "visitor" });
      return { success: true, role: "visitor", token };
    }
  } else {
    // No visitor password set
    return {
      success: false,
      message: "Visitor password is not configured.",
    };
  }

  // No match - record failed attempt
  const waitTime = loginAttemptService.recordFailedAttempt();
  const failedAttempts = loginAttemptService.getFailedAttempts();

  return {
    success: false,
    waitTime,
    failedAttempts,
    message: "Incorrect visitor password",
  };
}

/**
 * Hash a password
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

const RESET_PASSWORD_COOLDOWN = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Get the remaining cooldown time for password reset
 * Returns the remaining time in milliseconds, or 0 if no cooldown
 */
export function getResetPasswordCooldown(): number {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  const lastResetTime = (mergedSettings as any).lastPasswordResetTime as number | undefined;
  
  if (!lastResetTime) {
    return 0;
  }

  const timeSinceLastReset = Date.now() - lastResetTime;
  const remainingCooldown = RESET_PASSWORD_COOLDOWN - timeSinceLastReset;

  return remainingCooldown > 0 ? remainingCooldown : 0;
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

  // Check cooldown period (1 hour)
  const remainingCooldown = getResetPasswordCooldown();
  if (remainingCooldown > 0) {
    const minutes = Math.ceil(remainingCooldown / (60 * 1000));
    throw new Error(`Password reset is on cooldown. Please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before trying again.`);
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

  // Update settings with new password and reset timestamp
  mergedSettings.password = hashedPassword;
  mergedSettings.loginEnabled = true; // Ensure login is enabled
  (mergedSettings as any).lastPasswordResetTime = Date.now();

  storageService.saveSettings(mergedSettings);

  // Log the new password (as requested)
  logger.info(`Password has been reset. New password: ${newPassword}`);

  // Reset failed login attempts
  loginAttemptService.resetFailedAttempts();

  return newPassword;
}


