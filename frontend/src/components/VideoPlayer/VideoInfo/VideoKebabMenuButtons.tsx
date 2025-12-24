import { Add, Cast, Delete, MoreVert, Share, Visibility, VisibilityOff } from '@mui/icons-material';
import { Button, IconButton, Menu, Stack, Tooltip, useMediaQuery } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useVisitorMode } from '../../../contexts/VisitorModeContext';

interface VideoKebabMenuButtonsProps {
    onPlayWith: (anchor: HTMLElement) => void;
    onShare: () => void;
    onAddToCollection: () => void;
    onDelete?: () => void;
    isDeleting?: boolean;
    onToggleVisibility?: () => void;
    video?: { visibility?: number };
    sx?: any;
}

const VideoKebabMenuButtons: React.FC<VideoKebabMenuButtonsProps> = ({
    onPlayWith,
    onShare,
    onAddToCollection,
    onDelete,
    isDeleting = false,
    onToggleVisibility,
    video,
    sx
}) => {
    const { t } = useLanguage();
    const { visitorMode } = useVisitorMode();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const [kebabMenuAnchor, setKebabMenuAnchor] = useState<null | HTMLElement>(null);

    const handleKebabMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setKebabMenuAnchor(event.currentTarget);
        event.stopPropagation();
    };

    const handleKebabMenuClose = () => {
        setKebabMenuAnchor(null);
    };

    const handlePlayWith = () => {
        const anchor = kebabMenuAnchor;
        handleKebabMenuClose();
        if (anchor) {
            // Pass the anchor element to the parent so it can open the player menu at the same position
            onPlayWith(anchor);
        }
    };

    const handleShare = () => {
        handleKebabMenuClose();
        onShare();
    };

    const handleAddToCollection = () => {
        handleKebabMenuClose();
        onAddToCollection();
    };

    const handleDelete = () => {
        handleKebabMenuClose();
        if (onDelete) onDelete();
    };

    const handleToggleVisibility = () => {
        handleKebabMenuClose();
        if (onToggleVisibility) onToggleVisibility();
    };

    // Close menu on scroll
    React.useEffect(() => {
        if (Boolean(kebabMenuAnchor)) {
            const handleScroll = () => {
                handleKebabMenuClose();
            };
            window.addEventListener('scroll', handleScroll, { capture: true });
            return () => {
                window.removeEventListener('scroll', handleScroll, { capture: true });
            };
        }
    }, [kebabMenuAnchor]);

    return (
        <>
            <Tooltip title="More actions" disableHoverListener={isTouch}>
                <IconButton
                    onClick={handleKebabMenuOpen}
                    sx={{
                        color: kebabMenuAnchor ? 'primary.main' : 'text.secondary',
                        '&:hover': { color: 'primary.main' },
                        ...sx
                    }}
                >
                    <MoreVert />
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={kebabMenuAnchor}
                open={Boolean(kebabMenuAnchor)}
                onClose={handleKebabMenuClose}
                disableScrollLock
                anchorOrigin={{
                    vertical: 'center',
                    horizontal: 'left',
                }}
                transformOrigin={{
                    vertical: 'center',
                    horizontal: 'right',
                }}
                slotProps={{
                    paper: {
                        sx: {
                            minWidth: 'auto',
                            p: 1,
                            px: 2,
                            borderRadius: 4,
                        }
                    }
                }}
            >
                <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
                    <Tooltip title={t('playWith')} disableHoverListener={isTouch}>
                        <Button
                            variant="outlined"
                            color="inherit"
                            onClick={handlePlayWith}
                            sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                        >
                            <Cast />
                        </Button>
                    </Tooltip>
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
                                <Tooltip title={video?.visibility === 0 ? t('showVideo') : t('hideVideo')} disableHoverListener={isTouch}>
                                    <Button
                                        variant="outlined"
                                        color="inherit"
                                        onClick={handleToggleVisibility}
                                        sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                                    >
                                        {video?.visibility === 0 ? <Visibility /> : <VisibilityOff />}
                                    </Button>
                                </Tooltip>
                            )}
                            <Tooltip title={t('addToCollection')} disableHoverListener={isTouch}>
                                <Button
                                    variant="outlined"
                                    color="inherit"
                                    onClick={handleAddToCollection}
                                    sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                                >
                                    <Add />
                                </Button>
                            </Tooltip>
                            {onDelete && (
                                <Tooltip title={t('delete')} disableHoverListener={isTouch}>
                                    <Button
                                        variant="outlined"
                                        color="inherit"
                                        onClick={handleDelete}
                                        disabled={isDeleting}
                                        sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'error.main', borderColor: 'error.main' } }}
                                    >
                                        <Delete />
                                    </Button>
                                </Tooltip>
                            )}
                        </>
                    )}
                </Stack>
            </Menu>
        </>
    );
};

export default VideoKebabMenuButtons;

