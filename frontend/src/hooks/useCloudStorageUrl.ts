import { useEffect, useState } from 'react';
import { getFileUrl, isCloudStoragePath } from '../utils/cloudStorage';

/**
 * Hook to get file URL, handling cloud storage paths dynamically
 * Returns the URL string, or undefined if not available
 */
export const useCloudStorageUrl = (
  path: string | null | undefined,
  type: 'video' | 'thumbnail' = 'video',
  initialUrl?: string
): string | undefined => {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!path) {
      setUrl(undefined);
      return;
    }

    // If we have an initial pre-signed URL (for cloud storage or mount directory), use it
    if (initialUrl && (path.startsWith('cloud:') || path.startsWith('mount:'))) {
      const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5551';
      // Construct full URL if it's a relative path
      const fullUrl = initialUrl.startsWith('http://') || initialUrl.startsWith('https://')
        ? initialUrl
        : `${BACKEND_URL}${initialUrl}`;
      setUrl(fullUrl);
      return;
    }

    // If already a full URL, use it directly
    if (path.startsWith('http://') || path.startsWith('https://')) {
      setUrl(path);
      return;
    }

    // If cloud storage path, fetch signed URL
    if (isCloudStoragePath(path)) {
      getFileUrl(path, type).then((signedUrl) => {
        setUrl(signedUrl);
      });
    } else if (path.startsWith('mount:')) {
      // Mount directory paths should have signedUrl from the video object
      // If we get here without signedUrl, it's an error
      setUrl(undefined);
    } else {
      // Regular path, use relative path (works with both direct backend and nginx proxy)
      // Paths like /avatars/..., /images/..., /videos/... will be handled by nginx proxy
      setUrl(path);
    }
  }, [path, type, initialUrl]);

  return url;
};

