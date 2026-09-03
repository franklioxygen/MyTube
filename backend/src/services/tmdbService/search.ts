import { logger } from "../../utils/logger";
import { mapLanguageToTMDB } from "./constants";
import {
  buildTMDBRequestConfig,
  throwIfTMDBAuthenticationError,
} from "./credentials";
import {
  buildTMDBEndpointPath,
  tmdbHttpClient,
  validateTMDBNumericId,
} from "./httpClient";
import {
  getTMDBTitleMatchStrength,
  isConfidentTMDBTitleMatch,
  TMDB_TITLE_MATCH_EXACT,
  TMDB_TITLE_MATCH_NONE,
} from "./titleMatch";
import type {
  TMDBCrewMember,
  TMDBMediaSearchResult,
  TMDBMovieResult,
  TMDBSearchResult,
  TMDBSingleSearchResult,
  TMDBTVResult,
} from "./types";

/**
 * Search for a movie on TMDB with language support
 */
const ENGLISH_TMDB_LANGUAGE = "en-US";

/**
 * Fetch the same search again in English and index the titles by TMDB id.
 *
 * TMDB's `language` only changes the strings it returns, never which results
 * come back, so the film is already in the localized response - it is the
 * title comparison that fails. Under zh-CN "Anatomy of a Fall" comes back as
 * 坠落的审判 with the original title "Anatomie d'une chute", and a filename
 * naming the film in English matches neither.
 */
async function fetchEnglishTitlesById(
  searchPath: string,
  params: Record<string, string>,
  credential: string
): Promise<Map<number, string[]>> {
  const titlesById = new Map<number, string[]>();

  try {
    const response = await tmdbHttpClient.get(buildTMDBEndpointPath(searchPath), {
      ...buildTMDBRequestConfig(credential, {
        ...params,
        language: ENGLISH_TMDB_LANGUAGE,
      }),
    });

    const results: Array<Record<string, unknown>> = response.data.results || [];
    for (const item of results) {
      if (typeof item.id !== "number") {
        continue;
      }

      const titles = [item.title, item.name, item.original_title, item.original_name]
        .filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0
        );
      if (titles.length > 0) {
        titlesById.set(item.id, titles);
      }
    }
  } catch (error) {
    // A failed English pass just means no extra candidates; the localized
    // result stands on its own.
    logger.info(`[TMDB] English title pass failed for ${searchPath}`);
    void error;
  }

  return titlesById;
}

/**
 * Keep the results that answer `title` best, rather than every result that
 * merely clears the bar. When nothing matches exactly and the search ran in
 * another language, the English titles are fetched and scoring is redone -
 * that is usually where the exact match lives for a film named in English.
 */
async function selectBestTitleMatches<T extends { id: number }>(
  results: T[],
  title: string,
  searchPath: string,
  params: Record<string, string>,
  credential: string,
  tmdbLanguage: string
): Promise<T[]> {
  const scoreAll = (englishTitles?: Map<number, string[]>) =>
    results.map((item) => ({
      item,
      strength: getTMDBTitleMatchStrength(
        title,
        item,
        englishTitles?.get(item.id)
      ),
    }));

  let scored = scoreAll();
  let best = Math.max(TMDB_TITLE_MATCH_NONE, ...scored.map((s) => s.strength));

  if (best < TMDB_TITLE_MATCH_EXACT && tmdbLanguage !== ENGLISH_TMDB_LANGUAGE) {
    const englishTitles = await fetchEnglishTitlesById(
      searchPath,
      params,
      credential
    );
    scored = scoreAll(englishTitles);
    best = Math.max(TMDB_TITLE_MATCH_NONE, ...scored.map((s) => s.strength));
  }

  if (best === TMDB_TITLE_MATCH_NONE) {
    return [];
  }

  return scored.filter((s) => s.strength === best).map((s) => s.item);
}

export async function searchMovie(
  title: string,
  credential: string,
  year?: number,
  language?: string
): Promise<TMDBMovieResult | null> {
  try {
    const tmdbLanguage = mapLanguageToTMDB(language);
    const params: Record<string, string> = {
      query: title,
      language: tmdbLanguage,
    };

    if (year) {
      params.year = year.toString();
    }

    const response = await tmdbHttpClient.get(buildTMDBEndpointPath("/search/movie"), {
      ...buildTMDBRequestConfig(credential, params),
    });

    const results: TMDBMovieResult[] = response.data.results || [];
    if (results.length > 0) {
      const matchedResults = await selectBestTitleMatches(
        results,
        title,
        "/search/movie",
        params,
        credential,
        tmdbLanguage
      );

      if (matchedResults.length === 0) {
        return null;
      }

      // Prefer exact year match if year was provided
      if (year) {
        const yearMatch = matchedResults.find((movie) => {
          if (!movie.release_date) return false;
          const movieYear = parseInt(movie.release_date.substring(0, 4), 10);
          return movieYear === year;
        });
        if (yearMatch) {
          // Fetch full details with language to get localized poster_path and title
          const details = await getMovieDetails(
            yearMatch.id,
            credential,
            tmdbLanguage
          );
          return details?.movie || null;
        }
      }
      // Fetch full details for the first result with language
      const details = await getMovieDetails(
        matchedResults[0].id,
        credential,
        tmdbLanguage
      );
      return details?.movie || null;
    }

    return null;
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
    logger.error(`Error searching TMDB for movie "${title}":`, error);
    return null;
  }
}

