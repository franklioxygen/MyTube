/**
 * TMDBService - Main index file
 *
 * Re-exports the public TMDB API from the modular tmdbService directory.
 * The implementation has been split into focused modules:
 * - constants.ts      - API base URLs, cache/timeout constants, language mapping
 * - types.ts          - Shared type/interface definitions
 * - httpClient.ts     - Shared axios client and endpoint/id helpers
 * - credentials.ts    - Auth detection, request config, credential testing
 * - cache.ts          - In-memory search cache and cache-key building
 * - filenameParser.ts - Filename -> title/year/season parsing
 * - titleMatch.ts     - Confident title-match comparison
 * - search.ts         - Movie/TV search + detail/credit fetching
 * - multiStrategy.ts  - Multi-strategy fallback search with caching
 * - poster.ts         - Poster URL validation and download
 * - scrape.ts         - High-level scrapeMetadataFromTMDB entry point
 */

export { testTMDBCredential } from "./credentials";
export { parseFilename } from "./filenameParser";
export { scrapeMetadataFromTMDB } from "./scrape";

export type {
  ParsedFilename,
  TMDBCredentialAuthType,
  TMDBCredentialMessageKey,
  TMDBCredentialTestResult,
  TMDBMovieResult,
  TMDBSearchResult,
  TMDBTVResult,
} from "./types";
