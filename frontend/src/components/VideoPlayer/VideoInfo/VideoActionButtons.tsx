import { Add, Cast, Delete, Share, Visibility, VisibilityOff } from '@mui/icons-material';
import { Button, Menu, MenuItem, Stack, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { useVideo } from '../../../contexts/VideoContext';
import { useVisitorMode } from '../../../contexts/VisitorModeContext';
import { useCloudStorageUrl } from '../../../hooks/useCloudStorageUrl';
import { useShareVideo } from '../../../hooks/useShareVideo';
import { Video } from '../../../types';
import VideoKebabMenuButtons from './VideoKebabMenuButtons';

interface VideoActionButtonsProps {
    video: Video;
    onAddToCollection: () => void;
    onDelete: () => void;
    isDeleting: boolean;
    onToggleVisibility?: () => void;
}

const VideoActionButtons: React.FC<VideoActionButtonsProps> = ({
    video,
    onAddToCollection,
    onDelete,
    isDeleting,
    onToggleVisibility
}) => {
    const { t } = useLanguage();
    const { handleShare } = useShareVideo(video);
    const { showSnackbar } = useSnackbar();
    const { visitorMode } = useVisitorMode();
    const { incrementView } = useVideo();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const [playerMenuAnchor, setPlayerMenuAnchor] = useState<null | HTMLElement>(null);
    const videoUrl = useCloudStorageUrl(video.videoPath, 'video');

    const getVideoUrl = async (): Promise<string> => {
        // If we have a cloud storage URL, use it directly
        if (videoUrl) {
            return videoUrl;
        }

        // If cloud storage path but URL not loaded yet, try to get it directly
        if (video.videoPath?.startsWith('cloud:')) {
            // Try to get the signed URL directly
            const { getFileUrl } = await import('../../../utils/cloudStorage');
            const cloudUrl = await getFileUrl(video.videoPath, 'video');
            if (cloudUrl) {
                return cloudUrl;
            }
            // If still not available, return empty string
            return '';
        }

        // Otherwise, construct URL from videoPath
        if (video.videoPath) {
            const videoPath = video.videoPath.startsWith('/') ? video.videoPath : `/${video.videoPath}`;

            // Always use current origin for external players to ensure accessibility
            // The browser's same-origin policy means videos are served from the same origin
            // when accessed remotely, so window.location.origin is the correct base URL
            return `${window.location.origin}${videoPath}`;
        }
        return video.sourceUrl || '';
    };

    const handlePlayerMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setPlayerMenuAnchor(event.currentTarget);
    };

    const handlePlayerMenuClose = () => {
        setPlayerMenuAnchor(null);
    };


    const handlePlayerSelect = async (player: string) => {
        const resolvedVideoUrl = await getVideoUrl();

        if (!resolvedVideoUrl) {
            showSnackbar(t('error') || 'Video URL not available', 'error');
            handlePlayerMenuClose();
            return;
        }

        // Increment view count since we can't track watch time in external players
        await incrementView(video.id);

        try {
            let playerUrl = '';

            switch (player) {
                case 'vlc':
                    playerUrl = `vlc://${resolvedVideoUrl}`;
                    break;
                case 'iina':
                    playerUrl = `iina://weblink?url=${encodeURIComponent(resolvedVideoUrl)}`;
                    break;
                case 'mpv':
                    playerUrl = `mpv://${resolvedVideoUrl}`;
                    break;
                case 'potplayer':
                    playerUrl = `potplayer://${resolvedVideoUrl}`;
                    break;
                case 'infuse':
                    playerUrl = `infuse://x-callback-url/play?url=${encodeURIComponent(resolvedVideoUrl)}`;
                    break;
                case 'copy':
                    // Copy URL to clipboard
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(resolvedVideoUrl).then(() => {
                            showSnackbar(t('linkCopied'), 'success');
                        }).catch(() => {
                            showSnackbar(t('copyFailed'), 'error');
                        });
                    } else {
                        // Fallback
                        const textArea = document.createElement("textarea");
                        textArea.value = resolvedVideoUrl;
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
            <Tooltip title={t('playWith')} disableHoverListener={isTouch}>
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

            <Tooltip title={t('share')} disableHoverListener={isTouch}>
                <Button
                    variant="outlined"
                    color="inherit"
                    onClick={handleShare}
                    sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                >
                    <Share />
                </Button>
            </Tooltip>
            {!visitorMode && (
                <>
                    {onToggleVisibility && (
                        <Tooltip title={video.visibility === 0 ? t('showVideo') : t('hideVideo')} disableHoverListener={isTouch}>
                            <Button
                                variant="outlined"
                                color="inherit"
                                onClick={onToggleVisibility}
                                sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                            >
                                {video.visibility === 0 ? <Visibility /> : <VisibilityOff />}
                            </Button>
                        </Tooltip>
                    )}
                    <Tooltip title={t('addToCollection')} disableHoverListener={isTouch}>
                        <Button
                            variant="outlined"
                            color="inherit"
                            onClick={() => onAddToCollection()}
                            sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                        >
                            <Add />
                        </Button>
                    </Tooltip>
                    <Tooltip title={t('delete')} disableHoverListener={isTouch}>
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
                </>
            )}
        </Stack>
    );

    if (isMobile) {
        return (
            <>
                <VideoKebabMenuButtons
                    onPlayWith={(anchor) => setPlayerMenuAnchor(anchor)}
                    onShare={handleShare}
                    onAddToCollection={onAddToCollection}
                    onDelete={onDelete}
                    isDeleting={isDeleting}
                    onToggleVisibility={onToggleVisibility}
                    video={video}
                />
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

