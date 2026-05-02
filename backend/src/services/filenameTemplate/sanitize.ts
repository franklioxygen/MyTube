const SEGMENT_MAX_LENGTH = 180;
const PATH_MAX_LENGTH = 240;
const ILLEGAL_CHARS_RE = /[<>:"|?*\x00]/g;
const TRAILING_DOTS_SPACES_RE = /[. ]+$/;
const REPEATED_WHITESPACE_RE = /\s+/g;

/**
 * Replaces in-segment path separators with a space so that a variable value
 * cannot introduce an extra directory level inside a rendered path segment.
 */
export function replaceSegmentSeparators(value: string): string {
  return value.replace(/[\\/]/g, " ");
}

/**
 * Sanitizes a single path segment (between slashes).
 * - Removes NUL and characters illegal on common filesystems.
 * - Collapses repeated whitespace.
 * - Trims trailing dots/spaces for Windows compatibility.
 * - Truncates to SEGMENT_MAX_LENGTH.
 */
export function sanitizeSegment(segment: string): string {
  let s = segment;
  s = s.replace(ILLEGAL_CHARS_RE, "");
  s = s.replace(REPEATED_WHITESPACE_RE, " ");
  s = s.replace(TRAILING_DOTS_SPACES_RE, "");
  s = s.trim();
  if (s.length > SEGMENT_MAX_LENGTH) {
    s = s.slice(0, SEGMENT_MAX_LENGTH).replace(TRAILING_DOTS_SPACES_RE, "").trim();
  }
  return s;
}

/**
 * Splits a relative path on "/" and sanitizes each segment.
 * Returns null if the path contains any traversal segment ("." or "..") or
 * produces an empty final filename segment after sanitization.
 */
export function sanitizeRelativePath(
  relativePath: string
): { segments: string[]; sanitized: string } | null {
  const rawSegments = relativePath.split("/");

  const sanitized: string[] = [];
  for (const seg of rawSegments) {
    if (seg === "." || seg === "..") {
      return null;
    }
    const clean = sanitizeSegment(seg);
    if (clean.length > 0) {
      sanitized.push(clean);
    }
  }

  if (sanitized.length === 0) {
    return null;
  }

  // The last segment must be non-empty (it's the filename).
  const last = sanitized[sanitized.length - 1];
  if (!last || last.length === 0) {
    return null;
  }

  return { segments: sanitized, sanitized: sanitized.join("/") };
}

/**
 * Truncates the basename stem of the final segment to keep the full relative
 * path within PATH_MAX_LENGTH, while preserving the extension.
 */
export function enforcePathLengthLimit(
  segments: string[]
): string[] {
  if (segments.length === 0) {
    return segments;
  }

  const current = segments.join("/");
  if (current.length <= PATH_MAX_LENGTH) {
    return segments;
  }

  const last = segments[segments.length - 1];
  const dotIndex = last.lastIndexOf(".");
  if (dotIndex <= 0) {
    // No recognizable extension; truncate the whole basename
    const excess = current.length - PATH_MAX_LENGTH;
    const truncated = last.slice(0, Math.max(1, last.length - excess));
    return [...segments.slice(0, -1), truncated.replace(TRAILING_DOTS_SPACES_RE, "").trim()];
  }

  const stem = last.slice(0, dotIndex);
  const ext = last.slice(dotIndex); // includes the dot
  const prefix = segments.slice(0, -1).join("/");
  const separatorLen = prefix.length > 0 ? 1 : 0;
  const maxStemLen = PATH_MAX_LENGTH - prefix.length - separatorLen - ext.length;
  if (maxStemLen <= 0) {
    return segments;
  }
  const truncatedStem = stem.slice(0, maxStemLen).replace(TRAILING_DOTS_SPACES_RE, "").trim();
  const truncatedLast = `${truncatedStem}${ext}`;
  return [...segments.slice(0, -1), truncatedLast];
}
