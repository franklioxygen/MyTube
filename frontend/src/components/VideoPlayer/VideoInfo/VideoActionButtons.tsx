import { Add, Cast, Delete, Share, Visibility, VisibilityOff } from '@mui/icons-material';
import { Button, Menu, MenuItem, Stack, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { useVideo } from '../../../contexts/VideoContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useCloudStorageUrl } from '../../../hooks/useCloudStorageUrl';
import { useShareVideo } from '../../../hooks/useShareVideo';
import { Video } from '../../../types'; // Add imports
import { getAvailablePlayers, getPlayerUrl } from '../../../utils/playerUtils'; // Import new utils
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
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
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

    const getSyncVideoUrl = (): string | null => {
        if (videoUrl) return videoUrl;

        if (video.videoPath && !video.videoPath.startsWith('cloud:')) {
            const videoPath = video.videoPath.startsWith('/') ? video.videoPath : `/${video.videoPath}`;
            return `${window.location.origin}${videoPath}`;
        }

        if (video.sourceUrl) return video.sourceUrl;

        return null;
    };

    const copyToClipboard = (text: string) => {
        // 1. Try modern Clipboard API (if secure context)
        if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
            navigator.clipboard.writeText(text)
                .then(() => showSnackbar(t('linkCopied'), 'success'))
                .catch((err) => {
                    console.warn('Clipboard writeText failed:', err);
                    // If writeText fails, we inform the user and try fallback
                    fallbackCopy(text);
                });
            return;
        }

        // 2. Fallback for non-secure context or older browsers
        fallbackCopy(text);
    };

    const fallbackCopy = (text: string) => {
        try {
            const textArea = document.createElement("textarea");
            textArea.value = text;

            // Ensure strictly hidden but selectable
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            textArea.style.opacity = "0";
            textArea.setAttribute('readonly', '');

            document.body.appendChild(textArea);

            // iOS-specific selection
            if (navigator.userAgent.match(/ipad|iphone/i)) {
                const range = document.createRange();
                range.selectNodeContents(textArea);
                const selection = window.getSelection();
                if (selection) {
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
                textArea.setSelectionRange(0, 999999);
            } else {
                textArea.select();
            }

            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);

            if (successful) {
                showSnackbar(t('linkCopied'), 'success');
            } else {
                throw new Error('execCommand returned false');
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            // Final fallback: show URL in snackbar/alert for manual copy
            showSnackbar(`${t('copyFailed')}: ${text}`, 'error');
        }
    };

    const handlePlayerSelect = async (player: string) => {
        // Try to get URL synchronously first to preserve user gesture
        let resolvedVideoUrl = getSyncVideoUrl();

        // If we found it synchronously and we're just copying, do it strictly synchronously if possible
        if (resolvedVideoUrl && player === 'copy') {
            copyToClipboard(resolvedVideoUrl);
            handlePlayerMenuClose();
            return;
        }

        if (!resolvedVideoUrl) {
            // Must fetch async - might lose user gesture for clipboard
            resolvedVideoUrl = await getVideoUrl();
        }

        if (!resolvedVideoUrl) {
            showSnackbar(t('error') || 'Video URL not available', 'error');
            handlePlayerMenuClose();
            return;
        }

        if (player === 'copy') {
            copyToClipboard(resolvedVideoUrl);
            handlePlayerMenuClose();
            return;
        }

        // Increment view count since we can't track watch time in external players
        await incrementView(video.id);

        try {
            const playerUrl = getPlayerUrl(player, resolvedVideoUrl);

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
                {getAvailablePlayers().map((player) => (
                    <MenuItem key={player.id} onClick={() => handlePlayerSelect(player.id)}>
                        {player.name}
                    </MenuItem>
                ))}
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
            {!isVisitor && (
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
                    {getAvailablePlayers().map((player) => (
                        <MenuItem key={player.id} onClick={() => handlePlayerSelect(player.id)}>
                            {player.name}
                        </MenuItem>
                    ))}
                    <MenuItem onClick={() => handlePlayerSelect('copy')}>{t('copyUrl')}</MenuItem>
                </Menu>
            </>
        );
    }

    return actionButtons;
};

export default VideoActionButtons;
