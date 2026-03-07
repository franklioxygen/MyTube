import bcrypt from "bcryptjs";
import crypto from "crypto";
import { isStrictSecurityModel } from "../config/securityModel";
import { defaultSettings } from "../types/settings";
import { logger } from "../utils/logger";
import * as loginAttemptService from "./loginAttemptService";
import * as storageService from "./storageService";

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

type PasswordMatchResult = "match" | "legacy_plaintext_match" | "mismatch";
type BootstrapResult =
  | { success: true }
  | {
      success: false;
      reason: "ALREADY_COMPLETED" | "IN_PROGRESS";
      message: string;
    };
type RecoveryTokenIssueResult = {
  token: string;
  expiresAt: number;
};
type RecoveryResetResult =
  | { success: true }
  | {
      success: false;
      reason:
        | "MISSING_TOKEN"
        | "INVALID_TOKEN"
        | "EXPIRED_TOKEN"
        | "RATE_LIMITED";
      message: string;
      retryAfterMs?: number;
    };

let bootstrapInProgress = false;

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

async function migrateLegacyPasswordHash(
  key: "password" | "visitorPassword",
  rawPassword: string,
  matchResult: PasswordMatchResult,
): Promise<void> {
  if (matchResult !== "legacy_plaintext_match") {
    return;
  }

  try {
    const hashedPassword = await hashPassword(rawPassword);
    storageService.saveSettings({ [key]: hashedPassword });
    logger.warn(
      `Detected legacy plaintext ${key}. Automatically migrated to bcrypt hash.`,
    );
  } catch (error) {
    logger.error(
      `Failed to migrate legacy plaintext ${key}.`,
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

export function isBootstrapCompleted(): boolean {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };
  return (
    mergedSettings.bootstrapCompleted === true ||
    (typeof mergedSettings.password === "string" &&
      mergedSettings.password.trim().length > 0)
  );
}

export async function bootstrapAdminPassword(
  password: string
): Promise<BootstrapResult> {
  const normalizedPassword =
    typeof password === "string" ? password.trim() : "";
  if (normalizedPassword.length < 8) {
    throw new Error("Bootstrap password must be at least 8 characters.");
  }

  if (bootstrapInProgress) {
    return {
      success: false,
      reason: "IN_PROGRESS",
      message:
        "Bootstrap is already in progress. Please retry after a short delay.",
    };
  }

  bootstrapInProgress = true;
  try {
    if (isBootstrapCompleted()) {
      return {
        success: false,
        reason: "ALREADY_COMPLETED",
        message: "Bootstrap has already completed.",
      };
    }

    const hashedPassword = await hashPassword(normalizedPassword);
    const didApply = storageService.tryCompleteBootstrapWithAdminPassword(
      hashedPassword
    );
    if (!didApply) {
      return {
        success: false,
        reason: "ALREADY_COMPLETED",
        message: "Bootstrap has already completed.",
      };
    }
    loginAttemptService.resetFailedAttempts();

    return { success: true };
  } finally {
    bootstrapInProgress = false;
  }
}

/**
 * Check if password authentication is enabled
 */
export function isPasswordEnabled(): {
  enabled: boolean;
  waitTime?: number;
  loginRequired?: boolean;
  bootstrapRequired?: boolean;
  visitorUserEnabled?: boolean;
  isVisitorPasswordSet?: boolean;
  passwordLoginAllowed?: boolean;
  allowResetPassword?: boolean;
  websiteName?: string;
} {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };
  const strictMode = isStrictSecurityModel();
  const loginRequired = strictMode ? true : mergedSettings.loginEnabled === true;
  const bootstrapRequired = strictMode && !isBootstrapCompleted();

  // Check if password login is allowed (defaults to true for backward compatibility)
  const passwordLoginAllowed = mergedSettings.passwordLoginAllowed !== false;

  // Return true only if login is enabled AND a password is set AND password login is allowed
  const isEnabled = loginRequired && !!mergedSettings.password && passwordLoginAllowed;

  // Check for remaining wait time
  const remainingWaitTime = loginAttemptService.canAttemptLogin();

  return {
    enabled: isEnabled,
    waitTime: remainingWaitTime > 0 ? remainingWaitTime : undefined,
    loginRequired,
    bootstrapRequired,
    visitorUserEnabled: mergedSettings.visitorUserEnabled !== false,
    isVisitorPasswordSet: !!mergedSettings.visitorPassword,
    passwordLoginAllowed,
    allowResetPassword: mergedSettings.allowResetPassword !== false,
    websiteName: mergedSettings.websiteName,
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
  const strictMode = isStrictSecurityModel();

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
    const adminMatchResult = await compareStoredPassword(
      password,
      mergedSettings.password,
    );
    if (adminMatchResult !== "mismatch") {
      await migrateLegacyPasswordHash(
        "password",
        password,
        adminMatchResult,
      );
      loginAttemptService.resetFailedAttempts();
      const token = generateToken({ role: "admin" });
      return { success: true, role: "admin", token };
    }
  } else {
    // Legacy compatibility: allow passwordless admin login only in legacy mode.
    if (!strictMode && mergedSettings.loginEnabled) {
       loginAttemptService.resetFailedAttempts();
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
      await migrateLegacyPasswordHash(
        "visitorPassword",
        password,
        visitorMatchResult,
      );
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
  const strictMode = isStrictSecurityModel();

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
    const adminMatchResult = await compareStoredPassword(
      password,
      mergedSettings.password,
    );
    if (adminMatchResult !== "mismatch") {
      await migrateLegacyPasswordHash(
        "password",
        password,
        adminMatchResult,
      );
      loginAttemptService.resetFailedAttempts();
      const token = generateToken({ role: "admin" });
      return { success: true, role: "admin", token };
    }
  } else {
    // Legacy compatibility: allow passwordless admin login only in legacy mode.
    if (!strictMode && mergedSettings.loginEnabled) {
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
    const visitorMatchResult = await compareStoredPassword(
      password,
      mergedSettings.visitorPassword,
    );
    if (visitorMatchResult !== "mismatch") {
      await migrateLegacyPasswordHash(
        "visitorPassword",
        password,
        visitorMatchResult,
      );
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
const PASSWORD_RECOVERY_TOKEN_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RECOVERY_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RECOVERY_RATE_LIMIT_MAX_ATTEMPTS = 5;
const RECOVERY_TOKEN_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

interface RecoveryRateLimitState {
  attempts: number;
  windowStartedAt: number;
}

const recoveryRateLimitState = new Map<string, RecoveryRateLimitState>();

const normalizeSourceKey = (sourceKey: string | undefined): string => {
  const normalized = (sourceKey ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : "unknown";
};

const getRecoveryRateLimitState = (sourceKey: string): RecoveryRateLimitState => {
  const now = Date.now();
  const existing = recoveryRateLimitState.get(sourceKey);
  if (!existing || now - existing.windowStartedAt >= PASSWORD_RECOVERY_RATE_LIMIT_WINDOW_MS) {
    const freshState = { attempts: 0, windowStartedAt: now };
    recoveryRateLimitState.set(sourceKey, freshState);
    return freshState;
  }

  return existing;
};

const getRecoveryRateLimitResult = (
  sourceKey: string
): { allowed: true } | { allowed: false; retryAfterMs: number } => {
  const state = getRecoveryRateLimitState(sourceKey);
  if (state.attempts < PASSWORD_RECOVERY_RATE_LIMIT_MAX_ATTEMPTS) {
    return { allowed: true };
  }

  const retryAfterMs = Math.max(
    1,
    PASSWORD_RECOVERY_RATE_LIMIT_WINDOW_MS - (Date.now() - state.windowStartedAt)
  );
  return { allowed: false, retryAfterMs };
};

const recordRecoveryFailure = (sourceKey: string): void => {
  const state = getRecoveryRateLimitState(sourceKey);
  state.attempts += 1;
  recoveryRateLimitState.set(sourceKey, state);
};

const clearRecoveryRateLimitState = (sourceKey: string): void => {
  recoveryRateLimitState.delete(sourceKey);
};

const normalizeRecoveryToken = (token: string | undefined): string =>
  typeof token === "string" ? token.trim() : "";

const hashRecoveryToken = (token: string): string =>
  crypto.createHash("sha256").update(token, "utf8").digest("hex");

const timingSafeStringEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  const maxLength = Math.max(leftBuffer.length, rightBuffer.length);

  const paddedLeft = Buffer.alloc(maxLength);
  const paddedRight = Buffer.alloc(maxLength);
  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(paddedLeft, paddedRight)
  );
};

const readRecoveryTokenState = (): {
  hash: string;
  expiresAt: number;
} => {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  return {
    hash:
      typeof mergedSettings.passwordRecoveryTokenHash === "string"
        ? mergedSettings.passwordRecoveryTokenHash
        : "",
    expiresAt:
      typeof mergedSettings.passwordRecoveryTokenExpiresAt === "number"
        ? mergedSettings.passwordRecoveryTokenExpiresAt
        : 0,
  };
};

const clearRecoveryTokenState = (): void => {
  storageService.saveSettings({
    passwordRecoveryTokenHash: "",
    passwordRecoveryTokenExpiresAt: 0,
    passwordRecoveryTokenIssuedAt: 0,
  });
};

const buildRandomPassword = (length: number): string => {
  const randomBytes = crypto.randomBytes(length);
  return Array.from(randomBytes, (byte) =>
    RECOVERY_TOKEN_CHARSET.charAt(byte % RECOVERY_TOKEN_CHARSET.length)
  ).join("");
};

async function resetPasswordInternal(
  options: { skipCooldownCheck?: boolean } = {}
): Promise<string> {
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
  if (!options.skipCooldownCheck) {
    const remainingCooldown = getResetPasswordCooldown();
    if (remainingCooldown > 0) {
      const minutes = Math.ceil(remainingCooldown / (60 * 1000));
      throw new Error(`Password reset is on cooldown. Please wait ${minutes} minute${minutes !== 1 ? 's' : ''} before trying again.`);
    }
  }

  const newPassword = buildRandomPassword(8);

  // Hash the new password
  const hashedPassword = await hashPassword(newPassword);

  // Update settings with new password and reset timestamp
  mergedSettings.password = hashedPassword;
  mergedSettings.loginEnabled = true; // Ensure login is enabled
  mergedSettings.bootstrapCompleted = true;
  (mergedSettings as any).lastPasswordResetTime = Date.now();

  storageService.saveSettings(mergedSettings);

  // Log that password was reset (redact actual password)
  logger.info(`Password has been reset. New password: ${newPassword}`);

  // Reset failed login attempts
  loginAttemptService.resetFailedAttempts();

  return newPassword;
}

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

export function issuePasswordRecoveryToken(): RecoveryTokenIssueResult {
  const rawToken = buildRandomPassword(32);
  const tokenHash = hashRecoveryToken(rawToken);
  const expiresAt = Date.now() + PASSWORD_RECOVERY_TOKEN_TTL_MS;

  storageService.saveSettings({
    passwordRecoveryTokenHash: tokenHash,
    passwordRecoveryTokenExpiresAt: expiresAt,
    passwordRecoveryTokenIssuedAt: Date.now(),
  });

  logger.info("Issued one-time password recovery token.");
  return {
    token: rawToken,
    expiresAt,
  };
}

export async function resetPasswordWithRecoveryToken(
  recoveryToken: string,
  sourceKey: string
): Promise<RecoveryResetResult> {
  const normalizedSource = normalizeSourceKey(sourceKey);
  const normalizedToken = normalizeRecoveryToken(recoveryToken);
  if (normalizedToken.length === 0) {
    return {
      success: false,
      reason: "MISSING_TOKEN",
      message: "Recovery token is required.",
    };
  }

  const rateLimit = getRecoveryRateLimitResult(normalizedSource);
  if (!rateLimit.allowed) {
    return {
      success: false,
      reason: "RATE_LIMITED",
      message: "Too many invalid recovery attempts. Please wait before retrying.",
      retryAfterMs: rateLimit.retryAfterMs,
    };
  }

  const tokenState = readRecoveryTokenState();
  if (tokenState.hash.length === 0 || tokenState.expiresAt <= 0) {
    recordRecoveryFailure(normalizedSource);
    return {
      success: false,
      reason: "INVALID_TOKEN",
      message: "Recovery token is invalid.",
    };
  }

  if (tokenState.expiresAt <= Date.now()) {
    clearRecoveryTokenState();
    recordRecoveryFailure(normalizedSource);
    return {
      success: false,
      reason: "EXPIRED_TOKEN",
      message: "Recovery token has expired.",
    };
  }

  const incomingHash = hashRecoveryToken(normalizedToken);
  if (!timingSafeStringEqual(incomingHash, tokenState.hash)) {
    recordRecoveryFailure(normalizedSource);
    return {
      success: false,
      reason: "INVALID_TOKEN",
      message: "Recovery token is invalid.",
    };
  }

  clearRecoveryTokenState();
  await resetPasswordInternal({ skipCooldownCheck: true });
  clearRecoveryRateLimitState(normalizedSource);

  logger.info("Password reset completed using one-time recovery token.");
  return { success: true };
}

/**
 * Reset password to a random 8-character string
 * Returns the new password (should be logged, not sent to frontend)
 */
export async function resetPassword(): Promise<string> {
  return resetPasswordInternal();
}
