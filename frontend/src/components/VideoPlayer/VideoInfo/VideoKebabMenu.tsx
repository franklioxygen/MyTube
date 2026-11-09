import { Add, Cast, Close, Delete, Label, Lock, LockOpen, Share, Visibility, VisibilityOff } from '@mui/icons-material';
import { Box, Button, Divider, IconButton, Menu, Stack, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import React, { useId } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import ActionSheet from '../../ActionSheet';

interface VideoKebabMenuProps {
    kebabMenuAnchor: HTMLElement;
    open?: boolean;
    onClose: () => void;
    onExited?: () => void;
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
}

interface VideoMenuAction {
    id: string;
    label: string;
    icon: React.ReactElement;
    onClick: () => void;
    loading?: boolean;
    destructive?: boolean;
}

const VideoKebabMenu: React.FC<VideoKebabMenuProps> = ({
    kebabMenuAnchor,
    open = true,
    onClose,
    onExited,
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
}) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const titleId = useId();

    const actions: VideoMenuAction[] = [
        { id: 'playWith', label: t('playWith'), icon: <Cast />, onClick: () => onPlayWith(kebabMenuAnchor) },
        { id: 'share', label: t('share'), icon: <Share />, onClick: onShare },
    ];

    if (userRole !== 'visitor') {
        if (onToggleVisibility) {
            actions.push({
                id: 'visibility',
                label: video?.visibility === 0 ? t('showVideo') : t('hideVideo'),
                icon: video?.visibility === 0 ? <Visibility /> : <VisibilityOff />,
                onClick: onToggleVisibility,
                loading: isTogglingVisibility,
            });
        }
        if (onToggleLock) {
            actions.push({
                id: 'lock', label: isLocked ? t('unlockVideo') : t('lockVideo'),
                icon: isLocked ? <Lock /> : <LockOpen />, onClick: onToggleLock, loading: isTogglingLock,
            });
        }
        actions.push({ id: 'collection', label: t('addToCollection'), icon: <Add />, onClick: onAddToCollection });
        if (onDelete) {
            actions.push({ id: 'delete', label: t('delete'), icon: <Delete />, onClick: onDelete, loading: isDeleting, destructive: true });
        }
        if (onAddTag) {
            actions.push({ id: 'tag', label: t('addTag'), icon: <Label />, onClick: onAddTag });
        }
    }

    const runAction = (action: VideoMenuAction) => {
        if (!open) return;
        onClose();
        action.onClick();
    };

    if (isMobile) {
        const mobileOrder = ['share', 'playWith', 'collection', 'tag', 'visibility', 'lock', 'delete'];
        const mobileActions = [...actions].sort((a, b) => mobileOrder.indexOf(a.id) - mobileOrder.indexOf(b.id));

        return (
            <ActionSheet
                open={open}
                onClose={onClose}
                slotProps={{
                    transition: { onExited },
                    paper: {
                        role: 'dialog',
                        'aria-modal': true,
                        'aria-labelledby': titleId,
                        sx: {
                            borderTopLeftRadius: 16,
                            borderTopRightRadius: 16,
                            maxHeight: '85vh',
                            '@supports (height: 100dvh)': { maxHeight: '85dvh' },
                            overflow: 'hidden',
                            pb: 'env(safe-area-inset-bottom, 0px)',
                        },
                    },
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pl: 2, pr: 1, py: 0.5, flexShrink: 0 }}>
                    <Typography id={titleId} variant="subtitle1" fontWeight={600}>{t('actions')}</Typography>
                    <IconButton aria-label={t('close')} onClick={onClose} sx={{ minWidth: 48, minHeight: 48 }}>
                        <Close />
                    </IconButton>
                </Box>
                <Divider />
                <Stack sx={{ overflowY: 'auto', overscrollBehavior: 'contain', minHeight: 0, px: 1, py: 1 }}>
                    {mobileActions.map(action => (
                        <React.Fragment key={action.id}>
                            {action.destructive && <Divider sx={{ my: 1 }} />}
                            <Button
                                fullWidth
                                color={action.destructive ? 'error' : 'inherit'}
                                startIcon={action.icon}
                                loading={action.loading}
                                aria-label={action.label}
                                onClick={() => runAction(action)}
                                sx={{ justifyContent: 'flex-start', minHeight: 48, flexShrink: 0, px: 2, py: 1.25, textAlign: 'left', textTransform: 'none', overflowWrap: 'anywhere', '& .MuiButton-startIcon': { flexShrink: 0, mr: 2 } }}
                            >
                                {action.label}
                            </Button>
                        </React.Fragment>
                    ))}
                </Stack>
            </ActionSheet>
        );
    }

    return (
        <Menu
            anchorEl={kebabMenuAnchor}
            open={open}
            onClose={onClose}
            disableScrollLock
            anchorOrigin={{ vertical: 'center', horizontal: 'left' }}
            transformOrigin={{ vertical: 'center', horizontal: 'right' }}
            slotProps={{
                transition: { onExited },
                paper: { sx: { minWidth: 'auto', p: 1, px: 2, borderRadius: 4 } },
            }}
        >
            <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
                {actions.map(action => (
                    <Tooltip key={action.id} title={action.label} disableHoverListener={isTouch}>
                        <Button
                            variant="outlined"
                            color="inherit"
                            aria-label={action.label}
                            onClick={() => runAction(action)}
                            loading={action.loading}
                            sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: action.destructive ? 'error.main' : 'primary.main', borderColor: action.destructive ? 'error.main' : 'primary.main' } }}
                        >
                            {action.icon}
                        </Button>
                    </Tooltip>
                ))}
            </Stack>
        </Menu>
    );
};

export default VideoKebabMenu;
