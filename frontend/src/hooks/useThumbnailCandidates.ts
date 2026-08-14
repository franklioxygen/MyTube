import { useMemo } from 'react';
import { Video } from '../types';
import { getBackendUrl } from '../utils/apiUrl';
import { buildThumbnailCandidates } from '../utils/imageOptimization';
import { THUMBNAIL_PLACEHOLDER_SRC } from '../utils/thumbnailPlaceholder';
import { useCloudStorageUrl } from './useCloudStorageUrl';

type ThumbnailVideo = Pick<Video, 'videoPath' | 'thumbnailPath' | 'thumbnailUrl'>;

export interface ThumbnailSource {
    /** URL to render first (never empty: falls back to the placeholder). */
    src: string;
    /** Ordered candidates for `handleThumbnailError` to walk on load failure. */
    candidates: string[];
}

const appendCacheBust = (url: string, cacheBust?: number): string => {
    if (!cacheBust) {
        return url;
    }

    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}cb=${cacheBust}`;
};

/**
 * Resolve every URL a video cover can be loaded from, best first.
 *
 * Cloud-stored covers keep their signed URL as the first candidate; local covers
 * fall back from the /images-small mirror to the original image and from the
 * backend origin to the page origin, so a single unreachable URL no longer drops
 * the card straight to the "No Thumbnail" placeholder (issue #405).
 */
export const useThumbnailCandidates = (
    video?: ThumbnailVideo | null,
    cacheBust?: number,
): ThumbnailSource => {
    // Only load a cover from cloud storage if the video itself lives there.
    const isVideoInCloud = video?.videoPath?.startsWith('cloud:') ?? false;
    const cloudThumbnailUrl = useCloudStorageUrl(
        isVideoInCloud ? video?.thumbnailPath : null,
        'thumbnail',
    );

    const thumbnailPath = video?.thumbnailPath;
    const thumbnailUrl = video?.thumbnailUrl;

    return useMemo(() => {
        const candidates = [
            ...(cloudThumbnailUrl ? [cloudThumbnailUrl] : []),
            ...(isVideoInCloud
                ? []
                : buildThumbnailCandidates(getBackendUrl(), thumbnailPath, thumbnailUrl)),
            ...(isVideoInCloud && thumbnailUrl ? [thumbnailUrl] : []),
        ]
            .map((candidate) => appendCacheBust(candidate, cacheBust))
            .filter((candidate, index, all) => all.indexOf(candidate) === index);

        return {
            src: candidates[0] ?? THUMBNAIL_PLACEHOLDER_SRC,
            candidates,
        };
    }, [cloudThumbnailUrl, isVideoInCloud, thumbnailPath, thumbnailUrl, cacheBust]);
};
