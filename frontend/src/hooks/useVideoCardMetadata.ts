import { useMemo } from 'react';
import { Video } from '../types';
import { isNewVideo } from '../utils/videoCardUtils';
import { useCloudStorageUrl } from './useCloudStorageUrl';
import { useThumbnailCandidates } from './useThumbnailCandidates';

interface UseVideoCardMetadataProps {
    video: Video;
}

/**
 * Hook to manage video card metadata: thumbnails, URLs, new video detection
 */
export const useVideoCardMetadata = ({ video }: UseVideoCardMetadataProps) => {
    // Cover URLs, best first: cloud signed URL (cloud videos only), then the
    // local /images-small mirror and its fallbacks.
    const { src: thumbnailSrc, candidates: thumbnailCandidates } =
        useThumbnailCandidates(video);

    // Use cloud storage hook for video URL
    const isAudioOnly = video.mediaType === 'audio';
    const mediaType = isAudioOnly ? 'audio' : 'video';
    const videoUrl = useCloudStorageUrl(video.videoPath, mediaType);

    // Get video URL with fallback logic
    const getVideoUrl = async (): Promise<string> => {
        // If we have a cloud storage URL, use it directly
        if (videoUrl) {
            return videoUrl;
        }

        // If cloud storage path but URL not loaded yet, wait for it
        if (video.videoPath?.startsWith('cloud:')) {
            // Try to get the signed URL directly
            const { getFileUrl } = await import('../utils/cloudStorage');
            const cloudUrl = await getFileUrl(video.videoPath, mediaType);
            if (cloudUrl) {
                return cloudUrl;
            }
            // If still not available, return empty string
            return '';
        }

        // Otherwise, construct URL from videoPath
        if (video.videoPath) {
            const videoPath = video.videoPath.startsWith('/') ? video.videoPath : `/${video.videoPath}`;
            return `${window.location.origin}${videoPath}`;
        }
        return video.sourceUrl || '';
    };

    // Check if video is new (memoized)
    const isNew = useMemo(() => isNewVideo(video), [video.viewCount, video.addedAt, video.id]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        thumbnailSrc,
        thumbnailCandidates,
        thumbnailSrcSet: undefined,
        thumbnailSizes: undefined,
        // Audio-only cards have no video frames, so feeding this URL into the
        // hover-preview <video> would fade the cover to a black, silent player.
        // Withhold the preview URL for audio; getVideoUrl still resolves it for
        // actual playback.
        videoUrl: isAudioOnly ? undefined : videoUrl,
        getVideoUrl,
        isNew
    };
};
