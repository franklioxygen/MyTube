import { Box, Menu, MenuItem } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useCollection } from '../../contexts/CollectionContext';
import { useShareVideo } from '../../hooks/useShareVideo';
import { Video } from '../../types';
import CollectionModal from '../CollectionModal';
import ConfirmationModal from '../ConfirmationModal';
import VideoKebabMenuButtons from '../VideoPlayer/VideoInfo/VideoKebabMenuButtons';

interface VideoCardActionsProps {
    video: Video;
    playerMenuAnchor: HTMLElement | null;
    setPlayerMenuAnchor: (anchor: HTMLElement | null) => void;
    handlePlayerSelect: (player: string) => void;
    getAvailablePlayers: () => Array<{ id: string; name: string }>;
    showDeleteModal: boolean;
    setShowDeleteModal: (show: boolean) => void;
    confirmDelete: () => void;
    isDeleting: boolean;
    handleToggleVisibility: () => void;
    canDelete: boolean;
    isMobile: boolean;
    isTouch: boolean;
    isHovered: boolean;
}

export const VideoCardActions: React.FC<VideoCardActionsProps> = ({
    video,
    playerMenuAnchor,
    setPlayerMenuAnchor,
    handlePlayerSelect,
    getAvailablePlayers,
    showDeleteModal,
    setShowDeleteModal,
    confirmDelete,
    isDeleting,
    handleToggleVisibility,
    canDelete,
    isMobile,
    isTouch,
    isHovered
}) => {
    const { t } = useLanguage();
    const { collections: allCollections, addToCollection, createCollection, removeFromCollection } = useCollection();
    const { handleShare } = useShareVideo(video);
    const [showCollectionModal, setShowCollectionModal] = React.useState(false);

    // Calculate collections that contain THIS video
    const currentVideoCollections = allCollections.filter(c => c.videos.includes(video.id));

    const handleAddToCollection = async (collectionId: string) => {
        if (!video.id) return;
        await addToCollection(collectionId, video.id);
    };

    const handleCreateCollection = async (name: string) => {
        if (!video.id) return;
        await createCollection(name, video.id);
    };

    const handleRemoveFromCollection = async () => {
        if (!video.id) return;
        await removeFromCollection(video.id);
    };

    const handlePlayerMenuClose = () => {
        setPlayerMenuAnchor(null);
    };

    return (
        <>
            <Box
                sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 10,
                    opacity: (!isMobile && !isTouch && !isHovered) ? 0 : 1,
                    transition: 'opacity 0.2s',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <VideoKebabMenuButtons
                    onPlayWith={(anchor) => setPlayerMenuAnchor(anchor)}
                    onShare={handleShare}
                    onAddToCollection={() => setShowCollectionModal(true)}
                    onDelete={canDelete ? () => setShowDeleteModal(true) : undefined}
                    isDeleting={isDeleting}
                    onToggleVisibility={handleToggleVisibility}
                    video={video}
                    sx={{
                        color: 'white',
                        bgcolor: 'rgba(0,0,0,0.6)',
                        '&:hover': {
                            bgcolor: 'rgba(0,0,0,0.8)',
                            color: 'primary.main'
                        }
                    }}
                />
            </Box>

            <Menu
                anchorEl={playerMenuAnchor}
                open={Boolean(playerMenuAnchor)}
                onClose={handlePlayerMenuClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
            >
                {getAvailablePlayers().map((player) => (
                    <MenuItem key={player.id} onClick={() => handlePlayerSelect(player.id)}>
                        {player.name}
                    </MenuItem>
                ))}
                <MenuItem onClick={() => handlePlayerSelect('copy')}>{t('copyUrl')}</MenuItem>
            </Menu>

            <ConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                title={t('deleteVideo')}
                message={`${t('confirmDelete')} "${video.title}"?`}
                confirmText={t('delete')}
                cancelText={t('cancel')}
                isDanger={true}
            />

            <CollectionModal
                open={showCollectionModal}
                onClose={() => setShowCollectionModal(false)}
                videoCollections={currentVideoCollections}
                collections={allCollections}
                onAddToCollection={handleAddToCollection}
                onCreateCollection={handleCreateCollection}
                onRemoveFromCollection={handleRemoveFromCollection}
            />
        </>
    );
};
