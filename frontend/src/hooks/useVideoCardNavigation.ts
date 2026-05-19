import { useNavigate } from 'react-router-dom';
import { Video } from '../types';
import { VideoCardCollectionInfo } from '../utils/videoCardUtils';

interface UseVideoCardNavigationProps {
    video: Video;
    collectionInfo: VideoCardCollectionInfo;
    statisticsRelatedEventId?: string | null;
    sourceCollectionId?: string | null;
    playbackQueueVideoIds?: string[];
}

/**
 * Hook to handle video card navigation logic
 * Determines whether to navigate to video player or collection page
 */
export const useVideoCardNavigation = ({
    video,
    collectionInfo,
    statisticsRelatedEventId = null,
    sourceCollectionId = null,
    playbackQueueVideoIds
}: UseVideoCardNavigationProps) => {
    const navigate = useNavigate();

    const handleVideoNavigation = () => {
        const state = {
            ...(statisticsRelatedEventId ? { statisticsRelatedEventId } : {}),
            ...(sourceCollectionId ? { sourceCollectionId } : {}),
            ...(playbackQueueVideoIds ? { playbackQueueVideoIds } : {})
        };

        // If this is the first video in a collection, navigate to the collection page
        if (collectionInfo.isFirstInAnyCollection && collectionInfo.firstCollectionId) {
            navigate(`/collection/${collectionInfo.firstCollectionId}`);
        } else {
            // Otherwise navigate to the video player page
            if (Object.keys(state).length > 0) {
                navigate(`/video/${video.id}`, { state });
                return;
            }

            navigate(`/video/${video.id}`);
        }
    };

    const handleAuthorClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigate(`/author/${encodeURIComponent(video.author)}`);
    };

    return {
        handleVideoNavigation,
        handleAuthorClick
    };
};
