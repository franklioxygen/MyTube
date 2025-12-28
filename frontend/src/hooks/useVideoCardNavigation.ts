import { useNavigate } from 'react-router-dom';
import { Video } from '../types';
import { VideoCardCollectionInfo } from '../utils/videoCardUtils';

interface UseVideoCardNavigationProps {
    video: Video;
    collectionInfo: VideoCardCollectionInfo;
}

/**
 * Hook to handle video card navigation logic
 * Determines whether to navigate to video player or collection page
 */
export const useVideoCardNavigation = ({
    video,
    collectionInfo
}: UseVideoCardNavigationProps) => {
    const navigate = useNavigate();

    const handleVideoNavigation = () => {
        // If this is the first video in a collection, navigate to the collection page
        if (collectionInfo.isFirstInAnyCollection && collectionInfo.firstCollectionId) {
            navigate(`/collection/${collectionInfo.firstCollectionId}`);
        } else {
            // Otherwise navigate to the video player page
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
