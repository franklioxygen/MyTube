import { Menu as MenuIcon, VerticalAlignTop } from '@mui/icons-material';
import {
    alpha,
    AppBar,
    Box,
    ClickAwayListener,
    Fab,
    IconButton,
    Slide,
    Toolbar,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useVideo } from '../../contexts/VideoContext';
import { useAuth } from '../../contexts/AuthContext';
import ActionButtons from './ActionButtons';
import Logo from './Logo';
import MobileMenu from './MobileMenu';
import SearchInput from './SearchInput';
import { HeaderProps } from './types';

const Header: React.FC<HeaderProps> = ({
    onSubmit,
    activeDownloads = [],
    queuedDownloads = [],
    isSearchMode = false,
    searchTerm = '',
    onResetSearch,
    collections = [],
    videos = []
}) => {
    const [videoUrl, setVideoUrl] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [manageAnchorEl, setManageAnchorEl] = useState<null | HTMLElement>(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
    const [websiteName, setWebsiteName] = useState('MyTube');
    const [isScrolled, setIsScrolled] = useState<boolean>(false);
    const [infiniteScroll, setInfiniteScroll] = useState<boolean>(false);
    const [hasActiveSubscriptions, setHasActiveSubscriptions] = useState<boolean>(false);
    const navigate = useNavigate();
    const location = useLocation();
    const theme = useTheme();
    const { mode: themeMode } = useThemeContext();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const { availableTags, selectedTags, handleTagToggle } = useVideo();

    const isSettingsPage = location.pathname.startsWith('/settings');
    const isHomePage = location.pathname === '/';

    useEffect(() => {
        console.log('Header props:', { activeDownloads, queuedDownloads });
    }, [activeDownloads, queuedDownloads]);

    // Check for active subscriptions and tasks
    useEffect(() => {
        if (isVisitor) {
            setHasActiveSubscriptions(false);
            return;
        }

        const checkActiveSubscriptions = async () => {
            try {
                const API_URL = import.meta.env.VITE_API_URL;
                const axios = await import('axios');

                // Fetch subscriptions and tasks
                const [subscriptionsRes, tasksRes] = await Promise.all([
                    axios.default.get(`${API_URL}/subscriptions`).catch(() => ({ data: [] })),
                    axios.default.get(`${API_URL}/subscriptions/tasks`).catch(() => ({ data: [] }))
                ]);

                const subscriptions = subscriptionsRes.data || [];
                const tasks = tasksRes.data || [];

                // Check if there are active subscriptions or active tasks
                const hasActiveTasks = tasks.some((task: any) =>
                    task.status === 'active' || task.status === 'paused'
                );

                setHasActiveSubscriptions(subscriptions.length > 0 || hasActiveTasks);
            } catch (error) {
                console.error('Error checking subscriptions:', error);
                setHasActiveSubscriptions(false);
            }
        };

        checkActiveSubscriptions();
        // Poll every 30 seconds to update indicator (reduced frequency)
        const interval = setInterval(checkActiveSubscriptions, 30000);
        return () => {
            clearInterval(interval);
        };
    }, [isVisitor]);

    useEffect(() => {
        // Fetch settings to get website name and infinite scroll setting
        const fetchSettings = async () => {
            try {
                const API_URL = import.meta.env.VITE_API_URL;
                const response = await import('axios').then(axios => axios.default.get(`${API_URL}/settings`));
                if (response.data) {
                    if (response.data.websiteName) {
                        setWebsiteName(response.data.websiteName);
                    }
                    if (typeof response.data.infiniteScroll !== 'undefined') {
                        setInfiniteScroll(response.data.infiniteScroll);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch settings for header:', error);
            }
        };
        fetchSettings();
    }, []);

    // Scroll detection - for mobile always, for desktop when infinite scroll is enabled on home page
    useEffect(() => {
        const shouldDetectScroll = isMobile || (infiniteScroll && isHomePage);

        if (!shouldDetectScroll) {
            setIsScrolled(false);
            return;
        }

        const handleScroll = () => {
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            setIsScrolled(scrollTop > 50); // Threshold of 50px
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        // Check initial scroll position
        handleScroll();

        return () => {
            window.removeEventListener('scroll', handleScroll);
        };
    }, [isMobile, infiniteScroll, isHomePage]);

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

    // Get background color for gradient
    const backgroundColor = themeMode === 'dark'
        ? theme.palette.background.default
        : theme.palette.background.paper;

    // Create gradient from top (0% transparency) to bottom (100% transparency)
    const gradientBackground = `linear-gradient(to bottom, ${backgroundColor} 0%, ${alpha(backgroundColor, 0)} 100%)`;

    // Desktop background: 30% transparent (70% opacity)
    const desktopBackgroundColor = !isMobile
        ? alpha(theme.palette.background.paper, 0.7)
        : 'background.paper';

    return (
        <>
            <ClickAwayListener onClickAway={() => setMobileMenuOpen(false)}>
                <AppBar
                    position="fixed"
                    color="default"
                    elevation={0}
                    sx={{
                        top: 0,
                        left: 0,
                        right: 0,
                        width: '100%',
                        maxWidth: '100%',
                        zIndex: (theme) => theme.zIndex.appBar,
                        bgcolor: (isMobile && isScrolled) ? 'transparent' : desktopBackgroundColor,
                        backgroundImage: (isMobile && isScrolled) ? gradientBackground : 'none',
                        borderBottom: (isMobile && isScrolled) ? 0 : 1,
                        borderColor: 'divider',
                        transition: 'background-color 0.3s ease-in-out, background-image 0.3s ease-in-out, border-bottom 0.3s ease-in-out, backdrop-filter 0.3s ease-in-out, height 0.3s ease-in-out',
                        backdropFilter: (isMobile && isScrolled) ? 'none' : 'blur(10px)',
                        boxSizing: 'border-box',
                    }}
                >
                    <Toolbar
                        sx={{
                            flexDirection: isMobile ? 'column' : 'row',
                            alignItems: isMobile ? 'stretch' : 'center',
                            py: isMobile ? (isScrolled ? 0.5 : 1) : 0,
                            minHeight: isMobile
                                ? (isScrolled ? '40px !important' : undefined)
                                : undefined,
                            transition: 'min-height 0.3s ease-in-out, padding 0.3s ease-in-out',
                            width: '100%',
                            maxWidth: '100%',
                            boxSizing: 'border-box',
                        }}
                    >
                        {(isMobile && isScrolled) ? (
                            // Simplified header when scrolled
                            <Box sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-start',
                                width: '100%',
                                py: 0,
                                px: 2,
                                transition: 'all 0.3s ease-in-out',
                                '& img': {
                                    height: '24px !important',
                                    transition: 'height 0.3s ease-in-out',
                                },
                                '& .MuiTypography-h5': {
                                    fontSize: '1rem !important',
                                    transition: 'font-size 0.3s ease-in-out',
                                },
                            }}>
                                <Logo websiteName={websiteName} onResetSearch={onResetSearch} />
                            </Box>
                        ) : (
                            // Full header when at top
                            <>
                                {/* Top Bar for Mobile / Main Bar for Desktop */}
                                <Box sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    width: isMobile ? '100%' : 'auto',
                                    flexGrow: isMobile ? 0 : 0,
                                    mr: isMobile ? 0 : 2,
                                    transition: 'all 0.3s ease-in-out',
                                    '& img': {
                                        transition: 'height 0.3s ease-in-out',
                                    },
                                    '& .MuiTypography-h5': {
                                        transition: 'font-size 0.3s ease-in-out',
                                    },
                                }}>
                                    <Logo websiteName={websiteName} onResetSearch={onResetSearch} />

                                    {isMobile && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <ActionButtons
                                                activeDownloads={activeDownloads}
                                                queuedDownloads={queuedDownloads}
                                                downloadsAnchorEl={anchorEl}
                                                manageAnchorEl={manageAnchorEl}
                                                onDownloadsClick={handleDownloadsClick}
                                                onDownloadsClose={handleDownloadsClose}
                                                onManageClick={handleManageClick}
                                                onManageClose={handleManageClose}
                                                hasActiveSubscriptions={hasActiveSubscriptions}
                                            />
                                            <IconButton onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                                                <MenuIcon />
                                            </IconButton>
                                        </Box>
                                    )}
                                </Box>

                                {/* Desktop Layout */}
                                {!isMobile && (
                                    <>
                                        {!isVisitor && (
                                            <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', maxWidth: 800, mx: 'auto' }}>
                                                <SearchInput
                                                    videoUrl={videoUrl}
                                                    setVideoUrl={setVideoUrl}
                                                    isSubmitting={isSubmitting}
                                                    error={error}
                                                    isSearchMode={isSearchMode}
                                                    searchTerm={searchTerm}
                                                    onResetSearch={onResetSearch}
                                                    onSubmit={handleSubmit}
                                                />
                                            </Box>
                                        )}
                                        <Box sx={{ display: 'flex', alignItems: 'center', ml: isVisitor ? 'auto' : 2 }}>
                                            <ActionButtons
                                                activeDownloads={activeDownloads}
                                                queuedDownloads={queuedDownloads}
                                                downloadsAnchorEl={anchorEl}
                                                manageAnchorEl={manageAnchorEl}
                                                onDownloadsClick={handleDownloadsClick}
                                                onDownloadsClose={handleDownloadsClose}
                                                onManageClick={handleManageClick}
                                                onManageClose={handleManageClose}
                                                hasActiveSubscriptions={hasActiveSubscriptions}
                                            />
                                        </Box>
                                    </>
                                )}

                                {/* Mobile Dropdown Layout */}
                                {isMobile && (
                                    <MobileMenu
                                        open={mobileMenuOpen}
                                        videoUrl={videoUrl}
                                        setVideoUrl={setVideoUrl}
                                        isSubmitting={isSubmitting}
                                        error={error}
                                        isSearchMode={isSearchMode}
                                        searchTerm={searchTerm}
                                        onResetSearch={onResetSearch}
                                        onSubmit={handleSubmit}
                                        onClose={() => setMobileMenuOpen(false)}
                                        collections={collections}
                                        videos={videos}
                                        availableTags={availableTags}
                                        selectedTags={selectedTags}
                                        onTagToggle={handleTagToggle}
                                    />
                                )}
                            </>
                        )}
                    </Toolbar>
                </AppBar>
            </ClickAwayListener>
            {/* Spacer to prevent content from going under fixed header */}
            <Box
                sx={{
                    height: () => {
                        // Get the actual toolbar height - it varies based on mobile/desktop and scrolled state
                        if (isMobile && isScrolled) {
                            return '40px'; // Simplified header height on mobile (1/2 of normal)
                        }
                        // Mobile normal header: default Toolbar (64px) + padding (16px) + content ≈ 50px (user adjusted)
                        // Desktop: 64px
                        return isMobile ? '50px' : '64px';
                    },
                    flexShrink: 0,
                    transition: 'height 0.3s ease-in-out',
                }}
            />

            {/* Scroll to top button - mobile always, desktop when infinite scroll is enabled on home page */}
            <Slide
                direction="up"
                in={
                    isScrolled &&
                    !isSettingsPage &&
                    (isMobile || (infiniteScroll && isHomePage))
                }
                mountOnEnter
                unmountOnExit
            >
                <Fab
                    color="primary"
                    size="medium"
                    aria-label="scroll to top"
                    onClick={() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    sx={{
                        position: 'fixed',
                        bottom: 16,
                        left: 16,
                        zIndex: (theme) => theme.zIndex.speedDial,
                        display: {
                            xs: 'flex',
                            md: (infiniteScroll && isHomePage) ? 'flex' : 'none'
                        },
                        opacity: 0.8,
                        '&:hover': {
                            opacity: 1,
                        },
                    }}
                >
                    <VerticalAlignTop />
                </Fab>
            </Slide>
        </>
    );
};

export default Header;

