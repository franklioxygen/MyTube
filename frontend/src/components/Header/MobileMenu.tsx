import { Logout, Settings, VideoLibrary } from '@mui/icons-material';
import { Box, Button, Collapse, Divider, Stack } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSettings } from '../../hooks/useSettings';
import { Collection, Video } from '../../types';
import AuthorsList from '../AuthorsList';
import Collections from '../Collections';
import TagsList from '../TagsList';
import SearchInput from './SearchInput';

interface MobileMenuProps {
    open: boolean;
    videoUrl: string;
    setVideoUrl: (url: string) => void;
    isSubmitting: boolean;
    error: string;
    isSearchMode: boolean;
    onResetSearch?: () => void;
    onSubmit: (e: React.FormEvent) => void;
    onAudioOnlySubmit?: (url: string) => Promise<any>;
    showAudioDownloadButton?: boolean;
    onClose: () => void;
    collections?: Collection[];
    showTags?: boolean;
    availableTags?: string[];
    selectedTags?: string[];
    onTagToggle?: (tag: string) => void;
    videos?: Video[];
    /** Home only: cap tags and link to /tags. Author/collection keep full local lists. */
    linkToAllTags?: boolean;
}

const MobileMenu: React.FC<MobileMenuProps> = ({
    open,
    videoUrl,
    setVideoUrl,
    isSubmitting,
    error,
    isSearchMode,
    onResetSearch,
    onSubmit,
    onAudioOnlySubmit,
    showAudioDownloadButton = true,
    onClose,
    collections = [],
    showTags = false,
    availableTags = [],
    selectedTags = [],
    onTagToggle = () => { },
    videos,
    linkToAllTags = false,
}) => {
    const { t } = useLanguage();
    const { logout } = useAuth();
    const navigate = useNavigate();
    const { data: settingsData } = useSettings();

    const loginEnabled = settingsData?.loginEnabled || false;

    const handleLogout = () => {
        onClose();
        logout();
        navigate('/');
    };

    return (
        <Collapse in={open} sx={{ width: '100%' }}>
            <Box sx={{ maxHeight: '80vh', overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
                <Stack spacing={2} sx={{ py: 2 }}>
                    {/* Row 1: Search Input */}
                    <Box>
                        <SearchInput
                            videoUrl={videoUrl}
                            setVideoUrl={setVideoUrl}
                            isSubmitting={isSubmitting}
                            error={error}
                            isSearchMode={isSearchMode}
                            onResetSearch={onResetSearch}
                            onSubmit={onSubmit}
                            onAudioSubmit={onAudioOnlySubmit}
                            showAudioDownloadButton={showAudioDownloadButton}
                        />
                    </Box>

                    {/* Mobile Navigation Buttons */}
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Button
                            component={Link}
                            to="/manage"
                            variant="outlined"
                            fullWidth
                            onClick={onClose}
                            startIcon={<VideoLibrary />}
                        >
                            {t('manageVideos')}
                        </Button>
                        <Button
                            component={Link}
                            to="/settings"
                            variant="outlined"
                            fullWidth
                            onClick={onClose}
                            startIcon={<Settings />}
                        >
                            {t('settings')}
                        </Button>
                    </Box>

                    {/* Logout Button */}
                    {loginEnabled && (
                        <>
                            <Divider />
                            <Button
                                variant="outlined"
                                color="error"
                                fullWidth
                                onClick={handleLogout}
                                startIcon={<Logout />}
                            >
                                {t('logout')}
                            </Button>
                        </>
                    )}

                    {/* Mobile navigation sections — Collections keeps direct
                        /collection/:id links for empty and first-video-collision
                        collections that the /collections card grid cannot show. */}
                    <Box sx={{ mt: 2 }}>
                        <Collections
                            collections={collections}
                            onItemClick={onClose}
                        />
                        <Box sx={{ mt: 2 }}>
                            <AuthorsList
                                videos={videos ?? []}
                                onItemClick={onClose}
                            />
                        </Box>
                        {showTags && (
                            <Box sx={{ mt: 2 }}>
                                <TagsList
                                    availableTags={availableTags}
                                    selectedTags={selectedTags}
                                    onTagToggle={onTagToggle}
                                    onItemClick={onClose}
                                    videos={videos}
                                    linkToAllTags={linkToAllTags}
                                />
                            </Box>
                        )}
                    </Box>
                </Stack>
            </Box>
        </Collapse>
    );
};

export default MobileMenu;
