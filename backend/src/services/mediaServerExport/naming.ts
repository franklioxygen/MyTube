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

/**
 * Rewrites the `SxxExxx` token of an already-persisted stem, keeping whatever
 * title portion it carries.
 *
 * Promotion moves a collection to another show and season while deliberately
 * carrying each episode's number and stem across, so the mirror filenames stay
 * put and a media server does not see every episode vanish and reappear
 * renamed. The title portion must therefore be reused verbatim - it may hold a
 * de-duplication suffix, or a title from before an edit - but the season token
 * inside it has to follow the new season. Otherwise a collection promoted out
 * of Season 03 writes `Season 01/S03E001 - Title.mp4`, and a media server that
 * reads placement from the token (most of them do) imports the episode into a
 * season that neither the NFO nor the directory agrees with.
 *
 * Returns undefined for a stem that is not in the generated shape, so the
 * caller can fall back to building a fresh one.
 */
export function retokenizeExportStem(
  stem: string,
  seasonNumber: number,
  episodeNumber: number
): string | undefined {
  const match = /^S\d+E\d+(?: - (.+))?$/.exec(stem);
  if (!match) {
    return undefined;
  }

  const token = `S${padSeasonNumber(seasonNumber)}E${padEpisodeNumber(
    episodeNumber
  )}`;
  // Not re-sanitized: it came out of a stem this module already sanitized, and
  // a second pass could strip a de-duplication suffix the planner depends on.
  return match[1] ? `${token} - ${match[1]}` : token;
}

export const SEASON_ZERO_TITLE = "Specials / Unassigned";

export function getSeasonZeroTitle(): string {
  return SEASON_ZERO_TITLE;
}
