
import { Collections as CollectionsIcon, GridView, ViewSidebar } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Collapse,
    Container,
    Grid,
    Pagination,
    ToggleButton,
    ToggleButtonGroup,
    Typography
} from '@mui/material';
import axios from 'axios';
import { useEffect, useState } from 'react';
import AuthorsList from '../components/AuthorsList';
import CollectionCard from '../components/CollectionCard';
import Collections from '../components/Collections';
import TagsList from '../components/TagsList';
import VideoCard from '../components/VideoCard';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';

const API_URL = import.meta.env.VITE_API_URL;

const Home: React.FC = () => {
    const { t } = useLanguage();
    const {
        videos,
        loading,
        error,
        availableTags,
        selectedTags,
        handleTagToggle
    } = useVideo();
    const { collections } = useCollection();


    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 12;
    const [viewMode, setViewMode] = useState<'collections' | 'all-videos'>(() => {
        const saved = localStorage.getItem('homeViewMode');
        return (saved as 'collections' | 'all-videos') || 'collections';
    });
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [settingsLoaded, setSettingsLoaded] = useState(false);

    // Fetch settings on mount
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await axios.get(`${API_URL}/settings`);
                if (response.data && typeof response.data.homeSidebarOpen !== 'undefined') {
                    setIsSidebarOpen(response.data.homeSidebarOpen);
                }
            } catch (error) {
                console.error('Failed to fetch settings:', error);
            } finally {
                setSettingsLoaded(true);
            }
        };
        fetchSettings();
    }, []);

    const handleSidebarToggle = async () => {
        const newState = !isSidebarOpen;
        setIsSidebarOpen(newState);
        try {
            // We need to fetch current settings first to not overwrite other settings
            // Or better, the backend should support partial updates, but the current controller 
            // implementation replaces the whole object or merges with defaults.
            // Let's fetch first to be safe, similar to how SettingsPage does it, 
            // but for a simple toggle, we might want a lighter endpoint. 
            // However, given the current backend structure, we'll fetch then save.
            // Actually, the backend `updateSettings` merges with `defaultSettings` but expects the full object 
            // in `req.body` to be the new state. 
            // Wait, looking at `settingsController.ts`: `const newSettings: Settings = req.body;`
            // and `storageService.saveSettings(newSettings);`
            // It seems it REPLACES the settings with what's sent. 
            // So we MUST fetch existing settings first.

            const response = await axios.get(`${API_URL}/settings`);
            const currentSettings = response.data;
            await axios.post(`${API_URL}/settings`, {
                ...currentSettings,
                homeSidebarOpen: newState
            });
        } catch (error) {
            console.error('Failed to save sidebar state:', error);
        }
    };

    // Reset page when filters change
    useEffect(() => {
        setPage(1);
    }, [videos, collections, selectedTags]);



    // Add default empty array to ensure videos is always an array
    const videoArray = Array.isArray(videos) ? videos : [];

    if (!settingsLoaded || (loading && videoArray.length === 0)) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
                <Typography sx={{ ml: 2 }}>{t('loadingVideos')}</Typography>
            </Box>
        );
    }

    if (error && videoArray.length === 0) {
        return (
            <Container sx={{ mt: 4 }}>
                <Alert severity="error">{error}</Alert>
            </Container>
        );
    }

    // Filter videos based on view mode
    const filteredVideos = viewMode === 'all-videos'
        ? videoArray.filter(video => {
            // In all-videos mode, only apply tag filtering
            if (selectedTags.length > 0) {
                const videoTags = video.tags || [];
                return selectedTags.every(tag => videoTags.includes(tag));
            }
            return true;
        })
        : videoArray.filter(video => {
            // In collections mode, show only first video from each collection
            // Tag filtering
            if (selectedTags.length > 0) {
                const videoTags = video.tags || [];
                const hasMatchingTag = selectedTags.every(tag => videoTags.includes(tag));
                if (!hasMatchingTag) return false;
            }

            // If the video is not in any collection, show it
            const videoCollections = collections.filter(collection =>
                collection.videos.includes(video.id)
            );

            if (videoCollections.length === 0) {
                return true;
            }

            // For each collection this video is in, check if it's the first video
            return videoCollections.some(collection => {
                // Get the first video ID in this collection
                const firstVideoId = collection.videos[0];
                // Show this video if it's the first in at least one collection
                return video.id === firstVideoId;
            });
        });

    const handleViewModeChange = (mode: 'collections' | 'all-videos') => {
        setViewMode(mode);
        localStorage.setItem('homeViewMode', mode);
        setPage(1); // Reset pagination
    };

    // Pagination logic
    const totalPages = Math.ceil(filteredVideos.length / ITEMS_PER_PAGE);
    const displayedVideos = filteredVideos.slice(
        (page - 1) * ITEMS_PER_PAGE,
        page * ITEMS_PER_PAGE
    );

    const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
        setPage(value);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Regular home view (not in search mode)
    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            {videoArray.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 8 }}>
                    <Typography variant="h5" color="text.secondary">
                        {t('noVideosYet')}
                    </Typography>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
                    {/* Sidebar container for Collections, Authors, and Tags */}
                    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                        <Collapse in={isSidebarOpen} orientation="horizontal" timeout={300} sx={{ height: '100%', '& .MuiCollapse-wrapper': { height: '100%' }, '& .MuiCollapse-wrapperInner': { height: '100%' } }}>
                            <Box sx={{ width: 280, mr: 4, flexShrink: 0, height: '100%', position: 'relative' }}>
                                <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                                    <Box sx={{
                                        position: 'sticky',
                                        maxHeight: 'calc(100% - 80px)',
                                        minHeight: 'calc(100vh - 80px)',
                                        overflowY: 'auto',
                                        '&::-webkit-scrollbar': {
                                            width: '6px',
                                        },
                                        '&::-webkit-scrollbar-track': {
                                            background: 'transparent',
                                        },
                                        '&::-webkit-scrollbar-thumb': {
                                            background: 'rgba(0,0,0,0.1)',
                                            borderRadius: '3px',
                                        },
                                        '&:hover::-webkit-scrollbar-thumb': {
                                            background: 'rgba(0,0,0,0.2)',
                                        },
                                    }}>
                                        <Collections collections={collections} />
                                        <Box sx={{ mt: 2 }}>
                                            <TagsList
                                                availableTags={availableTags}
                                                selectedTags={selectedTags}
                                                onTagToggle={handleTagToggle}
                                            />
                                        </Box>
                                        <Box sx={{ mt: 2 }}>
                                            <AuthorsList videos={videoArray} />
                                        </Box>
                                    </Box>
                                </Box>
                            </Box>
                        </Collapse>
                    </Box>

                    {/* Videos grid */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        {/* View mode toggle */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                            <Typography variant="h5" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Button
                                    onClick={handleSidebarToggle}
                                    variant="outlined"
                                    sx={{
                                        minWidth: 'auto',
                                        p: 1,
                                        display: { xs: 'none', md: 'inline-flex' },
                                        color: 'text.primary',
                                        borderColor: 'text.primary',
                                    }}
                                >
                                    <ViewSidebar sx={{ transform: 'rotate(180deg)' }} />
                                </Button>
                                {t('videos')}
                            </Typography>
                            <ToggleButtonGroup
                                value={viewMode}
                                exclusive
                                onChange={(_, newMode) => newMode && handleViewModeChange(newMode)}
                                size="small"
                            >
                                <ToggleButton value="collections">
                                    <CollectionsIcon fontSize="small" sx={{ mr: 1 }} />
                                    {t('collections')}
                                </ToggleButton>
                                <ToggleButton value="all-videos">
                                    <GridView fontSize="small" sx={{ mr: 1 }} />
                                    {t('allVideos')}
                                </ToggleButton>
                            </ToggleButtonGroup>
                        </Box>
                        <Grid container spacing={3}>
                            {displayedVideos.map(video => {
                                const gridProps = isSidebarOpen
                                    ? { xs: 12, sm: 6, lg: 4, xl: 3 }
                                    : { xs: 12, sm: 6, md: 4, lg: 3, xl: 2 };

                                // In all-videos mode, ALWAYS render as VideoCard
                                if (viewMode === 'all-videos') {
                                    return (
                                        <Grid size={gridProps} key={video.id}>
                                            <VideoCard
                                                video={video}
                                                collections={collections}
                                                disableCollectionGrouping={true}
                                            />
                                        </Grid>
                                    );
                                }

                                // In collections mode, check if this video is the first in a collection
                                const collection = collections.find(c => c.videos[0] === video.id);

                                // If it is, render CollectionCard
                                if (collection) {
                                    return (
                                        <Grid size={gridProps} key={`collection-${collection.id}`}>
                                            <CollectionCard
                                                collection={collection}
                                                videos={videoArray}
                                            />
                                        </Grid>
                                    );
                                }

                                // Otherwise render VideoCard for non-collection videos
                                return (
                                    <Grid size={gridProps} key={video.id}>
                                        <VideoCard
                                            video={video}
                                            collections={collections}
                                        />
                                    </Grid>
                                );
                            })}
                        </Grid>



                        {totalPages > 1 && (
                            <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}>
                                <Pagination
                                    count={totalPages}
                                    page={page}
                                    onChange={handlePageChange}
                                    color="primary"
                                    size="large"
                                    showFirstButton
                                    showLastButton
                                />
                            </Box>
                        )}
                    </Box>
                </Box >
            )}
        </Container >
    );
};

export default Home;
