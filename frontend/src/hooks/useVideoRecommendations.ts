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
            title: video.title,
            videoFilename: video.videoFilename,
            source: video.source,
            date: video.date,
            addedAt: video.addedAt,
            duration: video.duration
        } as Video;
    }, [
        video?.id,
        video?.author,
        video?.seriesTitle,
        video?.title,
        video?.videoFilename,
        video?.source,
        video?.date,
        video?.addedAt,
        video?.duration,
        video?.tags
    ]);
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
