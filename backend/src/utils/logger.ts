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
   * Format timestamp for log messages
   */
  private formatTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const milliseconds = String(now.getMilliseconds()).padStart(3, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
  }

  /**
   * Sanitize arguments for logging to prevent log injection
   */
  private sanitizeArgs(args: any[]): any[] {
    return args.map((arg) => {
      if (typeof arg === "string") {
        return redactSensitive(sanitizeLogMessage(arg));
      }
      if (arg instanceof Error) {
        // Keep only safe error metadata to avoid leaking stack or sensitive content.
        return {
          name: sanitizeLogMessage(arg.name),
          message: redactSensitive(sanitizeLogMessage(arg.message)),
        };
      }
      if (typeof arg === "object" && arg !== null) {
        // For objects, try to sanitize string values
        try {
          const sanitized = JSON.parse(JSON.stringify(arg));
          if (typeof sanitized === "object") {
            const sanitizeObject = (obj: any): any => {
              if (Array.isArray(obj)) {
                return obj.map((item) =>
                  typeof item === "string"
                    ? sanitizeLogMessage(item)
                    : typeof item === "object" && item !== null
                    ? sanitizeObject(item)
                    : item
                );
              }
              const result: any = {};
              for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                  const value = obj[key];
                  result[key] =
                    typeof value === "string"
                      ? redactSensitive(sanitizeLogMessage(value))
                      : typeof value === "object" && value !== null
                      ? sanitizeObject(value)
                      : value;
                }
              }
              return result;
            };
            return sanitizeObject(sanitized);
          }
        } catch {
          // If JSON serialization fails, return as-is
        }
      }
      return arg;
    });
  }

  private formatArg(arg: unknown): string {
    if (typeof arg === "string") {
      return arg;
    }
    if (arg === null || arg === undefined) {
      return String(arg);
    }
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }

  /**
   * Log debug messages (most verbose)
   */
  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      const sanitizedMessage = redactSensitive(sanitizeLogMessage(message));
      const sanitizedArgs = this.sanitizeArgs(args);
      console.debug(`[${this.formatTimestamp()}] [DEBUG]`, sanitizedMessage, ...sanitizedArgs);
    }
  }

  /**
   * Log informational messages
   */
  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      const timestamp = this.formatTimestamp();
      const sanitizedMessage = redactSensitive(sanitizeLogMessage(message));
      const sanitizedArgs = this.sanitizeArgs(args);
      const serializedArgs = sanitizedArgs.map((arg) => this.formatArg(arg));
      const line = [`[${timestamp}] [INFO]`, sanitizedMessage, ...serializedArgs]
        .join(" ")
        .trim();
      process.stdout.write(`${line}\n`);
    }
  }

  /**
   * Log warning messages
   */
  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      const sanitizedMessage = redactSensitive(sanitizeLogMessage(message));
      const sanitizedArgs = this.sanitizeArgs(args);
      console.warn(`[${this.formatTimestamp()}] [WARN]`, sanitizedMessage, ...sanitizedArgs);
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
      const timestamp = this.formatTimestamp();
      const sanitizedMessage = redactSensitive(sanitizeLogMessage(message));
      const sanitizedArgs = this.sanitizeArgs(args);
      if (error instanceof Error) {
        const safeError = {
          name: sanitizeLogMessage(error.name),
          message: redactSensitive(sanitizeLogMessage(error.message)),
        };
        console.error(`[${timestamp}] [ERROR]`, sanitizedMessage, safeError, ...sanitizedArgs);
      } else if (error !== undefined) {
        const sanitizedError =
          typeof error === "string"
            ? redactSensitive(sanitizeLogMessage(error))
            : this.sanitizeArgs([error])[0];
        console.error(`[${timestamp}] [ERROR]`, sanitizedMessage, sanitizedError, ...sanitizedArgs);
      } else {
        console.error(`[${timestamp}] [ERROR]`, sanitizedMessage, ...sanitizedArgs);
      }
    }
  }
}

/**
 * Sanitize log message to prevent log injection attacks
 * Escapes newlines, carriage returns, and other control characters
 */
export function sanitizeLogMessage(message: string): string {
  if (typeof message !== "string") {
    return String(message);
  }
  return message
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/[\x00-\x1F\x7F-\x9F]/g, (char) => {
      const code = char.charCodeAt(0);
      return `\\x${code.toString(16).padStart(2, "0")}`;
    });
}

/**
 * Redact sensitive data from log messages
 * Replaces sensitive patterns with [REDACTED]
 */
export function redactSensitive(message: string): string {
  if (typeof message !== "string") {
    return String(message);
  }
  // Redact common sensitive patterns
  return message
    .replace(/password[=:]\s*[^\s]+/gi, "password=[REDACTED]")
    .replace(/token[=:]\s*[^\s]+/gi, "token=[REDACTED]")
    .replace(/secret[=:]\s*[^\s]+/gi, "secret=[REDACTED]")
    .replace(/api[_-]?key[=:]\s*[^\s]+/gi, "api_key=[REDACTED]")
    .replace(/authorization[=:]\s*[^\s]+/gi, "authorization=[REDACTED]");
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
