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
    const videoId = video?.id;
    const videoAuthor = video?.author;
    const videoTags = video?.tags;
    const videoSeriesTitle = video?.seriesTitle;
    const videoTitle = video?.title;
    const videoFilename = video?.videoFilename;
    const videoSource = video?.source;
    const videoDate = video?.date;
    const videoAddedAt = video?.addedAt;
    const videoDuration = video?.duration;

    const recommendationVideo = useMemo(() => {
        if (!videoId) return undefined;

        return {
            id: videoId,
            author: videoAuthor,
            tags: videoTags,
            seriesTitle: videoSeriesTitle,
            title: videoTitle,
            videoFilename,
            source: videoSource,
            date: videoDate,
            addedAt: videoAddedAt,
            duration: videoDuration
        } as Video;
    }, [
        videoId,
        videoAuthor,
        videoSeriesTitle,
        videoTitle,
        videoFilename,
        videoSource,
        videoDate,
        videoAddedAt,
        videoDuration,
        videoTags
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
