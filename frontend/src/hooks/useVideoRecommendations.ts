import { useDeferredValue, useMemo } from 'react';
import { useCollection } from '../contexts/CollectionContext';
import { useVideo } from '../contexts/VideoContext';
import { Video } from '../types';
import { getRecommendations } from '../utils/recommendations';

interface UseVideoRecommendationsProps {
    video: Video | undefined;
    sourceCollectionId?: string | null;
    playbackQueueVideoIds?: string[];
}

/**
 * Custom hook to calculate video recommendations
 */
export function useVideoRecommendations({
    video,
    sourceCollectionId = null,
    playbackQueueVideoIds
}: UseVideoRecommendationsProps) {
    const { videos } = useVideo();
    const { collections } = useCollection();
    const deferredVideos = useDeferredValue(videos);
    const deferredCollections = useDeferredValue(collections);
    const recommendationVideo = useMemo(() => {
        if (!video) return undefined;

        return {
            id: video.id,
            author: video.author,
            tags: video.tags,
            seriesTitle: video.seriesTitle,
            partNumber: video.partNumber,
            totalParts: video.totalParts,
            rating: video.rating,
            title: video.title,
            videoFilename: video.videoFilename,
            source: video.source,
            sourceUrl: video.sourceUrl,
            date: video.date,
            addedAt: video.addedAt,
            duration: video.duration,
            progress: video.progress,
            viewCount: video.viewCount,
            lastPlayedAt: video.lastPlayedAt,
            channelUrl: video.channelUrl
        } as Video;
    }, [video]);
    const deferredRecommendationVideo = useDeferredValue(recommendationVideo);

    // Get related videos using recommendation algorithm
    const relatedVideos = useMemo(() => {
        if (!deferredRecommendationVideo) return [];
        return getRecommendations({
            currentVideo: deferredRecommendationVideo,
            allVideos: deferredVideos,
            collections: deferredCollections,
            sourceCollectionId,
            playbackQueueVideoIds
        }).slice(0, 10);
    }, [
        deferredRecommendationVideo,
        deferredVideos,
        deferredCollections,
        sourceCollectionId,
        playbackQueueVideoIds
    ]);

    return {
        relatedVideos
    };
}
