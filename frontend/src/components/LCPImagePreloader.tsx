import { useEffect } from 'react';
import { Video } from '../types';
import { getBackendUrl } from '../utils/apiUrl';

/**
 * Component that preloads the first video thumbnail for better LCP
 * This runs early in the render cycle to start loading the LCP image as soon as possible
 */
interface LCPImagePreloaderProps {
    videos: Video[];
}

export const LCPImagePreloader: React.FC<LCPImagePreloaderProps> = ({ videos }) => {
    useEffect(() => {
        // Get the first video (likely to be the LCP element)
        const firstVideo = videos[0];
        if (!firstVideo) return;

        // Determine thumbnail URL
        const isVideoInCloud = firstVideo.videoPath?.startsWith('cloud:') ?? false;
        let thumbnailUrl: string | undefined;

        if (isVideoInCloud) {
            // For cloud storage, we can't preload without the signed URL
            // The useCloudStorageUrl hook will handle this
            return;
        }

        // For local videos, construct the URL immediately
        if (firstVideo.thumbnailPath) {
            thumbnailUrl = `${getBackendUrl()}${firstVideo.thumbnailPath}`;
        } else if (firstVideo.thumbnailUrl) {
            thumbnailUrl = firstVideo.thumbnailUrl;
        }

        if (thumbnailUrl) {
            // Preload the image using a link tag for highest priority
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = thumbnailUrl;
            link.setAttribute('fetchpriority', 'high');
            document.head.appendChild(link);

            // Also create an Image object to start loading and handle errors
            const img = new Image();
            img.src = thumbnailUrl;
            img.loading = 'eager';
            img.fetchPriority = 'high';

            // Handle image load success
            img.onload = () => {
                // Image loaded successfully - no action needed
                // The preload link will be cleaned up by the cleanup function
            };

            // Handle image load failure
            img.onerror = (error) => {
                // Silently handle preload failures - this is just an optimization
                // The actual image will still be loaded by the VideoCard component
                // Log error in development mode for debugging
                if (process.env.NODE_ENV === 'development') {
                    console.warn('LCPImagePreloader: Failed to preload thumbnail:', thumbnailUrl, error);
                }
                // Remove the failed preload link to avoid keeping invalid references
                if (link.parentNode === document.head) {
                    document.head.removeChild(link);
                }
            };

            // Cleanup
            return () => {
                // Remove error handlers to prevent memory leaks
                img.onload = null;
                img.onerror = null;
                // Check if link still exists before removing to avoid errors
                if (link.parentNode === document.head) {
                    document.head.removeChild(link);
                }
            };
        }
    }, [videos]);

    // This component doesn't render anything
    return null;
};
