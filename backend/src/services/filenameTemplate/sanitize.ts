const SEGMENT_MAX_BYTES = 180;
const PATH_MAX_BYTES = 240;
const ILLEGAL_CHARS_RE = /[<>:"|?*\x00]/g;
const TRAILING_DOTS_SPACES_RE = /[. ]+$/;
const REPEATED_WHITESPACE_RE = /\s+/g;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateToByteLength(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) {
    return value;
  }
  let out = "";
  let bytes = 0;
  for (const ch of value) {
    const chBytes = byteLength(ch);
    if (bytes + chBytes > maxBytes) break;
    out += ch;
    bytes += chBytes;
  }
  return out;
}

function truncateFilenameSegmentPreservingExtension(
  value: string,
  maxBytes: number
): string {
  if (byteLength(value) <= maxBytes) {
    return value;
  }

  const dotIndex = value.lastIndexOf(".");
  if (dotIndex <= 0) {
    return truncateToByteLength(value, maxBytes);
  }

  const stem = value.slice(0, dotIndex);
  const ext = value.slice(dotIndex);
  const extBytes = byteLength(ext);

  if (extBytes >= maxBytes) {
    return truncateToByteLength(value, maxBytes);
  }

  const truncatedStem = truncateToByteLength(stem, maxBytes - extBytes)
    .replace(TRAILING_DOTS_SPACES_RE, "")
    .trim();

  return `${truncatedStem || "x"}${ext}`;
}

function trimLeadingDirectorySegmentsToFit(
  segments: string[],
  maxPathBytes: number,
  minFilenameBytes: number
): string[] {
  let workingSegments = [...segments];
  while (workingSegments.length > 1) {
    const prefix = workingSegments.slice(0, -1).join("/");
    const separatorBytes = prefix.length > 0 ? 1 : 0;
    if (
      byteLength(prefix) + separatorBytes + minFilenameBytes <=
      maxPathBytes
    ) {
      break;
    }
    workingSegments = workingSegments.slice(1);
  }
  return workingSegments;
}

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
 * - Truncates to SEGMENT_MAX_BYTES (UTF-8 byte count).
 */
export function sanitizeSegment(segment: string): string {
  let s = segment;
  s = s.replace(ILLEGAL_CHARS_RE, "");
  s = s.replace(REPEATED_WHITESPACE_RE, " ");
  s = s.replace(TRAILING_DOTS_SPACES_RE, "");
  s = s.trim();
  if (byteLength(s) > SEGMENT_MAX_BYTES) {
    s = truncateToByteLength(s, SEGMENT_MAX_BYTES)
      .replace(TRAILING_DOTS_SPACES_RE, "")
      .trim();
  }
  return s;
}

function sanitizeFilenameSegment(segment: string): string {
  let s = segment;
  s = s.replace(ILLEGAL_CHARS_RE, "");
  s = s.replace(REPEATED_WHITESPACE_RE, " ");
  s = s.replace(TRAILING_DOTS_SPACES_RE, "");
  s = s.trim();
  if (byteLength(s) > SEGMENT_MAX_BYTES) {
    s = truncateFilenameSegmentPreservingExtension(s, SEGMENT_MAX_BYTES)
      .replace(TRAILING_DOTS_SPACES_RE, "")
      .trim();
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
  for (const [index, seg] of rawSegments.entries()) {
    if (seg === "." || seg === "..") {
      return null;
    }
    const clean =
      index === rawSegments.length - 1
        ? sanitizeFilenameSegment(seg)
        : sanitizeSegment(seg);
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
 * path within PATH_MAX_BYTES, while preserving the extension.
 * Per-segment truncation already keeps any individual filename component
 * comfortably below common 255-byte filesystem limits, even after yt-dlp
 * appends temporary suffixes like ".part".
 */
export function enforcePathLengthLimit(
  segments: string[]
): string[] {
  if (segments.length === 0) {
    return segments;
  }

  const current = segments.join("/");
  const currentBytes = byteLength(current);
  if (currentBytes <= PATH_MAX_BYTES) {
    return segments;
  }

  const last = segments[segments.length - 1];
  const dotIndex = last.lastIndexOf(".");
  if (dotIndex <= 0) {
    const workingSegments = trimLeadingDirectorySegmentsToFit(
      segments,
      PATH_MAX_BYTES,
      1
    );
    if (byteLength(workingSegments.join("/")) <= PATH_MAX_BYTES) {
      return workingSegments;
    }

    // No recognizable extension; truncate the whole basename
    const prefix = workingSegments.slice(0, -1).join("/");
    const separatorLen = prefix.length > 0 ? 1 : 0;
    const maxBaseBytes =
      PATH_MAX_BYTES - byteLength(prefix) - separatorLen;
    if (maxBaseBytes <= 0) {
      return ["x"];
    }
    const truncated = truncateToByteLength(last, maxBaseBytes)
      .replace(TRAILING_DOTS_SPACES_RE, "")
      .trim();
    return [...workingSegments.slice(0, -1), truncated || "x"];
  }

  const stem = last.slice(0, dotIndex);
  const ext = last.slice(dotIndex); // includes the dot
  const workingSegments = trimLeadingDirectorySegmentsToFit(
    segments,
    PATH_MAX_BYTES,
    byteLength(ext) + 1
  );
  if (byteLength(workingSegments.join("/")) <= PATH_MAX_BYTES) {
    return workingSegments;
  }

  const prefix = workingSegments.slice(0, -1).join("/");
  const separatorLen = prefix.length > 0 ? 1 : 0;
  const maxStemBytes =
    PATH_MAX_BYTES - byteLength(prefix) - separatorLen - byteLength(ext);
  if (maxStemBytes <= 0) {
    return [`x${ext}`];
  }
  const truncatedStem = truncateToByteLength(stem, maxStemBytes)
    .replace(TRAILING_DOTS_SPACES_RE, "")
    .trim();
  const truncatedLast = `${truncatedStem || "x"}${ext}`;
  return [...workingSegments.slice(0, -1), truncatedLast];
}
