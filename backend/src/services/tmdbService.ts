/**
 * TMDBService - Main entry point
 *
 * This file re-exports all functionality from the modular tmdbService directory
 * to maintain backward compatibility with existing imports.
 *
 * The actual implementation has been split into separate modules under
 * ./tmdbService/ (see ./tmdbService/index.ts for the module breakdown).
 */

// Re-export everything from the modular structure
export * from "./tmdbService/index";
