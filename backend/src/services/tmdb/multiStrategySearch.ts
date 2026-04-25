import { logger } from "../../utils/logger";
import { getSearchTitlePriority, type ParsedFilename } from "./filenameParser";
import {
  TMDBAuthenticationError,
  hashTMDBCredential,
  mapLanguageToTMDB,
} from "./client";
import {
  getMovieDetails,
  getTVShowDetails,
  searchMovie,
  searchTMDBSingle,
  searchTVShow,
} from "./searchApi";
import type { MultiStrategySearchResult } from "./types";

const TMDB_SEARCH_CACHE_MAX_ENTRIES = 500;
const TMDB_SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
const TMDB_NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const tmdbSearchCache = new Map<string, CacheEntry<MultiStrategySearchResult>>();
const tmdbSearchInFlight = new Map<string, Promise<MultiStrategySearchResult>>();

const getCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | undefined => {
  const cached = cache.get(key);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return cached.value;
};

const setCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number
): void => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  if (cache.size <= maxEntries) {
    return;
  }

  const oldestKey = cache.keys().next().value;
  if (oldestKey) {
    cache.delete(oldestKey);
  }
};

const buildSearchCacheKey = (
  parsed: ParsedFilename,
  credential: string,
  language?: string
): string => {
  const normalizedTitles = parsed.titles
    .map((title) => title.trim().toLowerCase())
    .sort();

  return JSON.stringify({
    titles: normalizedTitles,
    year: parsed.year ?? null,
    season: parsed.season ?? null,
    episode: parsed.episode ?? null,
    isTVShow: parsed.isTVShow,
    language: mapLanguageToTMDB(language),
    credentialHash: hashTMDBCredential(credential),
  });
};

/**
 * Multi-strategy search for TMDB metadata using fallback mechanisms
 * Tries multiple titles and search strategies to find best match
 * Supports language parameter for localized results
 */
