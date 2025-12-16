import { Add, Delete, Share } from '@mui/icons-material';
import { Button, Stack, Tooltip } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useShareVideo } from '../../../hooks/useShareVideo';
import { Video } from '../../../types';



interface VideoActionButtonsProps {
    video: Video;
    onAddToCollection: () => void;
    onDelete: () => void;
    isDeleting: boolean;
}

const VideoActionButtons: React.FC<VideoActionButtonsProps> = ({
    video,
    onAddToCollection,
    onDelete,
    isDeleting
}) => {
    const { t } = useLanguage();
    const { handleShare } = useShareVideo(video);


    return (
        <Stack direction="row" spacing={1}>

            <Tooltip title={t('share')}>
                <Button
                    variant="outlined"
                    color="inherit"
                    onClick={handleShare}
                    sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                >
                    <Share />
                </Button>
            </Tooltip>
            <Tooltip title={t('addToCollection')}>
                <Button
                    variant="outlined"
                    color="inherit"
                    onClick={() => onAddToCollection()}
                    sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                >
                    <Add />
                </Button>
            </Tooltip>
            <Tooltip title={t('delete')}>
                <Button
                    variant="outlined"
                    color="inherit"
                    onClick={onDelete}
                    disabled={isDeleting}
                    sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'error.main', borderColor: 'error.main' } }}
                >
                    <Delete />
                </Button>
            </Tooltip>
        </Stack>
    );
};

export default VideoActionButtons;

