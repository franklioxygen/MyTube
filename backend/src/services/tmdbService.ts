/**
 * TMDBService - Main entry point
 *
 * Explicit barrel that re-exports the public TMDB API from the modular
 * tmdbService directory, preserving backward compatibility with existing
 * `../services/tmdbService` imports. See ./tmdbService/index.ts for the
 * module breakdown.
 */

export {
  parseFilename,
  scrapeMetadataFromTMDB,
  testTMDBCredential,
} from "./tmdbService/index";

export type {
  ParsedFilename,
  TMDBCredentialAuthType,
  TMDBCredentialMessageKey,
  TMDBCredentialTestResult,
  TMDBMovieResult,
  TMDBSearchResult,
  TMDBTVResult,
} from "./tmdbService/index";
