import { useLayoutEffect } from 'react';
import { Video } from '../types';
import { getBackendUrl } from '../utils/apiUrl';
import { buildSmallThumbnailAbsoluteUrl } from '../utils/imageOptimization';

/**
 * Component that preloads the first video thumbnail for better LCP
 * This runs early in the render cycle to start loading the LCP image as soon as possible
 */
interface LCPImagePreloaderProps {
    videos: Video[];
}

export const LCPImagePreloader: React.FC<LCPImagePreloaderProps> = ({ videos }) => {
    // Derive a stable key from the first video so the effect only re-runs (and
    // re-inserts a preload link) when the LCP candidate actually changes, not on
    // every render with a new `videos` array reference.
    const firstVideo = videos[0];
    const lcpKey = firstVideo?.id ?? '';

    useLayoutEffect(() => {
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
            thumbnailUrl = buildSmallThumbnailAbsoluteUrl(
                getBackendUrl(),
                firstVideo.thumbnailPath,
                firstVideo.thumbnailUrl,
            );
        } else if (firstVideo.thumbnailUrl) {
            thumbnailUrl = firstVideo.thumbnailUrl;
        }

        if (thumbnailUrl) {
            // A single high-priority <link rel="preload"> is sufficient to start
            // the fetch early. (Previously this also created a `new Image()` for
            // the same URL, which triggered a redundant fetch.)
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = thumbnailUrl;
            link.setAttribute('fetchpriority', 'high');
            document.head.appendChild(link);

            // Cleanup: remove the link on unmount or when the LCP candidate changes.
            return () => {
                if (link.parentNode === document.head) {
                    document.head.removeChild(link);
                }
            };
        }
    }, [lcpKey, firstVideo]);

    // This component doesn't render anything
    return null;
};
