/**
 * Discriminated union types for download errors
 * Each error has a unique `type` field for type-safe error handling
 */

export type DownloadErrorType =
  | "cancelled"
  | "ytdlp"
  | "subtitle"
  | "network"
  | "file"
  | "unknown";

export class DownloadError extends Error {
  readonly type: DownloadErrorType;
  readonly recoverable: boolean;

  constructor(
    type: DownloadErrorType,
    message: string,
    recoverable: boolean = false
  ) {
    super(message);
    this.name = "DownloadError";
    this.type = type;
    this.recoverable = recoverable;
  }

  /**
   * Check if error is of a specific type (type guard)
   */
  isType<T extends DownloadErrorType>(
    type: T
  ): this is DownloadError & { type: T } {
    return this.type === type;
  }

  /**
   * Factory for unknown errors
   */
  static unknown(message: string): DownloadError {
    return new DownloadError("unknown", message, false);
  }
}

/**
 * Thrown when a download is cancelled by the user
 */
export class DownloadCancelledError extends DownloadError {
  override readonly type = "cancelled" as const;

  constructor(message: string = "Download cancelled by user") {
    super("cancelled", message, false);
    this.name = "DownloadCancelledError";
  }

  static create(): DownloadCancelledError {
    return new DownloadCancelledError();
  }
}

/**
 * Thrown when yt-dlp encounters an error
 */
export class YtDlpError extends DownloadError {
  override readonly type = "ytdlp" as const;
  readonly originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super("ytdlp", message, false);
    this.name = "YtDlpError";
    this.originalError = originalError;
  }

  static fromError(error: Error): YtDlpError {
    return new YtDlpError(error.message, error);
  }

  static withMessage(message: string): YtDlpError {
    return new YtDlpError(message);
  }
}

/**
 * Thrown when subtitle download/processing fails
 * This is typically recoverable - video can still be saved without subtitles
 */
export class SubtitleError extends DownloadError {
  override readonly type = "subtitle" as const;
  readonly originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super("subtitle", message, true); // Subtitles are recoverable
    this.name = "SubtitleError";
    this.originalError = originalError;
  }

  static fromError(error: Error): SubtitleError {
    return new SubtitleError(error.message, error);
  }

  static withMessage(message: string): SubtitleError {
    return new SubtitleError(message);
  }
}

/**
 * Thrown when a network operation fails
 */
export class NetworkError extends DownloadError {
  override readonly type = "network" as const;
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super("network", message, true); // Network errors might be transient
    this.name = "NetworkError";
    this.statusCode = statusCode;
  }

  static withStatus(message: string, statusCode: number): NetworkError {
    return new NetworkError(message, statusCode);
  }

  static timeout(): NetworkError {
    return new NetworkError("Request timed out");
  }
}

/**
 * Thrown when a file operation fails
 */
export class FileError extends DownloadError {
  override readonly type = "file" as const;
  readonly filePath?: string;

  constructor(message: string, filePath?: string) {
    super("file", message, false);
    this.name = "FileError";
    this.filePath = filePath;
  }

  static notFound(filePath: string): FileError {
    return new FileError(`File not found: ${filePath}`, filePath);
  }

  static writeError(filePath: string, reason?: string): FileError {
    const msg = reason
      ? `Failed to write file ${filePath}: ${reason}`
      : `Failed to write file: ${filePath}`;
    return new FileError(msg, filePath);
  }
}

/**
 * Type guard to check if an error is a DownloadError
 */
export function isDownloadError(error: unknown): error is DownloadError {
  return error instanceof DownloadError;
}

/**
 * Type guard to check if an error is a cancellation error
 */
export function isCancelledError(
  error: unknown
): error is DownloadCancelledError {
  return error instanceof DownloadCancelledError;
}

/**
 * Check if any error (including non-DownloadError) indicates cancellation
 */
export function isAnyCancellationError(error: unknown): boolean {
  if (error instanceof DownloadCancelledError) return true;
  if (!(error instanceof Error)) return false;

  const err = error as any;
  return (
    err.code === 143 ||
    err.message?.includes("killed") ||
    err.message?.includes("SIGTERM") ||
    err.code === "SIGTERM" ||
    err.message?.includes("Download cancelled by user") ||
    err.message?.includes("cancelled")
  );
}

/**
 * ============================================================================
 * Service Errors - For general service operations
 * ============================================================================
 */

export type ServiceErrorType =
  | "validation"
  | "not_found"
  | "duplicate"
  | "database"
  | "execution"
  | "migration"
  | "unknown";

