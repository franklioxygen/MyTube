import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5551';

/**
 * Check if a path is a cloud storage path (starts with "cloud:")
 */
export const isCloudStoragePath = (path: string | null | undefined): boolean => {
  return path?.startsWith('cloud:') ?? false;
};

/**
 * Extract filename from cloud storage path (removes "cloud:" prefix)
 */
export const extractCloudFilename = (path: string): string => {
  if (!path.startsWith('cloud:')) {
    return path;
  }
  return path.substring(6); // Remove "cloud:" prefix
};

// Cache for signed URLs (persists across re-renders for the session)
const urlCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

// Cache for inflight requests to prevent duplicate calls
const signedUrlPromiseCache = new Map<string, Promise<string | null>>();

/**
 * Get signed URL for a cloud storage file
 * This fetches the dynamic sign from the backend
 * Implements request deduplication and caching
 */
export const getCloudStorageSignedUrl = async (
  filename: string,
  type: 'video' | 'thumbnail' = 'video'
): Promise<string | null> => {
  const cacheKey = `${filename}:${type}`;
  const now = Date.now();

  // Check persistent cache first
  if (urlCache.has(cacheKey)) {
    const cached = urlCache.get(cacheKey)!;
    if (now - cached.timestamp < CACHE_DURATION) {
      return cached.url;
    }
    // Cache expired, remove it
    urlCache.delete(cacheKey);
  }
  
  // Return existing promise if request is already inflight
  if (signedUrlPromiseCache.has(cacheKey)) {
    return signedUrlPromiseCache.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
        const response = await axios.get(`${BACKEND_URL}/api/cloud/signed-url`, {
            params: {
              filename,
              type,
            },
        });

      if (response.data?.success && response.data?.url) {
        // Cache the successful result
        urlCache.set(cacheKey, {
          url: response.data.url,
          timestamp: Date.now()
        });
        return response.data.url;
      }
      return null;
    } catch (error) {
      console.error('Failed to get cloud storage signed URL:', error);
      return null;
    } finally {
      // Remove from inflight cache when done
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
  type: 'video' | 'thumbnail' = 'video'
): Promise<string | undefined> => {
  if (!path) return undefined;

  // If already a full URL, return as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  // If cloud storage path, fetch signed URL
  if (isCloudStoragePath(path)) {
    const filename = extractCloudFilename(path);
    const signedUrl = await getCloudStorageSignedUrl(filename, type);
    return signedUrl || undefined;
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
  if (path.startsWith('http://') || path.startsWith('https://')) {
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

