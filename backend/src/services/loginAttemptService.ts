import fs from "fs-extra";
import path from "path";
import { DATA_DIR } from "../config/paths";
import { logger } from "../utils/logger";
import { getSettings } from "./storageService/settings";

interface LoginAttemptData {
  failedAttempts: number;
  lastFailedAttemptTime: number; // timestamp in milliseconds
  waitUntil: number; // timestamp in milliseconds when user can try again
}

const LOGIN_ATTEMPTS_FILE = path.join(DATA_DIR, "login-attempts.json");

// Wait time mapping based on failed attempts
const WAIT_TIMES: Record<number, number> = {
  1: 5 * 1000, // 5 seconds
  2: 5 * 1000, // 5 seconds
  3: 10 * 1000, // 10 seconds
  4: 30 * 1000, // 30 seconds
  5: 60 * 1000, // 1 minute
  6: 3 * 60 * 1000, // 3 minutes
  7: 10 * 60 * 1000, // 10 minutes
  8: 2 * 60 * 60 * 1000, // 2 hours
  9: 6 * 60 * 60 * 1000, // 6 hours
};



// Fast retry wait times
const FAST_RETRY_WAIT_TIMES: Record<number, number> = {
  1: 5 * 1000, // 5 seconds
  2: 5 * 1000, // 5 seconds
  3: 10 * 1000, // 10 seconds
  4: 30 * 1000, // 30 seconds
  5: 60 * 1000, // 1 minute
  6: 3 * 60 * 1000, // 3 minutes
};

const MAX_WAIT_TIME = 24 * 60 * 60 * 1000; // 24 hours for 10+ attempts
const FAST_RETRY_MAX_WAIT_TIME = 3 * 60 * 1000; // 3 minutes for 6+ attempts

/**
 * Get wait time in milliseconds for a given number of failed attempts
 */
function getWaitTime(attempts: number): number {
  if (attempts <= 0) return 0;

  const settings = getSettings();
  const isFastRetry = settings.fastRetryMode;

  if (isFastRetry) {
    if (attempts >= 7) return FAST_RETRY_MAX_WAIT_TIME;
    return FAST_RETRY_WAIT_TIMES[attempts] || FAST_RETRY_MAX_WAIT_TIME;
  }

  if (attempts >= 10) return MAX_WAIT_TIME;
  return WAIT_TIMES[attempts] || MAX_WAIT_TIME;
}

/**
 * Load login attempt data from file
 */
function loadAttemptData(): LoginAttemptData {
  try {
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(LOGIN_ATTEMPTS_FILE)) {
      const data = fs.readJsonSync(LOGIN_ATTEMPTS_FILE);
      return {
        failedAttempts: data.failedAttempts || 0,
        lastFailedAttemptTime: data.lastFailedAttemptTime || 0,
        waitUntil: data.waitUntil || 0,
      };
    }
  } catch (error) {
    logger.error("Error loading login attempt data", error);
  }
  return {
    failedAttempts: 0,
    lastFailedAttemptTime: 0,
    waitUntil: 0,
  };
}

/**
 * Save login attempt data to file
 */
function saveAttemptData(data: LoginAttemptData): void {
  try {
    // Ensure data directory exists
    fs.ensureDirSync(DATA_DIR);
    fs.writeJsonSync(LOGIN_ATTEMPTS_FILE, data, { spaces: 2 });
  } catch (error) {
    logger.error("Error saving login attempt data", error);
  }
}

/**
 * Check if user can attempt login (no wait time remaining)
 * Returns remaining wait time in milliseconds, or 0 if can proceed
 */
export function canAttemptLogin(): number {
  const data = loadAttemptData();
  const now = Date.now();

  if (data.waitUntil > now) {
    return data.waitUntil - now;
  }

  return 0;
}

/**
 * Record a failed login attempt
 * Returns the wait time in milliseconds that was set
 */
export function recordFailedAttempt(): number {
  const data = loadAttemptData();
  const now = Date.now();

  // Only increment if wait time has passed (user is allowed to try again)
  // If still in wait period, don't increment (this shouldn't happen as canAttemptLogin checks this)
  // But if it does, we still increment to track the attempt
  if (data.waitUntil > now) {
    // Still in wait period - this shouldn't happen, but increment anyway
    logger.warn(
      `Attempt recorded while still in wait period. Current attempts: ${data.failedAttempts}`
    );
  }

  // Increment failed attempts (counter persists until correct password is entered)
  data.failedAttempts += 1;
  data.lastFailedAttemptTime = now;

  // Calculate wait time based on current attempt count
  const waitTime = getWaitTime(data.failedAttempts);
  data.waitUntil = now + waitTime;

  saveAttemptData(data);

  logger.warn(
    `Failed login attempt #${data.failedAttempts}. Wait time: ${
      waitTime / 1000
    }s`
  );

  return waitTime;
}

/**
 * Reset failed attempts (called on successful login)
 */
export function resetFailedAttempts(): void {
  const data: LoginAttemptData = {
    failedAttempts: 0,
    lastFailedAttemptTime: 0,
    waitUntil: 0,
  };
  saveAttemptData(data);
  logger.info("Login attempts reset after successful login");
}

/**
 * Get current failed attempts count
 * Returns the count even if wait time has passed (counter persists until reset)
 */
export function getFailedAttempts(): number {
  const data = loadAttemptData();
  return data.failedAttempts;
}

/**
 * Get remaining wait time in milliseconds
 */
export function getRemainingWaitTime(): number {
  const data = loadAttemptData();
  const now = Date.now();

  if (data.waitUntil > now) {
    return data.waitUntil - now;
  }

  return 0;
}
