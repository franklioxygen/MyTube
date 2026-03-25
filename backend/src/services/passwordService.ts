import bcrypt from "bcryptjs";
import { DEFAULT_ADMIN_PASSWORD, defaultSettings } from "../types/settings";
import { logger } from "../utils/logger";
import * as storageService from "./storageService";
import { generateToken } from "./authService";

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

type PasswordMatchResult =
  | "match"
  | "legacy_plaintext_match"
  | "default_admin_password_match"
  | "mismatch";

function compareDefaultAdminPassword(
  inputPassword: string,
  loginEnabled: boolean
): PasswordMatchResult {
  if (!loginEnabled || typeof inputPassword !== "string") {
    return "mismatch";
  }

  return inputPassword === DEFAULT_ADMIN_PASSWORD
    ? "default_admin_password_match"
    : "mismatch";
}

async function compareStoredPassword(
  inputPassword: string,
  storedPassword: unknown,
): Promise<PasswordMatchResult> {
  if (typeof inputPassword !== "string") {
    return "mismatch";
  }
  if (typeof storedPassword !== "string" || storedPassword.length === 0) {
    return "mismatch";
  }

  // Backward compatibility: support legacy plaintext passwords.
  if (!BCRYPT_HASH_PATTERN.test(storedPassword)) {
    return inputPassword === storedPassword
      ? "legacy_plaintext_match"
      : "mismatch";
  }

  try {
    const matched = await bcrypt.compare(inputPassword, storedPassword);
    return matched ? "match" : "mismatch";
  } catch (error) {
    logger.warn(
      "Password hash comparison failed. Falling back to legacy plaintext comparison.",
    );
    return inputPassword === storedPassword
      ? "legacy_plaintext_match"
      : "mismatch";
  }
}

function isHashPersistenceMatch(
  matchResult: PasswordMatchResult
): matchResult is "legacy_plaintext_match" | "default_admin_password_match" {
  return (
    matchResult === "legacy_plaintext_match" ||
    matchResult === "default_admin_password_match"
  );
}

function getHashPersistenceMessages(
  key: "password" | "visitorPassword",
  matchResult: "legacy_plaintext_match" | "default_admin_password_match"
): { success: string; failure: string } {
  if (matchResult === "default_admin_password_match") {
    return {
      success: `Accepted default admin password fallback. Persisted bcrypt hash for ${key}.`,
      failure: `Failed to persist bcrypt hash for default admin password fallback ${key}.`,
    };
  }

  return {
    success: `Detected legacy plaintext ${key}. Automatically migrated to bcrypt hash.`,
    failure: `Failed to migrate legacy plaintext ${key}.`,
  };
}

