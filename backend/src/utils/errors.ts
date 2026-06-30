/**
 * Shared error helpers.
 *
 * Centralizes the "extract a human-readable message from a thrown value"
 * pattern that was previously duplicated across services. Prefer this over
 * ad-hoc `error instanceof Error ? error.message : String(error)` blocks and
 * over `catch (err: any)` (use `catch (err: unknown)` plus this helper).
 */

/**
 * Extract a message string from a caught value of unknown shape.
 *
 * Handles `Error` instances, objects with a string `message` property (e.g.
 * axios-style errors), strings, and everything else via `String()`.
 *
 * @param error The caught value (from a `catch (err: unknown)` clause).
 * @param fallback Optional message to return when no message can be extracted.
 *   When omitted, the stringified value is returned instead.
 */
export function getErrorMessage(
  error: unknown,
  fallback?: string
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const maybeError = error as { message?: unknown };
    if (typeof maybeError.message === "string") {
      return maybeError.message;
    }
  }

  if (fallback !== undefined) {
    return fallback;
  }

  return String(error);
}
