import { ChevronLeft, ChevronRight, Download, Subscriptions } from '@mui/icons-material';
import { useEffect, useId, useRef, useState } from 'react';
import {
    alpha,
    Badge,
    Box,
    CircularProgress,
    Divider,
    Fade,
    Menu,
    MenuItem,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { useNavigate } from 'react-router';
import { useLanguage } from '../../contexts/LanguageContext';
import { shadow } from '../../theme/colors';
import { DownloadInfo } from './types';

interface DownloadsMenuProps {
    anchorEl: HTMLElement | null;
    onClose: () => void;
    activeDownloads: DownloadInfo[];
    queuedDownloads: DownloadInfo[];
    hasActiveSubscriptions?: boolean;
}

const DownloadsMenu: React.FC<DownloadsMenuProps> = ({
    anchorEl,
    onClose,
    activeDownloads,
    queuedDownloads,
    hasActiveSubscriptions = false
}) => {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [subscriptionAnchorEl, setSubscriptionAnchorEl] = useState<HTMLElement | null>(null);
    const subscriptionMenuId = useId();
    const subscriptionTriggerId = useId();
    const subscriptionListRef = useRef<HTMLUListElement>(null);
    const isSubscriptionMenuOpen = Boolean(anchorEl && subscriptionAnchorEl);
    // Desktop opens left to stay clear of the header's right screen edge.
    const openKey = !isMobile || theme.direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const closeKey = openKey === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    // Also accept standard menu keys when the visual direction differs.
    const standardOpenKey = theme.direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const standardCloseKey = standardOpenKey === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';

    useEffect(() => {
        if (!isSubscriptionMenuOpen) return;
        // Let the nested modal focus traps settle before focusing an item.
        const frame = requestAnimationFrame(() => {
            const list = subscriptionListRef.current;
            if (list && !list.contains(list.ownerDocument.activeElement)) {
                list.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [isSubscriptionMenuOpen]);

    const handleClose = () => {
        setSubscriptionAnchorEl(null);
        onClose();
    };

    const closeSubscriptionMenu = () => {
        const trigger = subscriptionAnchorEl;
        setSubscriptionAnchorEl(null);
        requestAnimationFrame(() => {
            if (trigger?.isConnected) trigger.focus();
        });
    };

    const navigateToSubscriptions = (type?: 'author' | 'playlist') => {
        handleClose();
        navigate(type ? `/subscriptions?type=${type}` : '/subscriptions');
    };

    return (
        <>
        <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleClose}
            disableEnforceFocus={isSubscriptionMenuOpen}
            disableScrollLock
            slotProps={{
                transition: { onExited: () => setSubscriptionAnchorEl(null) },
                paper: {
                    elevation: 0,
                    sx: {
                        overflow: 'visible',
                        filter: shadow.dropShadow32,
                        mt: 1.5,
                        width: 320,
                        maxHeight: '50vh',
                        overflowY: 'auto',
                        bgcolor: !isMobile ? alpha(theme.palette.background.paper, 0.7) : 'background.paper',
                        backdropFilter: !isMobile ? 'blur(10px)' : 'none',
                        '& .MuiAvatar-root': {
                            width: 32,
                            height: 32,
                            ml: -0.5,
                            mr: 1,
                        },
                        '&:before': {
                            content: '""',
                            display: 'block',
                            position: 'absolute',
                            top: 0,
                            right: 14,
                            width: 10,
                            height: 10,
                            bgcolor: !isMobile ? alpha(theme.palette.background.paper, 0.7) : 'background.paper',
                            transform: 'translateY(-50%) rotate(45deg)',
                            zIndex: 0,
                        },
                    },
                }
            }}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            slots={{ transition: Fade }}
        >
            <MenuItem onClick={() => { handleClose(); navigate('/downloads'); }}>
                <Download sx={{ mr: 2 }} /> {t('manageDownloads') || 'Manage Downloads'}
            </MenuItem>
            <MenuItem
                id={subscriptionTriggerId}
                aria-haspopup="menu"
                aria-expanded={isSubscriptionMenuOpen}
                aria-controls={isSubscriptionMenuOpen ? subscriptionMenuId : undefined}
                onClick={(event) => setSubscriptionAnchorEl(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
                    if (event.key === openKey || event.key === standardOpenKey) {
                        event.preventDefault();
                        setSubscriptionAnchorEl(event.currentTarget);
                    }
                }}
            >
                <Badge
                    variant="dot"
                    color="primary"
                    invisible={!hasActiveSubscriptions}
                    sx={{ mr: 2, display: 'flex', alignItems: 'center' }}
                >
                    <Subscriptions />
                </Badge>
                <Box component="span" sx={{ flexGrow: 1 }}>{t('subscriptions')}</Box>
                {openKey === 'ArrowLeft' ? <ChevronLeft /> : <ChevronRight />}
            </MenuItem>
            {(activeDownloads.length > 0 || queuedDownloads.length > 0) && <Divider />}

            {activeDownloads.map((download) => (
                <MenuItem key={download.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, py: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <CircularProgress
                            variant={download.progress ? "determinate" : "indeterminate"}
                            value={download.progress || 0}
                            size={20}
                            sx={{ mr: 2, flexShrink: 0 }}
                        />
                        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                            <Typography variant="body2" noWrap sx={{ fontWeight: 'bold' }}>
                                {download.filename || download.title}
                            </Typography>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                    {download.progress ? `${download.progress.toFixed(1)}%` : t('downloading')}
                                </Typography>
                                {download.totalSize && (
                                    <Typography variant="caption" color="text.secondary">
                                        {download.totalSize}
                                    </Typography>
                                )}
                            </Box>
                            {download.speed && (
                                <Typography variant="caption" color="text.secondary" display="block">
                                    {download.speed}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                </MenuItem>
            ))}

            {queuedDownloads.length > 0 && [
                <Box key="queued-header" sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold">
                        {t('queued')} ({queuedDownloads.length})
                    </Typography>
                </Box>,
                ...queuedDownloads.map((download) => (
                    <MenuItem key={download.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, py: 1.5, opacity: 0.7 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                            <CircularProgress
                                variant="indeterminate"
                                size={16}
                                sx={{ mr: 2, flexShrink: 0, color: 'text.disabled' }}
                            />
                            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                                <Typography variant="body2" noWrap>
                                    {download.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {t('waitingInQueue')}
                                </Typography>
                            </Box>
                        </Box>
                    </MenuItem>
                ))
            ]}
        </Menu>
        <Menu
            anchorEl={subscriptionAnchorEl}
            open={isSubscriptionMenuOpen}
            onClose={(_event, reason) => {
                if (reason === 'escapeKeyDown') closeSubscriptionMenu();
                else handleClose();
            }}
            disableScrollLock
            disableRestoreFocus
            anchorOrigin={{ vertical: isMobile ? 'bottom' : 'top', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: isMobile ? 'left' : 'right' }}
            slotProps={{
                paper: { sx: { minWidth: 220, maxWidth: 'calc(100vw - 32px)' } },
                list: {
                    ref: subscriptionListRef,
                    id: subscriptionMenuId,
                    'aria-labelledby': subscriptionTriggerId,
                    onKeyDown: (event: React.KeyboardEvent<HTMLUListElement>) => {
                        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
                        if (event.key === closeKey || event.key === standardCloseKey) {
                            event.preventDefault();
                            event.stopPropagation();
                            closeSubscriptionMenu();
                        }
                    },
                },
            }}
        >
            <MenuItem onClick={() => navigateToSubscriptions()}>{t('allSubscriptions')}</MenuItem>
            <MenuItem onClick={() => navigateToSubscriptions('author')}>{t('authorSubscriptions')}</MenuItem>
            <MenuItem onClick={() => navigateToSubscriptions('playlist')}>{t('playlistSubscriptions')}</MenuItem>
        </Menu>
        </>
    );
};

export default DownloadsMenu;