/**
 * Get full movie details from TMDB with language support
 * Also fetches credits to get director information
 */
export async function getMovieDetails(
  movieId: number,
  credential: string,
  language: string
): Promise<{ movie: TMDBMovieResult; director?: string } | null> {
  try {
    const safeMovieId = validateTMDBNumericId(movieId);
    // Fetch both movie details and credits in parallel
    const [movieResponse, creditsResponse] = await Promise.all([
      tmdbHttpClient.get(buildTMDBEndpointPath(`/movie/${safeMovieId}`), {
        ...buildTMDBRequestConfig(credential, {
          language,
        }),
      }),
      tmdbHttpClient.get(buildTMDBEndpointPath(`/movie/${safeMovieId}/credits`), {
        ...buildTMDBRequestConfig(credential, {
          language,
        }),
      }),
    ]);

    const movie = movieResponse.data as TMDBMovieResult;

    // Extract director from crew
    let director: string | undefined;
    const crew = Array.isArray(creditsResponse.data?.crew)
      ? (creditsResponse.data.crew as TMDBCrewMember[])
      : [];
    if (crew.length > 0) {
      const directorCrew = crew.find(
        (member) => member.job === "Director"
      );
      if (directorCrew && directorCrew.name) {
        director = directorCrew.name;
      }
    }

    return { movie, director };
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
    logger.error(`Error fetching TMDB movie details for ID ${movieId}:`, error);
    return null;
  }
}

/**
 * Search for a TV show on TMDB with language support
 */
export async function searchTVShow(
  title: string,
  credential: string,
  language?: string
): Promise<TMDBTVResult | null> {
  try {
    const tmdbLanguage = mapLanguageToTMDB(language);
    const params: Record<string, string> = {
      query: title,
      language: tmdbLanguage,
    };
    const response = await tmdbHttpClient.get(buildTMDBEndpointPath("/search/tv"), {
      ...buildTMDBRequestConfig(credential, params),
    });

    const results: TMDBTVResult[] = response.data.results || [];
    if (results.length > 0) {
      const matchedResults = await selectBestTitleMatches(
        results,
        title,
        "/search/tv",
        params,
        credential,
        tmdbLanguage
      );

      if (matchedResults.length === 0) {
        return null;
      }

      // Fetch full details with language to get localized poster_path and title
      const details = await getTVShowDetails(
        matchedResults[0].id,
        credential,
        tmdbLanguage
      );
      return details?.tv || null;
    }

    return null;
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
    logger.error(`Error searching TMDB for TV show "${title}":`, error);
    return null;
  }
}

/**
 * Get full TV show details from TMDB with language support
 * Also fetches credits to get creator/director information
 */
export async function getTVShowDetails(
  tvId: number,
  credential: string,
  language: string
): Promise<{ tv: TMDBTVResult; director?: string } | null> {
  try {
    const safeTvId = validateTMDBNumericId(tvId);
    // Fetch both TV show details and credits in parallel
    const [tvResponse, creditsResponse] = await Promise.all([
      tmdbHttpClient.get(buildTMDBEndpointPath(`/tv/${safeTvId}`), {
        ...buildTMDBRequestConfig(credential, {
          language,
        }),
      }),
      tmdbHttpClient.get(buildTMDBEndpointPath(`/tv/${safeTvId}/credits`), {
        ...buildTMDBRequestConfig(credential, {
          language,
        }),
      }),
    ]);

    const tv = tvResponse.data as TMDBTVResult;

    // Extract director/creator from TV show
    // Priority: 1) Creator from created_by array, 2) Director from crew
    let director: string | undefined;
    const crew = Array.isArray(creditsResponse.data?.crew)
      ? (creditsResponse.data.crew as TMDBCrewMember[])
      : [];

    // First, try to get creator from created_by array
    if (tv.created_by && tv.created_by.length > 0 && tv.created_by[0].name) {
      director = tv.created_by[0].name;
    } else if (crew.length > 0) {
      // Fallback to director from crew
      const directorCrew = crew.find(
        (member) => member.job === "Director" || member.job === "Executive Producer"
      );
      if (directorCrew && directorCrew.name) {
        director = directorCrew.name;
      }
    }

    return { tv, director };
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
    logger.error(`Error fetching TMDB TV show details for ID ${tvId}:`, error);
    return null;
  }
}

