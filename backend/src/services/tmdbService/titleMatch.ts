import type {
  TMDBMovieResult,
  TMDBSearchResult,
  TMDBTVResult,
} from "./types";

function normalizeComparableTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractComparableTokens(value: string): string[] {
  return normalizeComparableTitle(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token));
}

function collapseComparableTitle(value: string): string {
  return normalizeComparableTitle(value).replace(/\s+/g, "");
}

function getResultTitleCandidates(
  item: Partial<TMDBMovieResult & TMDBTVResult & TMDBSearchResult>,
  extraTitles: readonly string[] = []
): string[] {
  return [
    ...new Set(
      [
        item.title,
        item.original_title,
        item.name,
        item.original_name,
        ...extraTitles,
      ].filter((value): value is string => Boolean(value && value.trim()))
    ),
  ];
}

/**
 * `extraTitles` carries titles the response itself does not hold - notably the
 * English ones when results were fetched in another language. TMDB returns the
 * localized title plus the original-language title, so a release filename
 * naming a film in English matches neither when the film was shot in a third
 * language.
 */
/** No title on the result is close enough to the search title. */
export const TMDB_TITLE_MATCH_NONE = 0;
/** One title contains the other, or they share enough words. */
export const TMDB_TITLE_MATCH_LOOSE = 1;
/** A title is the search title. */
export const TMDB_TITLE_MATCH_EXACT = 2;

/**
 * How well a result answers the search title, so callers can prefer the best
 * rather than settle for the first that clears the bar. The distinction
 * matters: searching "All Quiet on the Western Front" also returns "Making All
 * Quiet on the Western Front", which contains the query and would otherwise be
 * just as acceptable as the film itself.
 */
export function getTMDBTitleMatchStrength(
  searchTitle: string,
  item: Partial<TMDBMovieResult & TMDBTVResult & TMDBSearchResult>,
  extraTitles: readonly string[] = []
): number {
  const normalizedSearchTitle = normalizeComparableTitle(searchTitle);
  if (normalizedSearchTitle.length < 2) {
    return TMDB_TITLE_MATCH_NONE;
  }

  const searchTokens = extractComparableTokens(searchTitle);
  let bestStrength = TMDB_TITLE_MATCH_NONE;

  for (const candidateTitle of getResultTitleCandidates(item, extraTitles)) {
    const normalizedCandidateTitle = normalizeComparableTitle(candidateTitle);
    if (!normalizedCandidateTitle) {
      continue;
    }

    const collapsedSearchTitle = collapseComparableTitle(searchTitle);
    const collapsedCandidateTitle = collapseComparableTitle(candidateTitle);

    if (normalizedCandidateTitle === normalizedSearchTitle) {
      return TMDB_TITLE_MATCH_EXACT;
    }

    if (
      collapsedSearchTitle.length >= 4 &&
      collapsedCandidateTitle === collapsedSearchTitle
    ) {
      return TMDB_TITLE_MATCH_EXACT;
    }

    const shorterComparableLength = Math.min(
      normalizedSearchTitle.length,
      normalizedCandidateTitle.length
    );
    if (
      shorterComparableLength >= 4 &&
      (
        normalizedCandidateTitle.includes(normalizedSearchTitle) ||
        normalizedSearchTitle.includes(normalizedCandidateTitle)
      )
    ) {
      bestStrength = TMDB_TITLE_MATCH_LOOSE;
      continue;
    }

    if (searchTokens.length === 0) {
      continue;
    }

    const candidateTokens = new Set(extractComparableTokens(candidateTitle));
    const matchedTokens = searchTokens.filter((token) =>
      candidateTokens.has(token)
    );

    if (
      matchedTokens.length === searchTokens.length ||
      (searchTokens.length >= 2 && matchedTokens.length >= 2)
    ) {
      bestStrength = TMDB_TITLE_MATCH_LOOSE;
    }
  }

  return bestStrength;
}

export function isConfidentTMDBTitleMatch(
  searchTitle: string,
  item: Partial<TMDBMovieResult & TMDBTVResult & TMDBSearchResult>,
  extraTitles: readonly string[] = []
): boolean {
  return (
    getTMDBTitleMatchStrength(searchTitle, item, extraTitles) >
    TMDB_TITLE_MATCH_NONE
  );
}
