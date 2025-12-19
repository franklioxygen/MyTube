import { Menu as MenuIcon } from '@mui/icons-material';
import {
    AppBar,
    Box,
    ClickAwayListener,
    IconButton,
    Toolbar,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { useVideo } from '../../contexts/VideoContext';
import { useVisitorMode } from '../../contexts/VisitorModeContext';
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
    const navigate = useNavigate();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { t } = useLanguage();
    const { visitorMode } = useVisitorMode();
    const { availableTags, selectedTags, handleTagToggle } = useVideo();

    useEffect(() => {
        console.log('Header props:', { activeDownloads, queuedDownloads });
    }, [activeDownloads, queuedDownloads]);

    useEffect(() => {
        // Fetch settings to get website name
        const fetchSettings = async () => {
            try {
                const API_URL = import.meta.env.VITE_API_URL;
                const response = await import('axios').then(axios => axios.default.get(`${API_URL}/settings`));
                if (response.data && response.data.websiteName) {
                    setWebsiteName(response.data.websiteName);
                }
            } catch (error) {
                console.error('Failed to fetch settings for header:', error);
            }
        };
        fetchSettings();
    }, []);

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

    return (
        <ClickAwayListener onClickAway={() => setMobileMenuOpen(false)}>
            <AppBar position="sticky" color="default" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
                <Toolbar sx={{ flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', py: isMobile ? 1 : 0 }}>
                    {/* Top Bar for Mobile / Main Bar for Desktop */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: isMobile ? '100%' : 'auto', flexGrow: isMobile ? 0 : 0, mr: isMobile ? 0 : 2 }}>
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
                            {!visitorMode && (
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
                            <Box sx={{ display: 'flex', alignItems: 'center', ml: visitorMode ? 'auto' : 2 }}>
                                <ActionButtons
                                    activeDownloads={activeDownloads}
                                    queuedDownloads={queuedDownloads}
                                    downloadsAnchorEl={anchorEl}
                                    manageAnchorEl={manageAnchorEl}
                                    onDownloadsClick={handleDownloadsClick}
                                    onDownloadsClose={handleDownloadsClose}
                                    onManageClick={handleManageClick}
                                    onManageClose={handleManageClose}
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
                </Toolbar>
            </AppBar>
        </ClickAwayListener>
    );
};

export default Header;

