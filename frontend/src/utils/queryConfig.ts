/**
 * Centralized React Query configuration constants
 * Provides consistent query behavior across all contexts
 */

export const defaultQueryConfig = {
  retry: 3,
  retryDelay: 1000,
  staleTime: 5 * 60 * 1000, // 5 minutes
  gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
};

/**
 * Configuration for frequently updated data (e.g., download status)
 */
export const frequentQueryConfig = {
  retry: 3,
  retryDelay: 1000,
  staleTime: 1000, // 1 second
  gcTime: 5 * 60 * 1000, // 5 minutes
};

/**
 * Configuration for rarely changing data (e.g., settings)
 */
export const stableQueryConfig = {
  retry: 3,
  retryDelay: 1000,
  staleTime: 10 * 60 * 1000, // 10 minutes
  gcTime: 30 * 60 * 1000, // 30 minutes
};