async function persistHashForCompatibleMatch(
  key: "password" | "visitorPassword",
  rawPassword: string,
  matchResult: PasswordMatchResult,
): Promise<void> {
  if (!isHashPersistenceMatch(matchResult)) {
    return;
  }

  const messages = getHashPersistenceMessages(key, matchResult);

  try {
    const hashedPassword = await hashPassword(rawPassword);
    storageService.saveSettings({ [key]: hashedPassword });
    logger.warn(messages.success);
  } catch (error) {
    logger.error(
      messages.failure,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

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
  loginRequired?: boolean;
  visitorUserEnabled?: boolean;
  isVisitorPasswordSet?: boolean;
  passwordLoginAllowed?: boolean;
  websiteName?: string;
} {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  // Check if password login is allowed (defaults to true for backward compatibility)
  const passwordLoginAllowed = mergedSettings.passwordLoginAllowed !== false;

  // Return true only if login is enabled AND a password is set AND password login is allowed
  const isEnabled = mergedSettings.loginEnabled && !!mergedSettings.password && passwordLoginAllowed;

  return {
    enabled: isEnabled,
    loginRequired: mergedSettings.loginEnabled === true,
    visitorUserEnabled: mergedSettings.visitorUserEnabled !== false,
    isVisitorPasswordSet: !!mergedSettings.visitorPassword,
    passwordLoginAllowed,
    websiteName: mergedSettings.websiteName,
  };
}

/**
 * Verify password for authentication
 * @deprecated Use verifyAdminPassword or verifyVisitorPassword instead for better security
 */

export async function verifyPassword(
  password: string
): Promise<{
  success: boolean;
  role?: "admin" | "visitor";
  token?: string;
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

  // 1. Check Admin Password
  if (mergedSettings.password) {
    const adminMatchResult = await compareStoredPassword(
      password,
      mergedSettings.password,
    );
    if (adminMatchResult !== "mismatch") {
      await persistHashForCompatibleMatch(
        "password",
        password,
        adminMatchResult,
      );
      const token = generateToken({ role: "admin" });
      return { success: true, role: "admin", token };
    }
  } else {
    const defaultAdminMatchResult = compareDefaultAdminPassword(
      password,
      mergedSettings.loginEnabled === true
    );
    if (defaultAdminMatchResult !== "mismatch") {
      await persistHashForCompatibleMatch(
        "password",
        DEFAULT_ADMIN_PASSWORD,
        defaultAdminMatchResult,
      );
      const token = generateToken({ role: "admin" });
      return { success: true, role: "admin", token };
    }
  }

  // 2. Check Visitor Password (if visitorPassword is set and visitor user is enabled)
  // Permission control is now based on user role
  // If password matches visitorPassword, assign visitor role
  const visitorUserEnabled = mergedSettings.visitorUserEnabled !== false;
  if (visitorUserEnabled && mergedSettings.visitorPassword) {
    const visitorMatchResult = await compareStoredPassword(
      password,
      mergedSettings.visitorPassword,
    );
    if (visitorMatchResult !== "mismatch") {
      await persistHashForCompatibleMatch(
        "visitorPassword",
        password,
        visitorMatchResult,
      );
      const token = generateToken({ role: "visitor" });
      return { success: true, role: "visitor", token };
    }
  }

  return {
    success: false,
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

  // Check Admin Password only
  if (mergedSettings.password) {
    const adminMatchResult = await compareStoredPassword(
      password,
      mergedSettings.password,
    );
    if (adminMatchResult !== "mismatch") {
      await persistHashForCompatibleMatch(
        "password",
        password,
        adminMatchResult,
      );
      const token = generateToken({ role: "admin" });
      return { success: true, role: "admin", token };
    }
  } else {
    const defaultAdminMatchResult = compareDefaultAdminPassword(
      password,
      mergedSettings.loginEnabled === true
    );
    if (defaultAdminMatchResult !== "mismatch") {
      await persistHashForCompatibleMatch(
        "password",
        DEFAULT_ADMIN_PASSWORD,
        defaultAdminMatchResult,
      );
      const token = generateToken({ role: "admin" });
      return { success: true, role: "admin", token };
    }

    return {
      success: false,
      message:
        mergedSettings.loginEnabled === true
          ? "Incorrect admin password"
          : "Admin password is not configured.",
    };
  }

  return {
    success: false,
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
  message?: string;
}> {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  // Check if visitor user is enabled (defaults to true for backward compatibility)
  const visitorUserEnabled = mergedSettings.visitorUserEnabled !== false;

  if (!visitorUserEnabled) {
    return {
      success: false,
      message: "Visitor user is not enabled.",
    };
  }

  // Check if password login is allowed (defaults to true for backward compatibility)
  const passwordLoginAllowed = mergedSettings.passwordLoginAllowed !== false;

  if (!passwordLoginAllowed) {
    return {
      success: false,
      message: "Password login is not allowed. Please use passkey authentication.",
    };
  }

  // Check Visitor Password only
  if (mergedSettings.visitorPassword) {
    const visitorMatchResult = await compareStoredPassword(
      password,
      mergedSettings.visitorPassword,
    );
    if (visitorMatchResult !== "mismatch") {
      await persistHashForCompatibleMatch(
        "visitorPassword",
        password,
        visitorMatchResult,
      );
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

  return {
    success: false,
    message: "Incorrect visitor password",
  };
}

/**
 * Confirm the admin password for an already-authenticated admin session.
 * This is intentionally independent from public password-login settings.
 */
export async function confirmAdminPassword(
  password: string
): Promise<{
  success: boolean;
  message?: string;
}> {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  if (!mergedSettings.password) {
    const defaultAdminMatchResult = compareDefaultAdminPassword(
      password,
      mergedSettings.loginEnabled === true
    );
    if (defaultAdminMatchResult !== "mismatch") {
      await persistHashForCompatibleMatch(
        "password",
        DEFAULT_ADMIN_PASSWORD,
        defaultAdminMatchResult
      );
      return { success: true };
    }

    return {
      success: false,
      message:
        mergedSettings.loginEnabled === true
          ? "Incorrect admin password"
          : "Admin password is not configured.",
    };
  }

  const adminMatchResult = await compareStoredPassword(
    password,
    mergedSettings.password
  );

  if (adminMatchResult === "mismatch") {
    return {
      success: false,
      message: "Incorrect admin password",
    };
  }

  await persistHashForCompatibleMatch("password", password, adminMatchResult);
  return { success: true };
}

/**
 * Hash a password
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}
