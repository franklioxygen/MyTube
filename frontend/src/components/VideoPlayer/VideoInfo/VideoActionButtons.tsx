import { Add, Cast, Delete, MoreVert, Share } from '@mui/icons-material';
import { Button, IconButton, Menu, MenuItem, Stack, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSnackbar } from '../../../contexts/SnackbarContext';
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
    const { showSnackbar } = useSnackbar();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [playerMenuAnchor, setPlayerMenuAnchor] = useState<null | HTMLElement>(null);
    const [kebabMenuAnchor, setKebabMenuAnchor] = useState<null | HTMLElement>(null);

    const getVideoUrl = (): string => {
        if (video.videoPath) {
            const videoPath = video.videoPath.startsWith('/') ? video.videoPath : `/${video.videoPath}`;
            
            // Always use current origin for external players to ensure accessibility
            // The browser's same-origin policy means videos are served from the same origin
            // when accessed remotely, so window.location.origin is the correct base URL
            return `${window.location.origin}${videoPath}`;
        }
        return video.sourceUrl;
    };

    const handlePlayerMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setPlayerMenuAnchor(event.currentTarget);
    };

    const handlePlayerMenuClose = () => {
        setPlayerMenuAnchor(null);
    };

    const handleKebabMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setKebabMenuAnchor(event.currentTarget);
    };

    const handleKebabMenuClose = () => {
        setKebabMenuAnchor(null);
    };

    const handlePlayerSelect = (player: string) => {
        const videoUrl = getVideoUrl();
        
        try {
            let playerUrl = '';
            
            switch (player) {
                case 'vlc':
                    playerUrl = `vlc://${videoUrl}`;
                    break;
                case 'iina':
                    playerUrl = `iina://weblink?url=${encodeURIComponent(videoUrl)}`;
                    break;
                case 'mpv':
                    playerUrl = `mpv://${videoUrl}`;
                    break;
                case 'potplayer':
                    playerUrl = `potplayer://${videoUrl}`;
                    break;
                case 'infuse':
                    playerUrl = `infuse://x-callback-url/play?url=${encodeURIComponent(videoUrl)}`;
                    break;
                case 'copy':
                    // Copy URL to clipboard
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(videoUrl).then(() => {
                            showSnackbar(t('linkCopied'), 'success');
                        }).catch(() => {
                            showSnackbar(t('copyFailed'), 'error');
                        });
                    } else {
                        // Fallback
                        const textArea = document.createElement("textarea");
                        textArea.value = videoUrl;
                        textArea.style.position = "fixed";
                        document.body.appendChild(textArea);
                        textArea.focus();
                        textArea.select();
                        try {
                            const successful = document.execCommand('copy');
                            if (successful) {
                                showSnackbar(t('linkCopied'), 'success');
                            } else {
                                showSnackbar(t('copyFailed'), 'error');
                            }
                        } catch (err) {
                            showSnackbar(t('copyFailed'), 'error');
                        }
                        document.body.removeChild(textArea);
                    }
                    handlePlayerMenuClose();
                    return;
                default:
                    return;
            }

            // Try to open the player URL using a hidden anchor element
            // This prevents navigation away from the page
            const link = document.createElement('a');
            link.href = playerUrl;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Show a message after a short delay
            setTimeout(() => {
                showSnackbar(t('openInExternalPlayer'), 'info');
            }, 500);
            
        } catch (error) {
            console.error('Error opening player:', error);
            showSnackbar(t('copyFailed'), 'error');
        }
        
        handlePlayerMenuClose();
    };

    const actionButtons = (
        <Stack direction="row" spacing={1}>
            <Tooltip title={t('playWith')}>
                <Button
                    variant="outlined"
                    color="inherit"
                    onClick={handlePlayerMenuOpen}
                    sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                >
                    <Cast />
                </Button>
            </Tooltip>
            <Menu
                anchorEl={playerMenuAnchor}
                open={Boolean(playerMenuAnchor)}
                onClose={handlePlayerMenuClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'left',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                }}
            >
                <MenuItem onClick={() => handlePlayerSelect('vlc')}>VLC</MenuItem>
                <MenuItem onClick={() => handlePlayerSelect('iina')}>IINA</MenuItem>
                <MenuItem onClick={() => handlePlayerSelect('mpv')}>mpv</MenuItem>
                <MenuItem onClick={() => handlePlayerSelect('potplayer')}>PotPlayer</MenuItem>
                <MenuItem onClick={() => handlePlayerSelect('infuse')}>Infuse</MenuItem>
                <MenuItem onClick={() => handlePlayerSelect('copy')}>{t('copyUrl')}</MenuItem>
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

    if (isMobile) {
        return (
            <>
                <Tooltip title="More actions">
                    <IconButton
                        onClick={handleKebabMenuOpen}
                        sx={{ 
                            color: kebabMenuAnchor ? 'primary.main' : 'text.secondary', 
                            '&:hover': { color: 'primary.main' } 
                        }}
                    >
                        <MoreVert />
                    </IconButton>
                </Tooltip>
                <Menu
                    anchorEl={kebabMenuAnchor}
                    open={Boolean(kebabMenuAnchor)}
                    onClose={handleKebabMenuClose}
                    anchorOrigin={{
                        vertical: 'bottom',
                        horizontal: 'right',
                    }}
                    transformOrigin={{
                        vertical: 'top',
                        horizontal: 'right',
                    }}
                    slotProps={{
                        paper: {
                            sx: {
                                minWidth: 'auto',
                                p: 1,
                                px: 2,
                            }
                        }
                    }}
                >
                    <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
                        <Tooltip title={t('playWith')}>
                            <Button
                                variant="outlined"
                                color="inherit"
                                onClick={() => {
                                    // Store the anchor before closing the kebab menu
                                    const anchor = kebabMenuAnchor;
                                    handleKebabMenuClose();
                                    // Use the stored anchor for the player menu
                                    if (anchor) {
                                        setPlayerMenuAnchor(anchor);
                                    }
                                }}
                                sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                            >
                                <Cast />
                            </Button>
                        </Tooltip>
                        <Tooltip title={t('share')}>
                            <Button
                                variant="outlined"
                                color="inherit"
                                onClick={() => {
                                    handleKebabMenuClose();
                                    handleShare();
                                }}
                                sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                            >
                                <Share />
                            </Button>
                        </Tooltip>
                        <Tooltip title={t('addToCollection')}>
                            <Button
                                variant="outlined"
                                color="inherit"
                                onClick={() => {
                                    handleKebabMenuClose();
                                    onAddToCollection();
                                }}
                                sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                            >
                                <Add />
                            </Button>
                        </Tooltip>
                        <Tooltip title={t('delete')}>
                            <Button
                                variant="outlined"
                                color="inherit"
                                onClick={() => {
                                    handleKebabMenuClose();
                                    onDelete();
                                }}
                                disabled={isDeleting}
                                sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'error.main', borderColor: 'error.main' } }}
                            >
                                <Delete />
                            </Button>
                        </Tooltip>
                    </Stack>
                </Menu>
                <Menu
                    anchorEl={playerMenuAnchor}
                    open={Boolean(playerMenuAnchor)}
                    onClose={handlePlayerMenuClose}
                    anchorOrigin={{
                        vertical: 'bottom',
                        horizontal: 'left',
                    }}
                    transformOrigin={{
                        vertical: 'top',
                        horizontal: 'left',
                    }}
                >
                    <MenuItem onClick={() => handlePlayerSelect('vlc')}>VLC</MenuItem>
                    <MenuItem onClick={() => handlePlayerSelect('iina')}>IINA</MenuItem>
                    <MenuItem onClick={() => handlePlayerSelect('mpv')}>mpv</MenuItem>
                    <MenuItem onClick={() => handlePlayerSelect('potplayer')}>PotPlayer</MenuItem>
                    <MenuItem onClick={() => handlePlayerSelect('infuse')}>Infuse</MenuItem>
                    <MenuItem onClick={() => handlePlayerSelect('copy')}>{t('copyUrl')}</MenuItem>
                </Menu>
            </>
        );
    }

    return actionButtons;
};

export default VideoActionButtons;

