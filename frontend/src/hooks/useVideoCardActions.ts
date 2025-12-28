import { useState } from 'react';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { Video } from '../types';

interface UseVideoCardActionsProps {
    video: Video;
    onDeleteVideo?: (id: string) => Promise<any>;
    showDeleteButton?: boolean;
}

/**
 * Hook to manage video card actions: delete, visibility toggle, share
 */
export const useVideoCardActions = ({
    video,
    onDeleteVideo,
    showDeleteButton = false
}: UseVideoCardActionsProps) => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const { updateVideo } = useVideo();
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    // Handle confirm delete
    const confirmDelete = async () => {
        if (!onDeleteVideo) return;

        setIsDeleting(true);
        try {
            await onDeleteVideo(video.id);
        } catch (error) {
            console.error('Error deleting video:', error);
            setIsDeleting(false);
        }
    };

    // Handle visibility toggle
    const handleToggleVisibility = async () => {
        if (!video.id) return;
        const newVisibility = (video.visibility ?? 1) === 0 ? 1 : 0;
        const result = await updateVideo(video.id, { visibility: newVisibility });
        if (result.success) {
            showSnackbar(newVisibility === 1 ? t('showVideo') : t('hideVideo'), 'success');
        } else {
            showSnackbar(t('error'), 'error');
        }
    };

    return {
        isDeleting,
        showDeleteModal,
        setShowDeleteModal,
        confirmDelete,
        handleToggleVisibility,
        canDelete: showDeleteButton && !!onDeleteVideo
    };
};