/**
 * Base class for service-related errors
 */
export class ServiceError extends Error {
  readonly type: ServiceErrorType;
  readonly recoverable: boolean;

  constructor(
    type: ServiceErrorType,
    message: string,
    recoverable: boolean = false
  ) {
    super(message);
    this.name = "ServiceError";
    this.type = type;
    this.recoverable = recoverable;
  }

  isType<T extends ServiceErrorType>(
    type: T
  ): this is ServiceError & { type: T } {
    return this.type === type;
  }
}

/**
 * Thrown when validation fails (invalid input, URL, etc.)
 */
export class ValidationError extends ServiceError {
  override readonly type = "validation" as const;
  readonly field?: string;

  constructor(message: string, field?: string) {
    super("validation", message, false);
    this.name = "ValidationError";
    this.field = field;
  }

  static invalidUrl(url: string, reason?: string): ValidationError {
    const msg = reason
      ? `Invalid URL: ${url}. ${reason}`
      : `Invalid URL: ${url}`;
    return new ValidationError(msg, "url");
  }

  static invalidBilibiliSpaceUrl(url: string): ValidationError {
    return new ValidationError(`Invalid Bilibili space URL: ${url}`, "url");
  }

  static unsupportedPlatform(url: string): ValidationError {
    return new ValidationError(
      `Invalid URL. Only YouTube channel URLs and Bilibili space URLs are supported: ${url}`,
      "url"
    );
  }
}

/**
 * Thrown when a resource is not found
 */
export class NotFoundError extends ServiceError {
  override readonly type = "not_found" as const;
  readonly resource: string;
  readonly resourceId?: string;

  constructor(resource: string, resourceId?: string) {
    super(
      "not_found",
      `${resource} not found${resourceId ? `: ${resourceId}` : ""}`,
      false
    );
    this.name = "NotFoundError";
    this.resource = resource;
    this.resourceId = resourceId;
  }

  static video(videoId: string): NotFoundError {
    return new NotFoundError("Video", videoId);
  }

  static subscription(subscriptionId: string): NotFoundError {
    return new NotFoundError("Subscription", subscriptionId);
  }
}

/**
 * Thrown when attempting to create a duplicate resource
 */
export class DuplicateError extends ServiceError {
  override readonly type = "duplicate" as const;
  readonly resource: string;

  constructor(resource: string, message?: string) {
    super("duplicate", message || `${resource} already exists`, false);
    this.name = "DuplicateError";
    this.resource = resource;
  }

  static subscription(): DuplicateError {
    return new DuplicateError("Subscription", "Subscription already exists");
  }
}

/**
 * Thrown when a database operation fails
 */
export class DatabaseError extends ServiceError {
  override readonly type = "database" as const;
  readonly originalError?: Error;
  readonly operation?: string;

  constructor(message: string, originalError?: Error, operation?: string) {
    super("database", message, true); // Database errors might be retryable
    this.name = "DatabaseError";
    this.originalError = originalError;
    this.operation = operation;
  }

  static fromError(error: Error, operation?: string): DatabaseError {
    return new DatabaseError(error.message, error, operation);
  }
}

/**
 * Thrown when an external command/execution fails
 */
export class ExecutionError extends ServiceError {
  override readonly type = "execution" as const;
  readonly command?: string;
  readonly exitCode?: number;
  readonly originalError?: Error;

  constructor(
    message: string,
    command?: string,
    exitCode?: number,
    originalError?: Error
  ) {
    super("execution", message, false);
    this.name = "ExecutionError";
    this.command = command;
    this.exitCode = exitCode;
    this.originalError = originalError;
  }

  static fromCommand(
    command: string,
    error: Error,
    exitCode?: number
  ): ExecutionError {
    return new ExecutionError(
      `Command failed: ${command}`,
      command,
      exitCode,
      error
    );
  }
}

/**
 * Thrown when a migration operation fails
 */
export class MigrationError extends ServiceError {
  override readonly type = "migration" as const;
  readonly step?: string;
  readonly originalError?: Error;

  constructor(message: string, step?: string, originalError?: Error) {
    super("migration", message, false);
    this.name = "MigrationError";
    this.step = step;
    this.originalError = originalError;
  }

  static fromError(error: Error, step?: string): MigrationError {
    return new MigrationError(error.message, step, error);
  }
}

/**
 * Type guard to check if an error is a ServiceError
 */
export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

/**
 * Type guard to check if an error is a ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Type guard to check if an error is a NotFoundError
 */
export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}
