import { logger } from "../../utils/logger";
import { getSettings } from "../storageService/settings";
import { mapLanguageToTMDB } from "./constants";
import {
  buildTMDBRequestConfig,
  normalizeTMDBCredential,
  throwIfTMDBAuthenticationError,
} from "./credentials";
import {
  buildTMDBEndpointPath,
  tmdbHttpClient,
  validateTMDBNumericId,
} from "./httpClient";
import { getMovieDetails, getTVShowDetails } from "./search";
import { isHighConfidenceTMDBTitleMatch } from "./titleMatch";
import type {
  TMDBMediaSearchResult,
  TMDBMovieResult,
  TMDBSearchResult,
  TMDBTVResult,
} from "./types";

/**
 * Collection-scoped TMDB lookup for the collection-as-show feature.
 *
 * Deliberately does NOT wrap `searchTMDBMultiStrategy()`. That function is built
 * for the local-file scan: it runs seven fallback strategies including a
 * transformed fuzzy query, filters with the looser scan-flow predicate, and
 * returns a single winner. All three are wrong here — the user must see and
 * confirm candidates, and a silently transformed query is exactly how a wrong
 * show identity gets allocated permanently.
 *
 * This module issues ONE multi-search with the literal query, drops `person`
 * results, and returns a bounded, annotated candidate list. Nothing is applied
 * automatically; `highConfidence` only affects ranking and labeling.
 */

/** Bounded so one lookup cannot return an unbounded API payload. */
export const MAX_COLLECTION_SEARCH_CANDIDATES = 10;

export type CollectionSearchCandidate = {
  tmdbId: number;
  mediaType: "tv" | "movie";
  title: string;
  originalTitle?: string;
  overview?: string;
  premiereDate?: string;
  posterPath?: string;
  /** Passed the strict gate. Ranking/labeling only — never auto-applied. */
  highConfidence: boolean;
};

export type CollectionSearchResult =
  | { status: "ok"; candidates: CollectionSearchCandidate[] }
  | { status: "no_credential" }
  | { status: "no_results" };

export type ResolvedCollectionMetadata = {
  tmdbId: number;
  mediaType: "tv" | "movie";
  title: string;
  overview?: string;
  premiereDate?: string;
  /** Remote TMDB path, e.g. "/abc.jpg". Downloading is the caller's job. */
  posterPath?: string;
};

function getCredential(): string {
  const settings = getSettings() as { tmdbApiKey?: string };
  return normalizeTMDBCredential(
    settings.tmdbApiKey || process.env.TMDB_API_KEY || ""
  );
}

export function hasTMDBCredential(): boolean {
  return getCredential().length > 0;
}

function getLanguage(): string {
  const settings = getSettings() as { language?: string };
  return mapLanguageToTMDB(settings.language || "en");
}

function isMediaResult(item: TMDBSearchResult): item is TMDBMediaSearchResult {
  return item.media_type === "tv" || item.media_type === "movie";
}

function toCandidate(
  item: TMDBMediaSearchResult,
  query: string
): CollectionSearchCandidate | null {
  if (!Number.isSafeInteger(item.id) || item.id <= 0) {
    return null;
  }

  const title = (item.media_type === "tv" ? item.name : item.title)?.trim();
  if (!title) {
    return null;
  }

  return {
    tmdbId: item.id,
    mediaType: item.media_type,
    title,
    originalTitle:
      (item.media_type === "tv" ? item.original_name : item.original_title) ||
      undefined,
    overview: item.overview || undefined,
    premiereDate:
      (item.media_type === "tv" ? item.first_air_date : item.release_date) ||
      undefined,
    posterPath: item.poster_path || undefined,
    highConfidence: isHighConfidenceTMDBTitleMatch(query, item),
  };
}

/**
 * Ranks high-confidence first, then TV ahead of an equally confident movie —
 * a collection of episodes is far more often a series than a film.
 */
function rankCandidates(
  candidates: CollectionSearchCandidate[]
): CollectionSearchCandidate[] {
  return [...candidates].sort((left, right) => {
    if (left.highConfidence !== right.highConfidence) {
      return left.highConfidence ? -1 : 1;
    }
    if (left.mediaType !== right.mediaType) {
      return left.mediaType === "tv" ? -1 : 1;
    }
    return 0;
  });
}

/**
 * Read-only. Never downloads a poster and never persists anything.
 */
export async function searchCollectionCandidates(
  query: string
): Promise<CollectionSearchResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { status: "no_results" };
  }

  const credential = getCredential();
  if (!credential) {
    return { status: "no_credential" };
  }

  try {
    const response = await tmdbHttpClient.get(
      buildTMDBEndpointPath("/search/multi"),
      buildTMDBRequestConfig(credential, {
        query: trimmedQuery,
        language: getLanguage(),
        include_adult: "false",
      })
    );

    const results = Array.isArray(response.data?.results)
      ? (response.data.results as TMDBSearchResult[])
      : [];

    const candidates = results
      .filter(isMediaResult)
      .map((item) => toCandidate(item, trimmedQuery))
      .filter((candidate): candidate is CollectionSearchCandidate =>
        Boolean(candidate)
      );

    if (candidates.length === 0) {
      return { status: "no_results" };
    }

    return {
      status: "ok",
      candidates: rankCandidates(candidates).slice(
        0,
        MAX_COLLECTION_SEARCH_CANDIDATES
      ),
    };
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
    logger.error("TMDB collection search failed", error);
    return { status: "no_results" };
  }
}

/**
 * Re-fetches authoritative details for a confirmed selection.
 *
 * The browser posts only `{tmdbId, mediaType}`; title, overview, date and poster
 * are read from TMDB here rather than trusted from the client, so a tampered
 * request cannot write arbitrary text into a show's NFO.
 */
export async function resolveCollectionMetadata(
  tmdbId: number,
  mediaType: "tv" | "movie"
): Promise<ResolvedCollectionMetadata | null> {
  validateTMDBNumericId(tmdbId);

  const credential = getCredential();
  if (!credential) {
    return null;
  }

  const language = getLanguage();

  if (mediaType === "tv") {
    const details = await getTVShowDetails(tmdbId, credential, language);
    if (!details) {
      return null;
    }
    const tv: TMDBTVResult = details.tv;
    const title = (tv.name || tv.original_name || "").trim();
    if (!title) {
      return null;
    }
    return {
      tmdbId,
      mediaType,
      title,
      overview: tv.overview || undefined,
      premiereDate: tv.first_air_date || undefined,
      posterPath: tv.poster_path || undefined,
    };
  }

  const details = await getMovieDetails(tmdbId, credential, language);
  if (!details) {
    return null;
  }
  const movie: TMDBMovieResult = details.movie;
  const title = (movie.title || movie.original_title || "").trim();
  if (!title) {
    return null;
  }
  return {
    tmdbId,
    mediaType,
    title,
    overview: movie.overview || undefined,
    premiereDate: movie.release_date || undefined,
    posterPath: movie.poster_path || undefined,
  };
}
