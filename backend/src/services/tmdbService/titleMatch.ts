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

/**
 * Strict counterpart to `isConfidentTMDBTitleMatch`, for flows where a wrong
 * match is expensive to undo.
 *
 * The loose gate below accepts "two shared tokens", which is right for a local
 * scan — those filenames already resemble a real title — but wrong for arbitrary
 * user-supplied text. `How Many Ants Live On Earth` shares two tokens with
 * `How To Live On Mars`, and accepting that would name a channel's show after an
 * unrelated film. Because a media-server show directory is allocated once and
 * never renamed, such a mistake is permanent.
 *
 * Accepts only:
 * - an exact normalized match;
 * - a collapsed (whitespace-free) exact match, which covers CJK titles that
 *   differ only in spacing;
 * - a full token subset in either direction, so `Matrix Reloaded` still matches
 *   `The Matrix Reloaded` while sharing *some* tokens is not enough.
 *
 * Substring containment is deliberately excluded: `人民的名义` is a substring of
 * `人民的名义超高清版`, but so is `The Office` of `The Office Christmas Special`.
 * Callers surface near-misses as suggestions instead (design §5.2 rule 4).
 */
export function isHighConfidenceTMDBTitleMatch(
  searchTitle: string,
  item: Partial<TMDBMovieResult & TMDBTVResult & TMDBSearchResult>
): boolean {
  const normalizedSearchTitle = normalizeComparableTitle(searchTitle);
  if (normalizedSearchTitle.length < 2) {
    return false;
  }

  const searchTokens = extractComparableTokens(searchTitle);
  const collapsedSearchTitle = collapseComparableTitle(searchTitle);

  for (const candidateTitle of getResultTitleCandidates(item)) {
    const normalizedCandidateTitle = normalizeComparableTitle(candidateTitle);
    if (!normalizedCandidateTitle) {
      continue;
    }

    if (normalizedCandidateTitle === normalizedSearchTitle) {
      return true;
    }

    const collapsedCandidateTitle = collapseComparableTitle(candidateTitle);
    if (
      collapsedSearchTitle.length >= 2 &&
      collapsedCandidateTitle === collapsedSearchTitle
    ) {
      return true;
    }

    if (searchTokens.length === 0) {
      continue;
    }

    const candidateTokens = extractComparableTokens(candidateTitle);
    if (candidateTokens.length === 0) {
      continue;
    }

    // One-directional on purpose: every search token must appear in the
    // candidate, not the reverse. A shorter candidate matching a longer query
    // means the query carries extra meaningful words the candidate lacks —
    // `The Office` against `The Office Christmas Special` is a different title,
    // not a confident match. Pure-digit tokens are already dropped by
    // extractComparableTokens, so a trailing year does not block a match.
    const candidateTokenSet = new Set(candidateTokens);
    if (searchTokens.every((token) => candidateTokenSet.has(token))) {
      return true;
    }
  }

  return false;
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
