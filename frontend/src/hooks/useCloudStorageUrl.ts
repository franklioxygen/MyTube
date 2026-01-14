import { useEffect, useMemo, useState } from "react";
import {
  getFileUrl,
  isCloudStoragePath,
  isMountDirectoryPath,
} from "../utils/cloudStorage";

import { getBackendUrl } from "../utils/apiUrl";

/**
 * Helper function to construct full URL from initialUrl
 */
const constructFullUrl = (initialUrl: string): string => {
  const BACKEND_URL = getBackendUrl();
  // Construct full URL if it's a relative path
  return initialUrl.startsWith("http://") || initialUrl.startsWith("https://")
    ? initialUrl
    : `${BACKEND_URL}${initialUrl}`;
};

/**
 * Hook to get file URL, handling cloud storage paths dynamically
 * Returns the URL string, or undefined if not available
 *
 * Performance optimization: For regular paths (non-cloud, non-mount),
 * uses useMemo to avoid unnecessary state updates and effects.
 */
export const useCloudStorageUrl = (
  path: string | null | undefined,
  type: "video" | "thumbnail" = "video",
  initialUrl?: string
): string | undefined => {
  // For regular paths (non-cloud, non-mount), compute URL synchronously with useMemo
  // This avoids unnecessary state and effects for common cases like /avatars/xxx.jpg
  const syncUrl = useMemo(() => {
    if (!path) return undefined;

    // If we have an initial pre-signed URL (for cloud storage or mount directory), use it
    if (
      initialUrl &&
      (path.startsWith("cloud:") || path.startsWith("mount:"))
    ) {
      return constructFullUrl(initialUrl);
    }

    // If already a full URL, use it directly
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }

    // For regular paths (non-cloud, non-mount), return path directly
    // These paths like /avatars/..., /images/..., /videos/... work with nginx proxy
    if (!isCloudStoragePath(path) && !isMountDirectoryPath(path)) {
      return path;
    }

    // For cloud storage and mount paths, return undefined here
    // They will be handled by async state below
    return undefined;
  }, [path, initialUrl]);

  // Only use async state for cloud storage and mount paths
  const [asyncUrl, setAsyncUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Check if async handling is needed
    const needsAsync =
      path && (isCloudStoragePath(path) || isMountDirectoryPath(path));

    if (!needsAsync) {
      setAsyncUrl(undefined);
      return;
    }

    // Note: initialUrl is already handled in syncUrl useMemo above
    // Only fetch if we don't have an initialUrl (which would be in syncUrl)

    // If cloud storage path, fetch signed URL with error handling
    if (path && isCloudStoragePath(path)) {
      let cancelled = false;

      getFileUrl(path, type)
        .then((signedUrl) => {
          if (!cancelled) {
            setAsyncUrl(signedUrl);
          }
        })
        .catch((error) => {
          // Error is already handled in getFileUrl/getCloudStorageSignedUrl
          // Just log it here for debugging
          if (!cancelled) {
            console.warn(
              `Failed to load cloud storage URL for ${path}:`,
              error
            );
            setAsyncUrl(undefined);
          }
        });

      // Cleanup function to prevent state updates if component unmounts
      return () => {
        cancelled = true;
      };
    } else if (path && isMountDirectoryPath(path)) {
      // Mount directory paths should have signedUrl from the video object
      // If we get here without signedUrl, it's an error
      setAsyncUrl(undefined);
    }
  }, [path, type, initialUrl]);

  // Return sync URL if available (for regular paths), otherwise return async URL
  return syncUrl !== undefined ? syncUrl : asyncUrl;
};
