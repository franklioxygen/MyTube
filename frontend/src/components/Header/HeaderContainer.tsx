import { VerticalAlignTop } from '@mui/icons-material';
import {
    alpha,
    AppBar,
    Box,
    ClickAwayListener,
    Fab,
    Slide,
    Toolbar,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { usePageTagFilterOptional } from '../../contexts/PageTagFilterContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useVideo } from '../../contexts/VideoContext';
import { useSettings } from '../../hooks/useSettings';
import HeaderToolbarContent from './HeaderToolbarContent';
import { HeaderProps } from './types';
import { useHeaderPreferences } from './useHeaderPreferences';
import { useHeaderScrollState } from './useHeaderScrollState';
import { useHeaderSubmission } from './useHeaderSubmission';
import { useHeaderSubscriptions } from './useHeaderSubscriptions';

const HeaderContainer: React.FC<HeaderProps> = ({
    onSubmit,
    activeDownloads = [],
    queuedDownloads = [],
    isSearchMode = false,
    searchTerm = '',
    onResetSearch,
    collections = [],
    videos = []
}) => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [manageAnchorEl, setManageAnchorEl] = useState<null | HTMLElement>(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const navigate = useNavigate();
    const location = useLocation();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { mode: themeMode } = useThemeContext();
    const { t } = useLanguage();
    const { userRole, isAuthenticated } = useAuth();
    const { data: settingsData } = useSettings();
    const { availableTags, selectedTags, handleTagToggle } = useVideo();

    const isVisitor = userRole === 'visitor';
    const pageTagFilter = usePageTagFilterOptional()?.pageTagFilter ?? null;
    const effectiveTags = pageTagFilter ?? {
        availableTags,
        selectedTags,
        onTagToggle: handleTagToggle
    };

    const { websiteName, infiniteScroll, showThemeButton } = useHeaderPreferences(
        isAuthenticated,
        settingsData
    );
    const hasActiveSubscriptions = useHeaderSubscriptions(isVisitor);

    const isSettingsPage = location.pathname.startsWith('/settings');
    const isHomePage = location.pathname === '/';
    const isAuthorPage = location.pathname.startsWith('/author/');
    const isCollectionPage = location.pathname.startsWith('/collection/');
    const showTagsInMobileMenu = isHomePage || isAuthorPage || isCollectionPage;
    const isScrolled = useHeaderScrollState(isMobile, infiniteScroll, isHomePage);

    const {
        videoUrl,
        setVideoUrl,
        isSubmitting,
        error,
        handleSubmit
    } = useHeaderSubmission({
        onSubmit,
        isVisitor,
        navigate,
        t,
        onCloseMobileMenu: () => setMobileMenuOpen(false)
    });

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

    const headerBackgroundColor = themeMode === 'dark'
        ? theme.palette.background.default
        : theme.palette.background.paper;
    const gradientBackground = `linear-gradient(to bottom, ${headerBackgroundColor} 0%, ${alpha(headerBackgroundColor, 0)} 100%)`;
    const desktopBackgroundColor = isMobile
        ? 'background.paper'
        : alpha(theme.palette.background.paper, 0.7);
    const collapsedMobileHeader = isMobile && isScrolled;
    const toolbarPaddingY = isMobile ? (isScrolled ? 0.5 : 1) : 0;
    const toolbarMinHeight = collapsedMobileHeader ? '40px !important' : undefined;
    const spacerHeight = collapsedMobileHeader ? '40px' : isMobile ? '50px' : '64px';
    const showScrollTopButton = isScrolled && !isSettingsPage && (isMobile || (infiniteScroll && isHomePage));
    const desktopFabDisplay = infiniteScroll && isHomePage ? 'flex' : 'none';

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
                        zIndex: (muiTheme) => muiTheme.zIndex.appBar,
                        bgcolor: collapsedMobileHeader ? 'transparent' : desktopBackgroundColor,
                        backgroundImage: collapsedMobileHeader ? gradientBackground : 'none',
                        borderBottom: collapsedMobileHeader ? 0 : 1,
                        borderColor: 'divider',
                        transition: 'background-color 0.3s ease-in-out, background-image 0.3s ease-in-out, border-bottom 0.3s ease-in-out, backdrop-filter 0.3s ease-in-out, height 0.3s ease-in-out',
                        backdropFilter: collapsedMobileHeader ? 'none' : 'blur(10px)',
                        boxSizing: 'border-box'
                    }}
                >
                    <Toolbar
                        sx={{
                            flexDirection: isMobile ? 'column' : 'row',
                            alignItems: isMobile ? 'stretch' : 'center',
                            py: toolbarPaddingY,
                            minHeight: toolbarMinHeight,
                            transition: 'min-height 0.3s ease-in-out, padding 0.3s ease-in-out',
                            width: '100%',
                            maxWidth: '100%',
                            boxSizing: 'border-box'
                        }}
                    >
                        <HeaderToolbarContent
                            isMobile={isMobile}
                            isScrolled={isScrolled}
                            isVisitor={isVisitor}
                            websiteName={websiteName}
                            onResetSearch={onResetSearch}
                            activeDownloads={activeDownloads}
                            queuedDownloads={queuedDownloads}
                            downloadsAnchorEl={anchorEl}
                            manageAnchorEl={manageAnchorEl}
                            onDownloadsClick={handleDownloadsClick}
                            onDownloadsClose={handleDownloadsClose}
                            onManageClick={handleManageClick}
                            onManageClose={handleManageClose}
                            hasActiveSubscriptions={hasActiveSubscriptions}
                            showThemeButton={showThemeButton}
                            mobileMenuOpen={mobileMenuOpen}
                            onToggleMobileMenu={() => setMobileMenuOpen((open) => !open)}
                            onCloseMobileMenu={() => setMobileMenuOpen(false)}
                            videoUrl={videoUrl}
                            setVideoUrl={setVideoUrl}
                            isSubmitting={isSubmitting}
                            error={error}
                            isSearchMode={isSearchMode}
                            searchTerm={searchTerm}
                            onSubmit={handleSubmit}
                            collections={collections}
                            videos={videos}
                            showTagsInMobileMenu={showTagsInMobileMenu}
                            effectiveTags={effectiveTags}
                        />
                    </Toolbar>
                </AppBar>
            </ClickAwayListener>

            <Box
                sx={{
                    height: spacerHeight,
                    flexShrink: 0,
                    transition: 'height 0.3s ease-in-out'
                }}
            />

            <Slide direction="up" in={showScrollTopButton} mountOnEnter unmountOnExit>
                <Fab
                    color="primary"
                    size="medium"
                    aria-label="scroll to top"
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    sx={{
                        position: 'fixed',
                        bottom: 16,
                        left: 16,
                        zIndex: (muiTheme) => muiTheme.zIndex.speedDial,
                        display: {
                            xs: 'flex',
                            md: desktopFabDisplay
                        },
                        opacity: 0.8,
                        '&:hover': {
                            opacity: 1
                        }
                    }}
                >
                    <VerticalAlignTop />
                </Fab>
            </Slide>
        </>
    );
};

export default HeaderContainer;
