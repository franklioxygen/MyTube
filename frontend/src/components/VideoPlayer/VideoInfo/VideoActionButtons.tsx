import { Add, Delete, PlayArrow, Share } from '@mui/icons-material';
import { Button, Divider, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useShareVideo } from '../../../hooks/useShareVideo';
import { Video } from '../../../types';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

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
    const [playerMenuAnchor, setPlayerMenuAnchor] = useState<null | HTMLElement>(null);

    const handleOpenPlayerMenu = (event: React.MouseEvent<HTMLElement>) => {
        setPlayerMenuAnchor(event.currentTarget);
    };

    const handleClosePlayerMenu = () => {
        setPlayerMenuAnchor(null);
    };

    const handlePlayInPlayer = (scheme: string) => {
        const videoUrl = `${BACKEND_URL}${video.videoPath || video.sourceUrl}`;
        let url = '';

        switch (scheme) {
            case 'iina':
                url = `iina://weblink?url=${videoUrl}`;
                break;
            case 'vlc':
                url = `vlc://${videoUrl}`;
                break;
            case 'potplayer':
                url = `potplayer://${videoUrl}`;
                break;
            case 'mpv':
                url = `mpv://${videoUrl}`;
                break;
            case 'infuse':
                url = `infuse://x-callback-url/play?url=${videoUrl}`;
                break;
        }

        if (url) {
            window.location.href = url;
        }
        handleClosePlayerMenu();
    };

    return (
        <Stack direction="row" spacing={1}>
            <Tooltip title={t('openInExternalPlayer')}>
                <Button
                    variant="outlined"
                    color="inherit"
                    onClick={handleOpenPlayerMenu}
                    sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                >
                    <PlayArrow />
                </Button>
            </Tooltip>
            <Menu
                anchorEl={playerMenuAnchor}
                open={Boolean(playerMenuAnchor)}
                onClose={handleClosePlayerMenu}
            >
                <MenuItem disabled>
                    <Typography variant="caption" color="text.secondary">
                        {t('playWith')}
                    </Typography>
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => handlePlayInPlayer('iina')}>
                    <ListItemText>IINA</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => handlePlayInPlayer('vlc')}>
                    <ListItemText>VLC</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => handlePlayInPlayer('potplayer')}>
                    <ListItemText>PotPlayer</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => handlePlayInPlayer('mpv')}>
                    <ListItemText>MPV</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => handlePlayInPlayer('infuse')}>
                    <ListItemText>Infuse</ListItemText>
                </MenuItem>
            </Menu>
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

