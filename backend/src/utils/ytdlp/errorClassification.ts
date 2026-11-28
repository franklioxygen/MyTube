/**
 * Classification helpers for yt-dlp failures.
 *
 * Kept intentionally dependency-light (no spawn/install imports) so any service
 * can import it without pulling in the full yt-dlp runtime.
 */

import { isAnyCancellationError } from "../../errors/DownloadErrors";
import { redactSensitive } from "../logger";

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

/**
 * Failure message for a YouTube download that got HTTP 403 while cookies were
 * in use — typically a session YouTube has since invalidated. The frontend
 * matches this exact text to show a localized hint
 * (frontend/src/utils/downloadErrorMessage.ts), so keep the two in sync.
 */
export const YOUTUBE_COOKIES_EXPIRED_MESSAGE =
  "YouTube refused the download (HTTP 403). Your YouTube cookies may have expired; please re-upload them.";

/** Detect an HTTP 403 Forbidden reported by yt-dlp. */
export function isHttpForbiddenError(error: unknown): boolean {
  return collectErrorText(error).includes("HTTP Error 403");
}

/** Longest yt-dlp reason kept in a failure message. */
const MAX_FAILURE_REASON_LENGTH = 300;

// A local absolute path (POSIX, Windows drive or UNC), such as the cookies file
// or an output path. The slashes of a URL never start a token, so URLs don't
// match.
const LOCAL_PATH_PATTERN =
  /(?:^|[\s'"(=[])(?:\\\\|\/)(?=[\w.~-])|\b[A-Za-z]:[\\/]/;

// A URL with a query string, which can carry a signature or token under a name
// redactSensitive doesn't know, such as a signed CDN URL.
const URL_WITH_QUERY_PATTERN = /:\/\/[^\s?#]*\?/;

/**
 * yt-dlp's own reason for a failure: the last `ERROR:` line on stderr without
 * its `ERROR: [extractor] id:` prefix, capped in length. For a geo-blocked
 * video that is "The uploader has not made this video available in your
 * country".
 *
 * The reason is stored in download history and shown to the user, so a line
 * that carries a credential (such as a proxy URL), a URL with a query string or
 * a local path is dropped rather than redacted. So is one that would read as a cancellation, since
 * isAnyCancellationError matches on message text. Returns null when no usable
 * line is left.
 */
export function getYtDlpFailureReason(stderr: string): string | null {
  const errorLine = stderr
    .split(/[\r\n]+/)
    .filter((line) => line.startsWith("ERROR:"))
    .pop();
  if (!errorLine) return null;

  const reason = errorLine
    .replace(/^ERROR:\s*(?:\[[^\]]+\]\s*(?:[^\s:]+:\s+)?)?/, "")
    .trim();
  if (
    !reason ||
    redactSensitive(reason) !== reason ||
    URL_WITH_QUERY_PATTERN.test(reason) ||
    LOCAL_PATH_PATTERN.test(reason) ||
    isAnyCancellationError(new Error(reason))
  ) {
    return null;
  }

  return reason.length <= MAX_FAILURE_REASON_LENGTH
    ? reason
    : `${reason.slice(0, MAX_FAILURE_REASON_LENGTH - 1).trimEnd()}…`;
}
