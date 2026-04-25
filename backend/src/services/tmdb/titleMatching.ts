import type { TMDBMovieResult, TMDBSearchResult, TMDBTVResult } from "./types";

export type TMDBMediaSearchResult = TMDBSearchResult & {
  media_type: "movie" | "tv";
};

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
  item: Partial<TMDBMovieResult & TMDBTVResult & TMDBSearchResult>
): string[] {
  return [
    ...new Set(
      [
        item.title,
        item.original_title,
        item.name,
        item.original_name,
      ].filter((value): value is string => Boolean(value && value.trim()))
    ),
  ];
}

export function isConfidentTMDBTitleMatch(
  searchTitle: string,
  item: Partial<TMDBMovieResult & TMDBTVResult & TMDBSearchResult>
): boolean {
  const normalizedSearchTitle = normalizeComparableTitle(searchTitle);
  if (normalizedSearchTitle.length < 2) {
    return false;
  }

  const searchTokens = extractComparableTokens(searchTitle);

  for (const candidateTitle of getResultTitleCandidates(item)) {
    const normalizedCandidateTitle = normalizeComparableTitle(candidateTitle);
    if (!normalizedCandidateTitle) {
      continue;
    }

    const collapsedSearchTitle = collapseComparableTitle(searchTitle);
    const collapsedCandidateTitle = collapseComparableTitle(candidateTitle);

    if (normalizedCandidateTitle === normalizedSearchTitle) {
      return true;
    }

    if (
      collapsedSearchTitle.length >= 4 &&
      collapsedCandidateTitle === collapsedSearchTitle
    ) {
      return true;
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
      return true;
    }

    if (searchTokens.length === 0) {
      continue;
    }

    const candidateTokens = new Set(extractComparableTokens(candidateTitle));
    const matchedTokens = searchTokens.filter((token) =>
      candidateTokens.has(token)
    );

    if (matchedTokens.length === searchTokens.length) {
      return true;
    }

    if (searchTokens.length >= 2 && matchedTokens.length >= 2) {
      return true;
    }
  }

  return false;
}

function isTMDBMediaSearchResult(
  item: TMDBSearchResult
): boolean {
  return item.media_type === "movie" || item.media_type === "tv";
}

function extractMediaResultYear(item: TMDBMediaSearchResult): number | undefined {
  const date =
    item.media_type === "movie" ? item.release_date : item.first_air_date;
  if (!date || date.length < 4) {
    return undefined;
  }

  const itemYear = parseInt(date.substring(0, 4), 10);
  return Number.isNaN(itemYear) ? undefined : itemYear;
}

function getYearMatchScore(item: TMDBMediaSearchResult, year?: number): number {
  if (!year) {
    return 0;
  }

  const itemYear = extractMediaResultYear(item);
  if (itemYear === undefined) {
    return 0;
  }
  if (itemYear === year) {
    return 100;
  }
  if (Math.abs(itemYear - year) <= 1) {
    return 50;
  }
  return 0;
}

function scoreMultiSearchResult(item: TMDBMediaSearchResult, year?: number): number {
  let score = (item.popularity || 0) * 0.5;
  score += getYearMatchScore(item, year);
  if (item.vote_average) {
    score += item.vote_average * 10;
  }
  return score;
}

export function pickBestMultiSearchResult(
  results: TMDBSearchResult[],
  queryTitle: string,
  year?: number
): TMDBMediaSearchResult | null {
  let bestMatch: TMDBMediaSearchResult | null = null;
  let bestScore = -1;

  for (const item of results) {
    if (!isTMDBMediaSearchResult(item)) {
      continue;
    }

    const mediaItem = item as TMDBMediaSearchResult;
    if (!isConfidentTMDBTitleMatch(queryTitle, mediaItem)) {
      continue;
    }

    const score = scoreMultiSearchResult(mediaItem, year);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = mediaItem;
    }
  }

  return bestMatch;
}
