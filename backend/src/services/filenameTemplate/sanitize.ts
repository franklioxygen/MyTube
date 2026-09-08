const SEGMENT_MAX_BYTES = 180;
const PATH_MAX_BYTES = 240;
/**
 * Ceiling for a single on-disk filename, in UTF-8 bytes: NAME_MAX on ext4, and
 * the point past which a name cannot be created at all.
 *
 * Deliberately the hard limit rather than something lower with headroom. This
 * budget only ever shortens a name, so anything below 255 would also shorten
 * names in that gap - names that already exist on disk, since they were
 * creatable. A redownload would then compute a path the existing file does not
 * have, orphan it, and write a duplicate alongside. Trimming only above 255
 * touches names that could never have been written in the first place.
 *
 * Distinct from SEGMENT_MAX_BYTES, which is the budget the renderer gives a
 * name it is composing. This one is the limit a name must still respect after
 * a later stage appends to it. It leaves no room for the ".part" yt-dlp adds
 * while downloading to a final name, which is a separate pre-existing limit of
 * the sanitizer's own caps and not something this budget can address without
 * renaming existing files.
 */
const FILENAME_MAX_BYTES = 255;
const ILLEGAL_CHARS_RE = /[<>:"|?*\x00]/g;
const TRAILING_DOTS_SPACES_RE = /[. ]+$/;
const REPEATED_WHITESPACE_RE = /\s+/g;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Same result as replacing TRAILING_DOTS_SPACES_RE, in a single backward walk.
 * That regex is quadratic on a run of trailing spaces, which CodeQL flags when
 * the input traces back to a title; the strings here are already truncated to a
 * filename's worth of bytes, but a linear pass costs nothing and needs no
 * argument about bounds.
 */
function stripTrailingDotsAndSpaces(value: string): string {
  let end = value.length;
  while (end > 0) {
    const ch = value[end - 1];
    if (ch !== "." && ch !== " ") {
      break;
    }
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
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

/**
 * Bytes left for a stem once `suffix` and `reservedTailBytes` are accounted for
 * within FILENAME_MAX_BYTES. Zero or less means no name carrying that suffix
 * can be created, however short the stem is cut.
 */
export function stemBudgetForSuffix(
  suffix: string,
  reservedTailBytes: number
): number {
  return FILENAME_MAX_BYTES - byteLength(suffix) - reservedTailBytes;
}

/**
 * Trims the stem of `relativePath`'s final segment so that a filename built as
 * `stem + suffix + <tail>` stays within FILENAME_MAX_BYTES. Directories and the
 * path's own extension are left untouched, and a path that already fits is
 * returned unchanged. The caller appends `suffix` itself.
 *
 * The stem is what gives way rather than the suffix: callers append a suffix to
 * make a colliding name unique, so trimming the suffix would hand back a name
 * that collides all over again.
 *
 * `reservedTailBytes` is a byte count rather than this path's own extension so
 * that one output family - video, thumbnail, and the extension-less subtitle
 * base - can be trimmed against a single shared budget wide enough for the
 * longest tail any of them will grow, and still keep a common stem. A subtitle
 * base ends up carrying `.<lang><ext>`, which outruns the video's `.mp4`.
 *
 * `ownExtension` is stated rather than guessed from the last dot, and "" says
 * this path has none. A subtitle base is extensionless while its title is full
 * of dots - the legacy formatter writes spaces as dots - so guessing hands back
 * a stem measured short by whatever followed the final one, which both overruns
 * the limit and leaves the base out of step with the video it must match.
 *
 * Callers must check stemBudgetForSuffix first: with no budget left there is no
 * name to return, and this returns the path unchanged rather than inventing one.
 */
export function trimRelativePathStemForSuffix(
  relativePath: string,
  suffix: string,
  reservedTailBytes: number,
  ownExtension: string
): string {
  const maxStemBytes = stemBudgetForSuffix(suffix, reservedTailBytes);
  if (maxStemBytes <= 0) {
    return relativePath;
  }

  const slashIdx = relativePath.lastIndexOf("/");
  const dir = relativePath.slice(0, slashIdx + 1);
  const filename = relativePath.slice(slashIdx + 1);
  const stem =
    ownExtension && filename.endsWith(ownExtension)
      ? filename.slice(0, filename.length - ownExtension.length)
      : filename;
  if (byteLength(stem) <= maxStemBytes) {
    return relativePath;
  }

  const trimmedStem = stripTrailingDotsAndSpaces(
    truncateToByteLength(stem, maxStemBytes)
  ).trim();
  return `${dir}${trimmedStem || "x"}${ownExtension}`;
}
