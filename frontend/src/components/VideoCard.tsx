import {
    Card,
    CardActionArea,
    useMediaQuery,
    useTheme
} from '@mui/material';
import React from 'react';
import { usePlayerSelection } from '../hooks/usePlayerSelection';
import { useVideoCardActions } from '../hooks/useVideoCardActions';
import { useVideoCardMetadata } from '../hooks/useVideoCardMetadata';
import { useVideoCardNavigation } from '../hooks/useVideoCardNavigation';
import { useVideoHoverPreview } from '../hooks/useVideoHoverPreview';
import { Collection, Video } from '../types';
import { getVideoCardCollectionInfo } from '../utils/videoCardUtils';
import { VideoCardActions } from './VideoCard/VideoCardActions';
import { VideoCardContent } from './VideoCard/VideoCardContent';
import { VideoCardThumbnail } from './VideoCard/VideoCardThumbnail';

interface VideoCardProps {
    video: Video;
    collections?: Collection[];
    onDeleteVideo?: (id: string) => Promise<any>;
    showDeleteButton?: boolean;
    disableCollectionGrouping?: boolean;
}

const VideoCard: React.FC<VideoCardProps> = ({
    video,
    collections = [],
    onDeleteVideo,
    showDeleteButton = false,
    disableCollectionGrouping = false
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    // Get collection information
    const collectionInfo = getVideoCardCollectionInfo(
        video,
        collections,
        disableCollectionGrouping
    );

    // Hooks for different concerns
    const hoverPreview = useVideoHoverPreview({ videoPath: video.videoPath });
    const metadata = useVideoCardMetadata({ video });
    const playerSelection = usePlayerSelection({
        video,
        getVideoUrl: metadata.getVideoUrl
    });
    const actions = useVideoCardActions({
        video,
        onDeleteVideo,
        showDeleteButton
    });
    const navigation = useVideoCardNavigation({
        video,
        collectionInfo
    });

    return (
        <Card
            onMouseEnter={hoverPreview.handleMouseEnter}
            onMouseLeave={hoverPreview.handleMouseLeave}
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                transition: 'transform 0.2s, box-shadow 0.2s, background-color 0.3s, color 0.3s, border-color 0.3s',
                borderRadius: isMobile ? 0 : undefined,
                ...(!isMobile && {
                    '&:hover': {
                        boxShadow: theme.shadows[8],
                        '& .delete-btn': {
                            opacity: 1
                        },
                        '& .add-btn': {
                            opacity: 1
                        }
                    }
                }),
                border: collectionInfo.isFirstInAnyCollection
                    ? `1px solid ${theme.palette.primary.main}`
                    : 'none'
            }}
        >
            <CardActionArea
                onClick={navigation.handleVideoNavigation}
                sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
            >
                <VideoCardThumbnail
                    video={video}
                    thumbnailSrc={metadata.thumbnailSrc}
                    videoUrl={metadata.videoUrl}
                    isHovered={hoverPreview.isHovered}
                    isVideoPlaying={hoverPreview.isVideoPlaying}
                    setIsVideoPlaying={hoverPreview.setIsVideoPlaying}
                    videoRef={hoverPreview.videoRef}
                    collectionInfo={collectionInfo}
                    isNew={metadata.isNew}
                />

                <VideoCardContent
                    video={video}
                    collectionInfo={collectionInfo}
                    onAuthorClick={navigation.handleAuthorClick}
                />
            </CardActionArea>

            <VideoCardActions
                video={video}
                playerMenuAnchor={playerSelection.playerMenuAnchor}
                setPlayerMenuAnchor={playerSelection.setPlayerMenuAnchor}
                handlePlayerSelect={playerSelection.handlePlayerSelect}
                getAvailablePlayers={playerSelection.getAvailablePlayers}
                showDeleteModal={actions.showDeleteModal}
                setShowDeleteModal={actions.setShowDeleteModal}
                confirmDelete={actions.confirmDelete}
                isDeleting={actions.isDeleting}
                handleToggleVisibility={actions.handleToggleVisibility}
                canDelete={actions.canDelete}
                isMobile={isMobile}
                isTouch={isTouch}
                isHovered={hoverPreview.isHovered}
            />
        </Card>
    );
};

export default VideoCard;
