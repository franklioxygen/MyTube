import { MoreVert } from '@mui/icons-material';
import { IconButton, Tooltip, useMediaQuery } from '@mui/material';
import React, { Suspense, lazy, useState } from 'react';

const VideoKebabMenu = lazy(() => import('./VideoKebabMenu'));

interface VideoKebabMenuButtonsProps {
    onPlayWith: (anchor: HTMLElement) => void;
    onShare: () => void;
    onAddToCollection: () => void;
    onDelete?: () => void;
    isDeleting?: boolean;
    onToggleVisibility?: () => void;
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
    onToggleVisibility,
    onAddTag,
    video,
    sx
}) => {
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const [kebabMenuAnchor, setKebabMenuAnchor] = useState<null | HTMLElement>(null);

    const handleKebabMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setKebabMenuAnchor(event.currentTarget);
        event.stopPropagation();
    };

    const handleKebabMenuClose = () => {
        setKebabMenuAnchor(null);
    };

    // Close menu on scroll
    React.useEffect(() => {
        if (kebabMenuAnchor) {
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
            {kebabMenuAnchor && (
                <Suspense fallback={null}>
                    <VideoKebabMenu
                        kebabMenuAnchor={kebabMenuAnchor}
                        onClose={handleKebabMenuClose}
                        onPlayWith={onPlayWith}
                        onShare={onShare}
                        onAddToCollection={onAddToCollection}
                        onDelete={onDelete}
                        isDeleting={isDeleting}
                        onToggleVisibility={onToggleVisibility}
                        onAddTag={onAddTag}
                        video={video}
                    />
                </Suspense>
            )}
        </>
    );
};

export default VideoKebabMenuButtons;
