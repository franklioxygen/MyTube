import {
  replaceSegmentSeparators,
  sanitizeSegment,
} from "../filenameTemplate/sanitize";

/**
 * Pure path-naming rules for the playlist-TV mirror (issue #411).
 *
 * Deliberately free of any database or filesystem import so both the pure
 * planner and the allocating catalog repository can use the same rules.
 */

/**
 * Sanitizes arbitrary metadata text into ONE mirror path segment.
 *
 * `sanitizeSegment` alone is not enough: the filename-template pipeline strips
 * path separators in a separate `replaceSegmentSeparators` step beforehand, so
 * calling it directly would let a title like "../../etc" survive into a
 * directory name. Separators become spaces, traversal sequences are removed, and
 * the result is length-capped for common filesystems.
 */
export function sanitizeMirrorSegment(value: string): string {
  if (typeof value !== "string") {
    return "";
  }

  return sanitizeSegment(
    replaceSegmentSeparators(value.replace(/\0/g, "")).replace(/\.\./g, "")
  ).trim();
}

export function padSeasonNumber(seasonNumber: number): string {
  return String(seasonNumber).padStart(2, "0");
}

export function padEpisodeNumber(episodeNumber: number): string {
  // Padding is a minimum, not a truncation: episode 1000 renders E1000.
  return String(episodeNumber).padStart(3, "0");
}

/**
 * `S03E012 - The Egg`. Persisted once per assignment so a later title edit
 * rewrites the NFO without churning any path.
 */
export function buildExportStem(
  seasonNumber: number,
  episodeNumber: number,
  title: string
): string {
  const token = `S${padSeasonNumber(seasonNumber)}E${padEpisodeNumber(
    episodeNumber
  )}`;
  const safeTitle = sanitizeMirrorSegment(title || "");
  return safeTitle ? `${token} - ${safeTitle}` : token;
}

export const SEASON_ZERO_TITLE = "Specials / Unassigned";

export function getSeasonZeroTitle(): string {
  return SEASON_ZERO_TITLE;
}