function buildMultiSearchParams(
  title: string,
  tmdbLanguage: string,
  year?: number
): Record<string, string> {
  const params: Record<string, string> = {
    query: title,
    language: tmdbLanguage,
  };
  if (year) {
    params.year = year.toString();
  }
  return params;
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

// Title-match strength outranks the year/popularity score: a companion
// making-of shares the film's year and can outscore it, but only the film
// itself carries the exact title.
function pickBestMultiSearchResult(
  results: TMDBSearchResult[],
  queryTitle: string,
  year?: number,
  englishTitles?: Map<number, string[]>
): { match: TMDBMediaSearchResult | null; strength: number } {
  let bestMatch: TMDBMediaSearchResult | null = null;
  let bestStrength = TMDB_TITLE_MATCH_NONE;
  let bestScore = -1;

  for (const item of results) {
    if (!isTMDBMediaSearchResult(item)) {
      continue;
    }

    const mediaItem = item as TMDBMediaSearchResult;
    const strength = getTMDBTitleMatchStrength(
      queryTitle,
      mediaItem,
      englishTitles?.get(mediaItem.id)
    );
    if (strength === TMDB_TITLE_MATCH_NONE) {
      continue;
    }

    const score = scoreMultiSearchResult(mediaItem, year);
    if (
      strength > bestStrength ||
      (strength === bestStrength && score > bestScore)
    ) {
      bestStrength = strength;
      bestScore = score;
      bestMatch = mediaItem;
    }
  }

  return { match: bestMatch, strength: bestStrength };
}

async function fetchTMDBSearchDetails(
  bestMatch: TMDBMediaSearchResult,
  credential: string,
  tmdbLanguage: string
): Promise<TMDBSingleSearchResult | null> {
  if (bestMatch.media_type === "movie") {
    const movieDetails = await getMovieDetails(
      bestMatch.id,
      credential,
      tmdbLanguage
    );
    if (movieDetails?.movie) {
      return {
        result: movieDetails.movie,
        mediaType: "movie",
        director: movieDetails.director,
      };
    }
    return null;
  }

  const tvDetails = await getTVShowDetails(bestMatch.id, credential, tmdbLanguage);
  if (tvDetails?.tv) {
    return {
      result: tvDetails.tv,
      mediaType: "tv",
      director: tvDetails.director,
    };
  }
  return null;
}

function buildTMDBSearchFallbackResult(
  bestMatch: TMDBMediaSearchResult
): TMDBSingleSearchResult {
  if (bestMatch.media_type === "movie") {
    return {
      result: {
        id: bestMatch.id,
        title: bestMatch.title || "",
        release_date: bestMatch.release_date,
        overview: bestMatch.overview,
        poster_path: bestMatch.poster_path,
        backdrop_path: bestMatch.backdrop_path,
        vote_average: bestMatch.vote_average,
      },
      mediaType: "movie",
    };
  }

  return {
    result: {
      id: bestMatch.id,
      name: bestMatch.name || "",
      first_air_date: bestMatch.first_air_date,
      overview: bestMatch.overview,
      poster_path: bestMatch.poster_path,
      backdrop_path: bestMatch.backdrop_path,
      vote_average: bestMatch.vote_average,
    },
    mediaType: "tv",
  };
}

/**
 * Search TMDB using multi-search API (searches both movies and TV simultaneously)
 * Returns localized results based on language parameter
 */
export async function searchTMDBSingle(
  title: string,
  credential: string,
  year?: number,
  language?: string
): Promise<TMDBSingleSearchResult> {
  try {
    const tmdbLanguage = mapLanguageToTMDB(language);
    const params = buildMultiSearchParams(title, tmdbLanguage, year);
    const response = await tmdbHttpClient.get(buildTMDBEndpointPath("/search/multi"), {
      ...buildTMDBRequestConfig(credential, params),
    });

    const results: TMDBSearchResult[] = response.data.results || [];
    let picked = pickBestMultiSearchResult(results, title, year);

    // Not just when nothing matched: a loose match here is often a companion
    // release, while the film's own English title matches exactly.
    if (
      picked.strength < TMDB_TITLE_MATCH_EXACT &&
      results.length > 0 &&
      tmdbLanguage !== ENGLISH_TMDB_LANGUAGE
    ) {
      const englishTitles = await fetchEnglishTitlesById(
        "/search/multi",
        params,
        credential
      );
      const withEnglish = pickBestMultiSearchResult(
        results,
        title,
        year,
        englishTitles
      );
      if (withEnglish.strength > picked.strength) {
        picked = withEnglish;
      }
    }

    const bestMatch = picked.match;
    if (!bestMatch) {
      return { result: null, mediaType: null };
    }

    const detailsResult = await fetchTMDBSearchDetails(
      bestMatch,
      credential,
      tmdbLanguage
    );
    if (detailsResult) {
      return detailsResult;
    }

    return buildTMDBSearchFallbackResult(bestMatch);
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
    logger.error(`Error searching TMDB multi for "${title}":`, error);
    return { result: null, mediaType: null };
  }
}
