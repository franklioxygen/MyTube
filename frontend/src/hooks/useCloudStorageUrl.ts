import { useEffect, useState } from 'react';
import { getFileUrl, isCloudStoragePath } from '../utils/cloudStorage';

/**
 * Hook to get file URL, handling cloud storage paths dynamically
 * Returns the URL string, or undefined if not available
 */
export const useCloudStorageUrl = (
  path: string | null | undefined,
  type: 'video' | 'thumbnail' = 'video'
): string | undefined => {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!path) {
      setUrl(undefined);
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
    } else {
      // Regular path, construct URL synchronously
      const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5551';
      setUrl(`${BACKEND_URL}${path}`);
    }
  }, [path, type]);

  return url;
};

