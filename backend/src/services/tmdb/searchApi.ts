import { logger } from "../../utils/logger";
import {
  buildTMDBEndpointPath,
  buildTMDBRequestConfig,
  mapLanguageToTMDB,
  throwIfTMDBAuthenticationError,
  tmdbHttpClient,
  validateTMDBNumericId,
} from "./client";
import {
  isConfidentTMDBTitleMatch,
  pickBestMultiSearchResult,
  type TMDBMediaSearchResult,
} from "./titleMatching";
import type { TMDBCrewMember, TMDBMovieResult, TMDBSearchResult, TMDBTVResult } from "./types";

/**
 * Search for a movie on TMDB with language support
 */
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
      const matchedResults = results.filter((movie) =>
        isConfidentTMDBTitleMatch(title, movie)
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
    const response = await tmdbHttpClient.get(buildTMDBEndpointPath("/search/tv"), {
      ...buildTMDBRequestConfig(credential, {
        query: title,
        language: tmdbLanguage,
      }),
    });

    const results: TMDBTVResult[] = response.data.results || [];
    if (results.length > 0) {
      const matchedResults = results.filter((tvShow) =>
        isConfidentTMDBTitleMatch(title, tvShow)
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

export type TMDBSingleSearchResult = {
  result: TMDBMovieResult | TMDBTVResult | null;
  mediaType: "movie" | "tv" | null;
  director?: string;
};

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
    const bestMatch = pickBestMultiSearchResult(results, title, year);
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
