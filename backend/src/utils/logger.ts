/**
 * Centralized logging utility
 * Provides consistent logging with log levels and structured output
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Log debug messages (most verbose)
   */
  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Log informational messages
   */
  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  /**
   * Log warning messages
   */
  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  /**
   * Log error messages
   * @param message - Error message
   * @param error - Optional Error object
   * @param args - Additional arguments
   */
  error(message: string, error?: Error | unknown, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      if (error instanceof Error) {
        console.error(`[ERROR] ${message}`, error, ...args);
      } else if (error !== undefined) {
        console.error(`[ERROR] ${message}`, error, ...args);
      } else {
        console.error(`[ERROR] ${message}`, ...args);
      }
    }
  }
}

/**
 * Get log level from environment variable
 */
function getLogLevelFromEnv(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  switch (envLevel) {
    case "debug":
      return LogLevel.DEBUG;
    case "info":
      return LogLevel.INFO;
    case "warn":
      return LogLevel.WARN;
    case "error":
      return LogLevel.ERROR;
    default:
      // Default to INFO in production, DEBUG in development
      return process.env.NODE_ENV === "production"
        ? LogLevel.INFO
        : LogLevel.DEBUG;
  }
}

/**
 * Default logger instance
 * Use this throughout the application for consistent logging
 */
export const logger = new Logger(getLogLevelFromEnv());

