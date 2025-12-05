import {
    Brightness4,
    Brightness7,
    Clear,
    Download,
    Help,
    Menu as MenuIcon,
    Search,
    Settings,
    Subscriptions,
    VideoLibrary
} from '@mui/icons-material';
import {
    AppBar,
    Badge,
    Box,
    Button,
    CircularProgress,
    ClickAwayListener,
    Collapse,
    Fade,
    IconButton,
    InputAdornment,
    Menu,
    MenuItem,
    Stack,
    TextField,
    Toolbar,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import logo from '../assets/logo.svg';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { Collection, Video } from '../types';
import AuthorsList from './AuthorsList';
import Collections from './Collections';
import TagsList from './TagsList';


interface DownloadInfo {
    id: string;
    title: string;
    timestamp?: number;
    filename?: string;
    totalSize?: string;
    downloadedSize?: string;
    progress?: number;
    speed?: string;
}

interface HeaderProps {
    onSubmit: (url: string) => Promise<any>;
    onSearch: (term: string) => Promise<any>;
    activeDownloads?: DownloadInfo[];
    queuedDownloads?: DownloadInfo[];
    isSearchMode?: boolean;
    searchTerm?: string;
    onResetSearch?: () => void;
    theme: string;
    toggleTheme: () => void;
    collections?: Collection[];
    videos?: Video[];
}

const Header: React.FC<HeaderProps> = ({
    onSubmit,
    onSearch,
    activeDownloads = [],
    queuedDownloads = [],
    isSearchMode = false,
    searchTerm = '',
    onResetSearch,
    theme: currentThemeMode,
    toggleTheme,
    collections = [],
    videos = []
}) => {
    const [videoUrl, setVideoUrl] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [manageAnchorEl, setManageAnchorEl] = useState<null | HTMLElement>(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
    const navigate = useNavigate();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { t } = useLanguage();
    const { availableTags, selectedTags, handleTagToggle } = useVideo();




    useEffect(() => {
        console.log('Header props:', { activeDownloads, queuedDownloads });
    }, [activeDownloads, queuedDownloads]);

    const handleDownloadsClick = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleDownloadsClose = () => {
        setAnchorEl(null);
    };

    const handleManageClick = (event: React.MouseEvent<HTMLElement>) => {
        setManageAnchorEl(event.currentTarget);
    };

    const handleManageClose = () => {
        setManageAnchorEl(null);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        if (!videoUrl.trim()) {
            setError(t('pleaseEnterUrlOrSearchTerm'));
            return;
        }

        // Generic URL check
        const urlRegex = /^(https?:\/\/[^\s]+)/;
        const isUrl = urlRegex.test(videoUrl);

        setError('');
        setIsSubmitting(true);

        try {
            if (isUrl) {
                const result = await onSubmit(videoUrl);
                if (result.success) {
                    setVideoUrl('');
                    setMobileMenuOpen(false);
                } else if (result.isSearchTerm) {
                    setVideoUrl('');
                    setMobileMenuOpen(false);
                    navigate(`/search?q=${encodeURIComponent(videoUrl)}`);
                } else {
                    setError(result.error);
                }
            } else {
                setVideoUrl('');
                setMobileMenuOpen(false);
                navigate(`/search?q=${encodeURIComponent(videoUrl)}`);
            }
        } catch (err) {
            setError(t('unexpectedErrorOccurred'));
            console.error(err);
        } finally {
            setIsSubmitting(false);
        }
    };



    const renderActionButtons = () => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>


            {(
                <>
                    <IconButton color="inherit" onClick={handleDownloadsClick}>
                        <Badge badgeContent={activeDownloads.length + queuedDownloads.length} color="secondary">
                            <Download />
                        </Badge>
                    </IconButton>
                    <Menu
                        anchorEl={anchorEl}
                        open={Boolean(anchorEl)}
                        onClose={handleDownloadsClose}
                        slotProps={{
                            paper: {
                                elevation: 0,
                                sx: {
                                    overflow: 'visible',
                                    filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                                    mt: 1.5,
                                    width: 320,
                                    maxHeight: '50vh',
                                    overflowY: 'auto',
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
                                        bgcolor: 'background.paper',
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
                        <MenuItem onClick={() => { handleDownloadsClose(); navigate('/downloads'); }}>
                            <Download sx={{ mr: 2 }} /> {t('manageDownloads') || 'Manage Downloads'}
                        </MenuItem>

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
                                                {download.progress ? `${download.progress.toFixed(1)}%` : 'Downloading...'}
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
                </>
            )}
            <IconButton onClick={toggleTheme} color="inherit">
                {currentThemeMode === 'dark' ? <Brightness7 /> : <Brightness4 />}
            </IconButton>

            {!isMobile && (
                <Tooltip title={t('manage')}>
                    <IconButton
                        color="inherit"
                        onClick={handleManageClick}
                    >
                        <Settings />
                    </IconButton>
                </Tooltip>
            )}
            <Menu
                anchorEl={manageAnchorEl}
                open={Boolean(manageAnchorEl)}
                onClose={handleManageClose}
                slotProps={{
                    paper: {
                        elevation: 0,
                        sx: {
                            overflow: 'visible',
                            filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                            mt: 1.5,
                            width: 320,
                            '&:before': {
                                content: '""',
                                display: 'block',
                                position: 'absolute',
                                top: 0,
                                right: 14,
                                width: 10,
                                height: 10,
                                bgcolor: 'background.paper',
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
                <MenuItem onClick={() => { handleManageClose(); navigate('/manage'); }}>
                    <VideoLibrary sx={{ mr: 2 }} /> {t('manageContent')}
                </MenuItem>
                <MenuItem onClick={() => { handleManageClose(); navigate('/subscriptions'); }}>
                    <Subscriptions sx={{ mr: 2 }} /> {t('subscriptions')}
                </MenuItem>
                <MenuItem onClick={() => { handleManageClose(); navigate('/settings'); }}>
                    <Settings sx={{ mr: 2 }} /> {t('settings')}
                </MenuItem>
                <MenuItem onClick={() => { handleManageClose(); navigate('/instruction'); }}>
                    <Help sx={{ mr: 2 }} /> {t('instruction')}
                </MenuItem>
            </Menu>
        </Box>
    );

    const renderSearchInput = () => (
        <Box component="form" onSubmit={handleSubmit} sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', width: '100%' }}>
            <TextField
                fullWidth
                variant="outlined"
                placeholder={t('enterUrlOrSearchTerm')}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                disabled={isSubmitting}
                error={!!error}
                helperText={error}
                size="small"
                slotProps={{
                    input: {
                        endAdornment: (
                            <InputAdornment position="end">
                                {isSearchMode && searchTerm && (
                                    <IconButton onClick={onResetSearch} edge="end" size="small" sx={{ mr: 0.5 }}>
                                        <Clear />
                                    </IconButton>
                                )}
                                <Button
                                    type="submit"
                                    variant="contained"
                                    disabled={isSubmitting}
                                    sx={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, height: '100%', minWidth: 'auto', px: 3 }}
                                >
                                    {isSubmitting ? <CircularProgress size={24} color="inherit" /> : <Search />}
                                </Button>
                            </InputAdornment>
                        ),
                        sx: { pr: 0, borderRadius: 2 }
                    }
                }}
            />
        </Box>
    );

    return (
        <ClickAwayListener onClickAway={() => setMobileMenuOpen(false)}>
            <AppBar position="sticky" color="default" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
                <Toolbar sx={{ flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', py: isMobile ? 1 : 0 }}>
                    {/* Top Bar for Mobile / Main Bar for Desktop */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: isMobile ? '100%' : 'auto', flexGrow: isMobile ? 0 : 0, mr: isMobile ? 0 : 2 }}>
                        <Link to="/" onClick={onResetSearch} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', color: 'inherit' }}>
                            <img src={logo} alt="MyTube Logo" height={40} />
                            <Typography variant="h5" sx={{ ml: 1, fontWeight: 'bold' }}>
                                {t('myTube')}
                            </Typography>
                        </Link>

                        {isMobile && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {renderActionButtons()}
                                <IconButton onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                                    <MenuIcon />
                                </IconButton>
                            </Box>
                        )}
                    </Box>

                    {/* Desktop Layout */}
                    {!isMobile && (
                        <>
                            <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', maxWidth: 800, mx: 'auto' }}>
                                {renderSearchInput()}
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', ml: 2 }}>
                                {renderActionButtons()}
                            </Box>
                        </>
                    )}

                    {/* Mobile Dropdown Layout */}
                    {isMobile && (
                        <Collapse in={mobileMenuOpen} sx={{ width: '100%' }}>
                            <Box sx={{ maxHeight: '80vh', overflowY: 'auto' }}>
                                <Stack spacing={2} sx={{ py: 2 }}>
                                    {/* Row 1: Search Input */}
                                    <Box>
                                        {renderSearchInput()}
                                    </Box>

                                    {/* Mobile Navigation Buttons - Moved under search */}
                                    <Box sx={{ display: 'flex', gap: 2 }}>
                                        <Button
                                            component={Link}
                                            to="/manage"
                                            variant="outlined"
                                            fullWidth
                                            onClick={() => setMobileMenuOpen(false)}
                                            startIcon={<VideoLibrary />}
                                        >
                                            {t('manageVideos')}
                                        </Button>
                                        <Button
                                            component={Link}
                                            to="/settings"
                                            variant="outlined"
                                            fullWidth
                                            onClick={() => setMobileMenuOpen(false)}
                                            startIcon={<Settings />}
                                        >
                                            {t('settings')}
                                        </Button>
                                    </Box>

                                    {/* Row 2: Action Buttons - Removed from here for mobile */}
                                    {/* <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                                    {renderActionButtons()}
                                </Box> */}

                                    {/* Mobile Navigation Items */}
                                    <Box sx={{ mt: 2 }}>
                                        <Collections
                                            collections={collections}
                                            onItemClick={() => setMobileMenuOpen(false)}
                                        />
                                        <Box sx={{ mt: 2 }}>
                                            <TagsList
                                                availableTags={availableTags}
                                                selectedTags={selectedTags}
                                                onTagToggle={handleTagToggle}
                                            />
                                        </Box>
                                        <Box sx={{ mt: 2 }}>
                                            <AuthorsList
                                                videos={videos}
                                                onItemClick={() => setMobileMenuOpen(false)}
                                            />
                                        </Box>
                                    </Box>
                                </Stack>
                            </Box>
                        </Collapse>
                    )}
                </Toolbar>



            </AppBar>
        </ClickAwayListener>
    );
};

export default Header;
