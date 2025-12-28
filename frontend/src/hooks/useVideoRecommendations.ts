import { useMemo } from 'react';
import { useCollection } from '../contexts/CollectionContext';
import { useVideo } from '../contexts/VideoContext';
import { Video } from '../types';
import { getRecommendations } from '../utils/recommendations';

interface UseVideoRecommendationsProps {
    video: Video | undefined;
}

/**
 * Custom hook to calculate video recommendations
 */
export function useVideoRecommendations({ video }: UseVideoRecommendationsProps) {
    const { videos } = useVideo();
    const { collections } = useCollection();

    // Get related videos using recommendation algorithm
    const relatedVideos = useMemo(() => {
        if (!video) return [];
        return getRecommendations({
            currentVideo: video,
            allVideos: videos,
            collections: collections
        }).slice(0, 10);
    }, [video, videos, collections]);

    return {
        relatedVideos
    };
}
