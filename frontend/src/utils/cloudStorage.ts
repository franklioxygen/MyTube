import axios, { AxiosError } from "axios";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:5551";

// Configuration constants
const REQUEST_TIMEOUT = 10000; // 10 seconds timeout for signed URL requests
const MAX_RETRIES = 2; // Maximum number of retries for failed requests
const RETRY_DELAY = 1000; // Initial delay between retries in milliseconds

/**
 * Check if a path is a cloud storage path (starts with "cloud:")
 */
export const isCloudStoragePath = (
  path: string | null | undefined
): boolean => {
  return path?.startsWith("cloud:") ?? false;
};

/**
 * Check if a path is a mount directory path (starts with "mount:")
 */
export const isMountDirectoryPath = (
  path: string | null | undefined
): boolean => {
  return path?.startsWith("mount:") ?? false;
};

/**
 * Extract filename from cloud storage path (removes "cloud:" prefix)
 */
export const extractCloudFilename = (path: string): string => {
  if (!path.startsWith("cloud:")) {
    return path;
  }
  return path.substring(6); // Remove "cloud:" prefix
};

/**
 * Check if an error is retryable (network errors, timeouts, 5xx errors)
 */
function isRetryableError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    // Retry on network errors (no response) or timeouts
    if (!axiosError.response) {
      return true;
    }
    // Retry on 5xx server errors (but not 4xx client errors)
    const status = axiosError.response.status;
    return status >= 500 || status === 408; // 408 is Request Timeout
  }
  return false;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cache for signed URLs (persists across re-renders for the session)
const urlCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

// Cache for failed requests to avoid repeated failures
const failedRequestCache = new Map<
  string,
  { timestamp: number; retries: number }
>();
const FAILED_CACHE_DURATION = 30 * 1000; // Don't retry failed requests for 30 seconds

// Cache for inflight requests to prevent duplicate calls
const signedUrlPromiseCache = new Map<string, Promise<string | null>>();

/**
 * Get signed URL for a cloud storage file with retry logic and timeout handling
 * This fetches the dynamic sign from the backend
 * Implements request deduplication, caching, retry mechanism, and error handling
 */
export const getCloudStorageSignedUrl = async (
  filename: string,
  type: "video" | "thumbnail" = "video"
): Promise<string | null> => {
  const cacheKey = `${filename}:${type}`;
  const now = Date.now();

  // Check persistent cache first
  const cached = urlCache.get(cacheKey);
  if (cached) {
    if (now - cached.timestamp < CACHE_DURATION) {
      return cached.url;
    }
    // Cache expired, remove it
    urlCache.delete(cacheKey);
  }

  // Check if this request recently failed and shouldn't be retried yet
  const failed = failedRequestCache.get(cacheKey);
  if (failed) {
    const timeSinceFailure = now - failed.timestamp;
    if (
      timeSinceFailure < FAILED_CACHE_DURATION &&
      failed.retries >= MAX_RETRIES
    ) {
      // Too many failures recently, don't retry
      return null;
    }
    // If cache expired, remove it to allow retry
    if (timeSinceFailure >= FAILED_CACHE_DURATION) {
      failedRequestCache.delete(cacheKey);
    }
  }

  // Return existing promise if request is already inflight
  const existingPromise = signedUrlPromiseCache.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async () => {
    try {
      let lastError: unknown = null;

      // Retry loop
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await axios.get(
            `${BACKEND_URL}/api/cloud/signed-url`,
            {
              params: {
                filename,
                type,
              },
              timeout: REQUEST_TIMEOUT,
            }
          );

          if (response.data?.success && response.data?.url) {
            // Cache the successful result
            urlCache.set(cacheKey, {
              url: response.data.url,
              timestamp: Date.now(),
            });
            // Clear failed cache on success
            failedRequestCache.delete(cacheKey);
            return response.data.url;
          }

          // If response is unsuccessful but not an error, don't retry
          return null;
        } catch (error) {
          lastError = error;

          // Only retry on retryable errors
          if (!isRetryableError(error)) {
            // Non-retryable error (4xx client errors), don't retry
            console.warn(
              `Failed to get cloud storage signed URL (non-retryable): ${filename}`,
              axios.isAxiosError(error) ? error.response?.status : error
            );
            return null;
          }

          // If this was the last attempt, don't wait
          if (attempt < MAX_RETRIES) {
            // Wait before retrying with exponential backoff
            const delay = RETRY_DELAY * Math.pow(2, attempt);
            await sleep(delay);
          }
        }
      }

      // All retries exhausted
      const errorMessage = axios.isAxiosError(lastError)
        ? lastError.code === "ECONNABORTED" ||
          lastError.message.includes("timeout")
          ? "Request timeout"
          : lastError.response
          ? `Server error (${lastError.response.status})`
          : "Network error"
        : "Unknown error";

      console.error(
        `Failed to get cloud storage signed URL after ${
          MAX_RETRIES + 1
        } attempts: ${filename}`,
        errorMessage
      );

      // Cache the failure to avoid immediate retries
      failedRequestCache.set(cacheKey, {
        timestamp: Date.now(),
        retries: MAX_RETRIES + 1,
      });

      return null;
    } finally {
      // Always remove the promise from cache when it completes (success or failure)
      // This allows fresh requests after cache expiration and prevents returning stale null values
      signedUrlPromiseCache.delete(cacheKey);
    }
  })();

  signedUrlPromiseCache.set(cacheKey, promise);
  return promise;
};

/**
 * Get file URL, handling both local files and cloud storage
 * For cloud storage paths (starting with "cloud:"), fetches signed URL dynamically
 * For regular paths, returns the full URL with backend prefix
 * For already full URLs (http:// or https://), returns as is
 */
export const getFileUrl = async (
  path: string | null | undefined,
  type: "video" | "thumbnail" = "video"
): Promise<string | undefined> => {
  if (!path) return undefined;

  // If already a full URL, return as is
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  // If cloud storage path, fetch signed URL
  if (isCloudStoragePath(path)) {
    const filename = extractCloudFilename(path);
    const signedUrl = await getCloudStorageSignedUrl(filename, type);
    return signedUrl || undefined;
  }

  // If mount directory path, it should be handled via signedUrl from the video object
  // This function should not be called directly for mount paths, but handle it gracefully
  if (isMountDirectoryPath(path)) {
    // For mount paths, we need the video ID to construct the URL
    // This should be handled via signedUrl from the video object
    // If we get here, it's an error case, return undefined
    return undefined;
  }

  // Otherwise, prepend backend URL
  return `${BACKEND_URL}${path}`;
};

/**
 * Synchronous version that returns a URL string (for cases where async is not possible)
 * For cloud storage, returns a placeholder that will need to be handled separately
 */
export const getFileUrlSync = (
  path: string | null | undefined
): string | undefined => {
  if (!path) return undefined;

  // If already a full URL, return as is
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  // If cloud storage path, return a special marker that components can detect
  // Components should use getFileUrl() async version for cloud storage
  if (isCloudStoragePath(path)) {
    return `cloud:${extractCloudFilename(path)}`;
  }

  // Otherwise, prepend backend URL
  return `${BACKEND_URL}${path}`;
};
