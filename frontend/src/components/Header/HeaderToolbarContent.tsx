import { Menu as MenuIcon } from '@mui/icons-material';
import { Box, IconButton } from '@mui/material';
import { FormEvent } from 'react';

import { Collection, Video } from '../../types';
import ActionButtons from './ActionButtons';
import Logo from './Logo';
import MobileMenu from './MobileMenu';
import SearchInput from './SearchInput';
import { DownloadInfo } from './types';

interface EffectiveTags {
    availableTags: string[];
    selectedTags: string[];
    onTagToggle: (tag: string) => void;
}

interface HeaderToolbarContentProps {
    isMobile: boolean;
    isScrolled: boolean;
    isVisitor: boolean;
    websiteName: string;
    onResetSearch?: () => void;
    activeDownloads: DownloadInfo[];
    queuedDownloads: DownloadInfo[];
    downloadsAnchorEl: null | HTMLElement;
    manageAnchorEl: null | HTMLElement;
    onDownloadsClick: (event: React.MouseEvent<HTMLElement>) => void;
    onDownloadsClose: () => void;
    onManageClick: (event: React.MouseEvent<HTMLElement>) => void;
    onManageClose: () => void;
    hasActiveSubscriptions: boolean;
    showThemeButton: boolean;
    mobileMenuOpen: boolean;
    onToggleMobileMenu: () => void;
    onCloseMobileMenu: () => void;
    videoUrl: string;
    setVideoUrl: (url: string) => void;
    isSubmitting: boolean;
    error: string;
    isSearchMode: boolean;
    searchTerm: string;
    onSubmit: (event: FormEvent) => void;
    collections: Collection[];
    videos: Video[];
    showTagsInMobileMenu: boolean;
    effectiveTags: EffectiveTags;
}

const HeaderToolbarContent: React.FC<HeaderToolbarContentProps> = ({
    isMobile,
    isScrolled,
    isVisitor,
    websiteName,
    onResetSearch,
    activeDownloads,
    queuedDownloads,
    downloadsAnchorEl,
    manageAnchorEl,
    onDownloadsClick,
    onDownloadsClose,
    onManageClick,
    onManageClose,
    hasActiveSubscriptions,
    showThemeButton,
    mobileMenuOpen,
    onToggleMobileMenu,
    onCloseMobileMenu,
    videoUrl,
    setVideoUrl,
    isSubmitting,
    error,
    isSearchMode,
    searchTerm,
    onSubmit,
    collections,
    videos,
    showTagsInMobileMenu,
    effectiveTags
}) => {
    const actionButtons = (
        <ActionButtons
            activeDownloads={activeDownloads}
            queuedDownloads={queuedDownloads}
            downloadsAnchorEl={downloadsAnchorEl}
            manageAnchorEl={manageAnchorEl}
            onDownloadsClick={onDownloadsClick}
            onDownloadsClose={onDownloadsClose}
            onManageClick={onManageClick}
            onManageClose={onManageClose}
            hasActiveSubscriptions={hasActiveSubscriptions}
            showThemeButton={showThemeButton}
        />
    );

    if (isMobile && isScrolled) {
        return (
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    width: '100%',
                    py: 0,
                    px: 2,
                    transition: 'all 0.3s ease-in-out',
                    '& img': {
                        height: '24px !important',
                        transition: 'height 0.3s ease-in-out'
                    },
                    '& .MuiTypography-h5': {
                        fontSize: '1rem !important',
                        transition: 'font-size 0.3s ease-in-out'
                    }
                }}
            >
                <Logo websiteName={websiteName} onResetSearch={onResetSearch} />
            </Box>
        );
    }

    const desktopActionsMarginLeft = isVisitor ? 'auto' : 2;

    return (
        <>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: isMobile ? '100%' : 'auto',
                    mr: isMobile ? 0 : 2,
                    transition: 'all 0.3s ease-in-out',
                    '& img': {
                        transition: 'height 0.3s ease-in-out'
                    },
                    '& .MuiTypography-h5': {
                        transition: 'font-size 0.3s ease-in-out'
                    }
                }}
            >
                <Logo websiteName={websiteName} onResetSearch={onResetSearch} />

                {isMobile && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {actionButtons}
                        <IconButton onClick={onToggleMobileMenu}>
                            <MenuIcon />
                        </IconButton>
                    </Box>
                )}
            </Box>

            {!isMobile && (
                <>
                    <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', maxWidth: 800, mx: 'auto' }}>
                        <SearchInput
                            videoUrl={videoUrl}
                            setVideoUrl={setVideoUrl}
                            isSubmitting={isSubmitting}
                            error={error}
                            isSearchMode={isSearchMode}
                            searchTerm={searchTerm}
                            onResetSearch={onResetSearch}
                            onSubmit={onSubmit}
                        />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', ml: desktopActionsMarginLeft }}>
                        {actionButtons}
                    </Box>
                </>
            )}

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
                    onSubmit={onSubmit}
                    onClose={onCloseMobileMenu}
                    collections={collections}
                    videos={videos}
                    showTags={showTagsInMobileMenu}
                    availableTags={effectiveTags.availableTags}
                    selectedTags={effectiveTags.selectedTags}
                    onTagToggle={effectiveTags.onTagToggle}
                />
            )}
        </>
    );
};

export default HeaderToolbarContent;
