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
    searchTerm: string;
    onResetSearch?: () => void;
    onSubmit: (e: React.FormEvent) => void;
    onClose: () => void;
    collections?: Collection[];
    videos?: Video[];
    showTags?: boolean;
    availableTags?: string[];
    selectedTags?: string[];
    onTagToggle?: (tag: string) => void;
}

const MobileMenu: React.FC<MobileMenuProps> = ({
    open,
    videoUrl,
    setVideoUrl,
    isSubmitting,
    error,
    isSearchMode,
    searchTerm,
    onResetSearch,
    onSubmit,
    onClose,
    collections = [],
    videos = [],
    showTags = false,
    availableTags = [],
    selectedTags = [],
    onTagToggle = () => { }
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
            <Box sx={{ maxHeight: '80vh', overflowY: 'auto' }}>
                <Stack spacing={2} sx={{ py: 2 }}>
                    {/* Row 1: Search Input */}
                    <Box>
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

                    {/* Mobile Navigation Items - Tags only on home/author/collection */}
                    <Box sx={{ mt: 2 }}>
                        <Collections
                            collections={collections}
                            onItemClick={onClose}
                        />
                        {showTags && (
                            <Box sx={{ mt: 2 }}>
                                <TagsList
                                    availableTags={availableTags}
                                    selectedTags={selectedTags}
                                    onTagToggle={onTagToggle}
                                />
                            </Box>
                        )}
                        <Box sx={{ mt: 2 }}>
                            <AuthorsList
                                videos={videos}
                                onItemClick={onClose}
                            />
                        </Box>
                    </Box>
                </Stack>
            </Box>
        </Collapse>
    );
};

export default MobileMenu;
