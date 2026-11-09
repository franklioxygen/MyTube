import { MoreVert } from '@mui/icons-material';
import { IconButton, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import React, { Suspense, useState } from 'react';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';

const VideoKebabMenu = lazyWithRetry(
    () => import('./VideoKebabMenu'),
    'video-kebab-menu',
);

interface VideoKebabMenuButtonsProps {
    onPlayWith: (anchor: HTMLElement) => void;
    onShare: () => void;
    onAddToCollection: () => void;
    onDelete?: () => void;
    isDeleting?: boolean;
    isTogglingVisibility?: boolean;
    onToggleVisibility?: () => void;
    isTogglingLock?: boolean;
    onToggleLock?: () => void;
    isLocked?: boolean;
    onAddTag?: () => void;
    video?: { visibility?: number };
    sx?: any;
}

const VideoKebabMenuButtons: React.FC<VideoKebabMenuButtonsProps> = ({
    onPlayWith,
    onShare,
    onAddToCollection,
    onDelete,
    isDeleting = false,
    isTogglingVisibility = false,
    onToggleVisibility,
    isTogglingLock = false,
    onToggleLock,
    isLocked = false,
    onAddTag,
    video,
    sx
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const [kebabMenuAnchor, setKebabMenuAnchor] = useState<null | HTMLElement>(null);
    const [kebabMenuOpen, setKebabMenuOpen] = useState(false);

    const handleKebabMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setKebabMenuAnchor(event.currentTarget);
        setKebabMenuOpen(true);
        event.stopPropagation();
    };

    const handleKebabMenuClose = () => {
        setKebabMenuOpen(false);
    };

    const handleKebabMenuExited = () => {
        // Retain the anchor while closing so the exit animation can finish.
        if (!kebabMenuOpen) setKebabMenuAnchor(null);
    };

    // Anchored desktop menus follow the card; the mobile sheet scrolls independently.
    React.useEffect(() => {
        if (kebabMenuOpen && !isMobile) {
            const handleScroll = () => {
                handleKebabMenuClose();
            };
            window.addEventListener('scroll', handleScroll, { capture: true });
            return () => {
                window.removeEventListener('scroll', handleScroll, { capture: true });
            };
        }
    }, [kebabMenuOpen, isMobile]);

    return (
        <>
            <Tooltip title="More actions" disableHoverListener={isTouch}>
                <IconButton
                    onClick={handleKebabMenuOpen}
                    aria-haspopup={isMobile ? 'dialog' : 'menu'}
                    aria-expanded={kebabMenuOpen}
                    sx={{
                        color: kebabMenuOpen ? 'primary.main' : 'text.secondary',
                        '&:hover': { color: 'primary.main' },
                        ...sx
                    }}
                >
                    <MoreVert />
                </IconButton>
            </Tooltip>
            {kebabMenuAnchor && (
                <Suspense fallback={null}>
                    <VideoKebabMenu
                        kebabMenuAnchor={kebabMenuAnchor}
                        open={kebabMenuOpen}
                        onClose={handleKebabMenuClose}
                        onExited={handleKebabMenuExited}
                        onPlayWith={onPlayWith}
                        onShare={onShare}
                        onAddToCollection={onAddToCollection}
                        onDelete={onDelete}
                        isDeleting={isDeleting}
                        isTogglingVisibility={isTogglingVisibility}
                        onToggleVisibility={onToggleVisibility}
                        isTogglingLock={isTogglingLock}
                        onToggleLock={onToggleLock}
                        isLocked={isLocked}
                        onAddTag={onAddTag}
                        video={video}
                    />
                </Suspense>
            )}
        </>
    );
};

export default VideoKebabMenuButtons;
