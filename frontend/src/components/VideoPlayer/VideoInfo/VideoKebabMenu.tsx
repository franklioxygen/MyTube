import { Add, Cast, Delete, Label, Share, Visibility, VisibilityOff } from '@mui/icons-material';
import { Button, Menu, Stack, Tooltip, useMediaQuery } from '@mui/material';
import React from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useLanguage } from '../../../contexts/LanguageContext';

interface VideoKebabMenuProps {
    kebabMenuAnchor: HTMLElement;
    onClose: () => void;
    onPlayWith: (anchor: HTMLElement) => void;
    onShare: () => void;
    onAddToCollection: () => void;
    onDelete?: () => void;
    isDeleting?: boolean;
    onToggleVisibility?: () => void;
    onAddTag?: () => void;
    video?: { visibility?: number };
}

const VideoKebabMenu: React.FC<VideoKebabMenuProps> = ({
    kebabMenuAnchor,
    onClose,
    onPlayWith,
    onShare,
    onAddToCollection,
    onDelete,
    isDeleting = false,
    onToggleVisibility,
    onAddTag,
    video,
}) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    const handlePlayWith = () => {
        onClose();
        onPlayWith(kebabMenuAnchor);
    };

    const handleShare = () => {
        onClose();
        onShare();
    };

    const handleAddToCollection = () => {
        onClose();
        onAddToCollection();
    };

    const handleDelete = () => {
        onClose();
        onDelete?.();
    };

    const handleToggleVisibility = () => {
        onClose();
        onToggleVisibility?.();
    };

    return (
        <Menu
            anchorEl={kebabMenuAnchor}
            open={true}
            onClose={onClose}
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
                {!isVisitor && (
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
                        {onAddTag && (
                            <Tooltip title={t('addTag') || 'Add Tag'} disableHoverListener={isTouch}>
                                <Button
                                    variant="outlined"
                                    color="inherit"
                                    onClick={() => {
                                        onClose();
                                        onAddTag();
                                    }}
                                    sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                                >
                                    <Label />
                                </Button>
                            </Tooltip>
                        )}
                    </>
                )}
            </Stack>
        </Menu>
    );
};

export default VideoKebabMenu;
