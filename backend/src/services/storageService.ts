/**
 * StorageService - Main entry point
 *
 * This file re-exports all functionality from the modular storageService directory
 * to maintain backward compatibility with existing imports.
 *
 * The actual implementation has been split into separate modules:
 * - types.ts - Type definitions
 * - initialization.ts - Database initialization and migrations
 * - downloadStatus.ts - Active/queued download management
 * - downloadHistory.ts - Download history operations
 * - videoDownloadTracking.ts - Duplicate download prevention
 * - settings.ts - Application settings
 * - videos.ts - Video CRUD operations
 * - collections.ts - Collection/playlist operations
 * - fileHelpers.ts - File system utilities
 */

// Re-export everything from the modular structure
export * from "./storageService/index";
