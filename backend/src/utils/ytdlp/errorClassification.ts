/**
 * Classification helpers for yt-dlp failures.
 *
 * Kept intentionally dependency-light (no spawn/install imports) so any service
 * can import it without pulling in the full yt-dlp runtime.
 */

// yt-dlp emits one of these fragments when a video is gated behind a channel
// membership. The exact wording varies by membership tier / video, so match on
// the stable substrings rather than the whole message. Examples:
//   "Join this channel to get access to members-only content like this video…"
//   "This video is available to this channel's members on level: … Join this
//    channel to get access to members-only content and other exclusive perks."
const MEMBERS_ONLY_ERROR_NEEDLES = [
  "members-only content",
  "join this channel to get access",
  "members on level",
] as const;

/**
 * Collect the human-readable text carried by an error into a single string.
 *
 * yt-dlp reports failures on stderr while exiting non-zero, so the resulting
 * error carries the useful detail on `stderr` rather than in `message`. Walk
 * `message`, `stderr`, and any nested `cause`/`originalError` (bounded depth)
 * so classification is robust to wrapping.
 */
function collectErrorText(error: unknown, depth = 0): string {
  if (error == null || depth > 3) return "";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);

  const err = error as {
    message?: unknown;
    stderr?: unknown;
    cause?: unknown;
    originalError?: unknown;
  };

  const parts: string[] = [];
  if (typeof err.message === "string") parts.push(err.message);
  if (typeof err.stderr === "string") parts.push(err.stderr);
  if (err.cause) parts.push(collectErrorText(err.cause, depth + 1));
  if (err.originalError) parts.push(collectErrorText(err.originalError, depth + 1));
  return parts.join("\n");
}

/**
 * Detect whether a yt-dlp failure was caused by members-only content.
 *
 * Such videos can never be downloaded without an authenticated channel
 * membership, so callers should treat them as skipped rather than retrying.
 */
export function isMembersOnlyError(error: unknown): boolean {
  const haystack = collectErrorText(error).toLowerCase();
  if (!haystack) return false;
  return MEMBERS_ONLY_ERROR_NEEDLES.some((needle) => haystack.includes(needle));
}
