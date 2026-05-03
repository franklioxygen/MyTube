import path from "path";
import { pathExistsSafeSync } from "../../utils/security";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";

/**
 * Returns the first non-conflicting relative path by appending _1, _2, ...
 * to the stem of the basename.  Checks both the filesystem and a set of
 * job-level reserved paths so that two items in the same batch job cannot
 * both claim the same target.
 */
export function dedupeRelativePath(
  relativePath: string,
  baseDir: string,
  reserved: Set<string>
): string {
  if (!isConflicting(relativePath, baseDir, reserved)) {
    return relativePath;
  }

  const dotIdx = relativePath.lastIndexOf(".");
  const stem = dotIdx > 0 ? relativePath.slice(0, dotIdx) : relativePath;
  const ext = dotIdx > 0 ? relativePath.slice(dotIdx) : "";

  let counter = 1;
  while (true) {
    const candidate = `${stem}_${counter}${ext}`;
    if (!isConflicting(candidate, baseDir, reserved)) {
      return candidate;
    }
    counter++;
  }
}

function isConflicting(
  relativePath: string,
  baseDir: string,
  reserved: Set<string>
): boolean {
  if (reserved.has(relativePath)) {
    return true;
  }
  try {
    const allowedBases = [VIDEOS_DIR, IMAGES_DIR, SUBTITLES_DIR];
    // relativePath is sanitized output from sanitizeRelativePath() and the
    // existence check below is bounded by pathExistsSafeSync(allowedBases).
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const absPath = path.join(baseDir, relativePath);
    return pathExistsSafeSync(absPath, allowedBases);
  } catch {
    return false;
  }
}

/**
 * Given a video relative path, returns the matching thumbnail and subtitle
 * relative paths by replacing the stem.  Used after deduplication to keep
 * video, thumbnail, and subtitle names in sync.
 */
export function applyDedupeToRelatedPaths(
  originalVideoRelative: string,
  deduplicatedVideoRelative: string,
  thumbnailRelative: string,
  subtitleBaseRelative: string
): { thumbnail: string; subtitleBase: string } {
  if (originalVideoRelative === deduplicatedVideoRelative) {
    return { thumbnail: thumbnailRelative, subtitleBase: subtitleBaseRelative };
  }

  const origDot = originalVideoRelative.lastIndexOf(".");
  const origStem =
    origDot > 0
      ? originalVideoRelative.slice(0, origDot)
      : originalVideoRelative;

  const newDot = deduplicatedVideoRelative.lastIndexOf(".");
  const newStem =
    newDot > 0
      ? deduplicatedVideoRelative.slice(0, newDot)
      : deduplicatedVideoRelative;

  const suffix = newStem.slice(origStem.length); // e.g. "_1"

  const thumbDot = thumbnailRelative.lastIndexOf(".");
  const thumbStem =
    thumbDot > 0 ? thumbnailRelative.slice(0, thumbDot) : thumbnailRelative;
  const thumbExt = thumbDot > 0 ? thumbnailRelative.slice(thumbDot) : "";
  const newThumb = `${thumbStem}${suffix}${thumbExt}`;

  const newSubtitleBase = `${subtitleBaseRelative}${suffix}`;

  return { thumbnail: newThumb, subtitleBase: newSubtitleBase };
}