async function searchTMDBMultiStrategyUncached(
  parsed: ParsedFilename,
  credential: string,
  language?: string
): Promise<MultiStrategySearchResult> {
  const titles = parsed.titles.length > 0 ? parsed.titles : ["Unknown"];

  logger.info(
    `[TMDB Multi-Strategy] Searching with ${
      titles.length
    } title(s): ${titles.join(", ")}, Year: ${
      parsed.year || "N/A"
    }, Language: ${language || "en"}`
  );

  try {
    // Strategy 1: Try TMDB multi-search API with each title + year (most efficient)
    // Prefer pure CJK titles first, then bilingual titles, then longer English titles.
    const sortedTitles = [...titles].sort((a, b) => {
      const priorityDiff = getSearchTitlePriority(a) - getSearchTitlePriority(b);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return b.length - a.length;
    });

    if (parsed.year && sortedTitles.length > 0) {
      // Try each title with year (prioritize longer/multi-word)
      for (const title of sortedTitles) {
        logger.info(
          `[TMDB Multi-Strategy] Strategy 1: Multi-search with "${title}" + year ${parsed.year}`
        );
        const multiResult = await searchTMDBSingle(
          title,
          credential,
          parsed.year,
          language
        );
        if (multiResult.result) {
          // Verify the match makes sense (year should be close)
          let yearMatch = true;
          if (
            multiResult.mediaType === "movie" &&
            "release_date" in multiResult.result &&
            multiResult.result.release_date
          ) {
            const resultYear = parseInt(
              multiResult.result.release_date.substring(0, 4),
              10
            );
            yearMatch =
              resultYear === parsed.year ||
              Math.abs(resultYear - parsed.year) <= 1;
          } else if (
            multiResult.mediaType === "tv" &&
            "first_air_date" in multiResult.result &&
            multiResult.result.first_air_date
          ) {
            const resultYear = parseInt(
              multiResult.result.first_air_date.substring(0, 4),
              10
            );
            yearMatch =
              resultYear === parsed.year ||
              Math.abs(resultYear - parsed.year) <= 1;
          }

          if (yearMatch) {
            logger.info(
              `[TMDB Multi-Strategy] Strategy 1 succeeded: Found ${multiResult.mediaType} match for "${title}"`
            );
            return { ...multiResult, strategy: "multi-search-with-year" };
          } else {
            logger.info(
              `[TMDB Multi-Strategy] Strategy 1: Year mismatch for "${title}", trying next title...`
            );
          }
        }
      }
    }

    // Strategy 2: Try each title with year on dedicated endpoints
    for (const title of titles) {
      if (parsed.year) {
        if (parsed.isTVShow) {
          logger.info(
            `[TMDB Multi-Strategy] Strategy 2a: TV search "${title}" + year ${parsed.year}`
          );
          const tvResult = await searchTVShow(title, credential, language);
          if (tvResult && tvResult.first_air_date) {
            const resultYear = parseInt(
              tvResult.first_air_date.substring(0, 4),
              10
            );
            if (
              resultYear === parsed.year ||
              Math.abs(resultYear - parsed.year) <= 1
            ) {
              logger.info(
                `[TMDB Multi-Strategy] Strategy 2a succeeded: Found TV match`
              );
              // Get director from full details
              const details = await getTVShowDetails(
                tvResult.id,
                credential,
                mapLanguageToTMDB(language)
              );
              return {
                result: tvResult,
                mediaType: "tv",
                strategy: "tv-search-with-year",
                director: details?.director,
              };
            }
          }
        } else {
          logger.info(
            `[TMDB Multi-Strategy] Strategy 2b: Movie search "${title}" + year ${parsed.year}`
          );
          const movieResult = await searchMovie(
            title,
            credential,
            parsed.year,
            language
          );
          if (movieResult) {
            logger.info(
              `[TMDB Multi-Strategy] Strategy 2b succeeded: Found movie match`
            );
            // Get director from full details
            const details = await getMovieDetails(
              movieResult.id,
              credential,
              mapLanguageToTMDB(language)
            );
            return {
              result: movieResult,
              mediaType: "movie",
              strategy: "movie-search-with-year",
              director: details?.director,
            };
          }
        }
      }
    }

    // Strategy 3: Try TMDB multi-search without year constraint
    for (const title of titles) {
      logger.info(
        `[TMDB Multi-Strategy] Strategy 3: Multi-search "${title}" (no year)`
      );
      const multiResult = await searchTMDBSingle(
        title,
        credential,
        undefined,
        language
      );
      if (multiResult.result) {
        logger.info(
          `[TMDB Multi-Strategy] Strategy 3 succeeded: Found ${multiResult.mediaType} match`
        );
        return { ...multiResult, strategy: "multi-search-no-year" };
      }
    }

    // Strategy 4: Try each title without year on dedicated endpoints
    for (const title of titles) {
      if (parsed.isTVShow) {
        logger.info(
          `[TMDB Multi-Strategy] Strategy 4a: TV search "${title}" (no year)`
        );
        const tvResult = await searchTVShow(title, credential, language);
        if (tvResult) {
          logger.info(
            `[TMDB Multi-Strategy] Strategy 4a succeeded: Found TV match`
          );
          // Get director from full details
          const details = await getTVShowDetails(
            tvResult.id,
            credential,
            mapLanguageToTMDB(language)
          );
          return {
            result: tvResult,
            mediaType: "tv",
            strategy: "tv-search-no-year",
            director: details?.director,
          };
        }
      } else {
        logger.info(
          `[TMDB Multi-Strategy] Strategy 4b: Movie search "${title}" (no year)`
        );
        const movieResult = await searchMovie(
          title,
          credential,
          undefined,
          language
        );
        if (movieResult) {
          logger.info(
            `[TMDB Multi-Strategy] Strategy 4b succeeded: Found movie match`
          );
          // Get director from full details
          const details = await getMovieDetails(
            movieResult.id,
            credential,
            mapLanguageToTMDB(language)
          );
          return {
            result: movieResult,
            mediaType: "movie",
            strategy: "movie-search-no-year",
            director: details?.director,
          };
        }
      }
    }

    // Strategy 5: Fuzzy matching - try simplified titles (remove special characters)
    for (const title of titles) {
      const simplifiedTitle = title.replace(/[^\w\s\u4e00-\u9fff]/g, "").trim();
      if (simplifiedTitle !== title && simplifiedTitle.length >= 3) {
        logger.info(
          `[TMDB Multi-Strategy] Strategy 5: Fuzzy search "${simplifiedTitle}"`
        );
        const fuzzyResult = await searchTMDBSingle(
          simplifiedTitle,
          credential,
          parsed.year,
          language
        );
        if (fuzzyResult.result) {
          logger.info(
            `[TMDB Multi-Strategy] Strategy 5 succeeded: Found ${fuzzyResult.mediaType} match`
          );
          return { ...fuzzyResult, strategy: "fuzzy-search" };
        }
      }
    }
  } catch (error) {
    if (error instanceof TMDBAuthenticationError) {
      logger.error(
        `[TMDB Multi-Strategy] Authentication failed: ${error.message}`
      );
      return { result: null, mediaType: null, strategy: "auth-failed" };
    }
    throw error;
  }

  logger.info(`[TMDB Multi-Strategy] All strategies failed for filename`);
  return { result: null, mediaType: null, strategy: "all-failed" };
}

function createTMDBMultiStrategySearchPromise(
  cacheKey: string,
  parsed: ParsedFilename,
  apiKey: string,
  language?: string
): Promise<MultiStrategySearchResult> {
  return searchTMDBMultiStrategyUncached(parsed, apiKey, language)
    .then((searchResult) => {
      const ttl = searchResult.result
        ? TMDB_SEARCH_CACHE_TTL_MS
        : TMDB_NEGATIVE_CACHE_TTL_MS;

      setCachedValue(
        tmdbSearchCache,
        cacheKey,
        searchResult,
        ttl,
        TMDB_SEARCH_CACHE_MAX_ENTRIES
      );
      return searchResult;
    })
    .finally(() => {
      tmdbSearchInFlight.delete(cacheKey);
    });
}

export function searchTMDBMultiStrategy(
  parsed: ParsedFilename,
  apiKey: string,
  language?: string
): Promise<MultiStrategySearchResult> {
  const cacheKey = buildSearchCacheKey(parsed, apiKey, language);
  const cached = getCachedValue(tmdbSearchCache, cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const inFlight = tmdbSearchInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const searchPromise = createTMDBMultiStrategySearchPromise(
    cacheKey,
    parsed,
    apiKey,
    language
  );

  tmdbSearchInFlight.set(cacheKey, searchPromise);
  return searchPromise;
}
