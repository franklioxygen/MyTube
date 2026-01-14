import { useMemo } from 'react';
import { useCloudStorageUrl } from './useCloudStorageUrl';
import { Video } from '../types';
import { getBackendUrl } from '../utils/apiUrl';
import { isNewVideo } from '../utils/videoCardUtils';

interface UseVideoCardMetadataProps {
    video: Video;
}

/**
 * Hook to manage video card metadata: thumbnails, URLs, new video detection
 */
export const useVideoCardMetadata = ({ video }: UseVideoCardMetadataProps) => {
    // Use cloud storage hook for thumbnail URL only if video is in cloud storage
    // Only load thumbnail from cloud if the video itself is in cloud storage
    const isVideoInCloud = video.videoPath?.startsWith('cloud:') ?? false;
    const thumbnailPathForCloud = isVideoInCloud ? video.thumbnailPath : null;
    const thumbnailUrl = useCloudStorageUrl(thumbnailPathForCloud, 'thumbnail');
    const localThumbnailUrl = !isVideoInCloud && video.thumbnailPath
        ? `${getBackendUrl()}${video.thumbnailPath}`
        : undefined;
    const thumbnailSrc = thumbnailUrl || localThumbnailUrl || video.thumbnailUrl;

    // Use cloud storage hook for video URL
    const videoUrl = useCloudStorageUrl(video.videoPath, 'video');

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
            const cloudUrl = await getFileUrl(video.videoPath, 'video');
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
    const isNew = useMemo(() => isNewVideo(video), [video.viewCount, video.addedAt, video.id]);

    return {
        thumbnailSrc,
        videoUrl,
        getVideoUrl,
        isNew
    };
};
