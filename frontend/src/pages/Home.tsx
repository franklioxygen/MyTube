
import { AccessTime, Collections as CollectionsIcon, GridView, History, Shuffle, Sort, SortByAlpha, ViewSidebar, Visibility } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Collapse,
    Container,
    Grid,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Pagination,
    ToggleButton,
    ToggleButtonGroup,
    Typography
} from '@mui/material';
import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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


    const [searchParams, setSearchParams] = useSearchParams();
    const page = parseInt(searchParams.get('page') || '1', 10);
    const [itemsPerPage, setItemsPerPage] = useState(12);

    const [viewMode, setViewMode] = useState<'collections' | 'all-videos' | 'history'>(() => {
        const saved = localStorage.getItem('homeViewMode');
        return (saved as 'collections' | 'all-videos' | 'history') || 'collections';
    });
    const [sortOption, setSortOption] = useState<string>('dateDesc');
    const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null);
    const [shuffleSeed, setShuffleSeed] = useState<number>(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [settingsLoaded, setSettingsLoaded] = useState(false);

    // Fetch settings on mount
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await axios.get(`${API_URL}/settings`);
                if (response.data) {
                    if (typeof response.data.homeSidebarOpen !== 'undefined') {
                        setIsSidebarOpen(response.data.homeSidebarOpen);
                    }
                    if (typeof response.data.itemsPerPage !== 'undefined') {
                        setItemsPerPage(response.data.itemsPerPage);
                    }
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
        // Only reset to page 1 if we are not already on page 1
        // This effect might run on mount too, so we need to be careful not to overwrite the URL param if it was just set
        // However, if videos/collections changes, we generally DO want to reset to page 1 as the data changed.
        // But if we just navigated back, videos might be re-fetched.
        // If the data is stable, we shouldn't reset.
        // Actually, preventing reset on initial load is hard if we depend on `videos`.
        // Let's rely on the user manual action for now, OR better:
        // When videos change, if the current page is out of bounds, reset it.
        // Or if the user changes tags, definitely reset.
        // But for just 'videos' update (like background refresh), maybe we shouldn't reset unless necessary.

        // For now, let's ONLY reset if tags change.
    }, [selectedTags]);

    // Reset page when switching view modes or tags
    // We use a ref to track previous tags so we don't reset on mount (when navigating back)
    const prevTagsRef = useRef(selectedTags);
    useEffect(() => {
        if (prevTagsRef.current !== selectedTags) {
            prevTagsRef.current = selectedTags;
            setSearchParams((prev: URLSearchParams) => {
                const newParams = new URLSearchParams(prev);
                newParams.set('page', '1');
                return newParams;
            });
        }
    }, [selectedTags, setSearchParams]);


    // Add default empty array to ensure videos is always an array
    const videoArray = Array.isArray(videos) ? videos : [];


    // Filter videos based on view mode
    const filteredVideos = useMemo(() => {
        if (viewMode === 'all-videos') {
            return videoArray.filter(video => {
                // In all-videos mode, only apply tag filtering
                if (selectedTags.length > 0) {
                    const videoTags = video.tags || [];
                    return selectedTags.every(tag => videoTags.includes(tag));
                }
                return true;
            });
        }

        if (viewMode === 'history') {
            return videoArray
                .filter(video => video.lastPlayedAt)
                .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
        }

        // Collections mode
        return videoArray.filter(video => {
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
                return false;
            }

            // For each collection this video is in, check if it's the first video
            return videoCollections.some(collection => {
                // Get the first video ID in this collection
                const firstVideoId = collection.videos[0];
                // Show this video if it's the first in at least one collection
                return video.id === firstVideoId;
            });
        });
    }, [viewMode, videoArray, selectedTags, collections]);

    const sortedVideos = useMemo(() => {
        const result = [...filteredVideos];
        switch (sortOption) {
            case 'dateDesc':
                return result.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
            case 'dateAsc':
                return result.sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime());
            case 'viewsDesc':
                return result.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
            case 'viewsAsc':
                return result.sort((a, b) => (a.viewCount || 0) - (b.viewCount || 0));
            case 'nameAsc':
                return result.sort((a, b) => a.title.localeCompare(b.title));
            case 'random':
                return result.sort(() => 0.5 - Math.random());
            default:
                return result;
        }
    }, [filteredVideos, sortOption, shuffleSeed]);

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


    const handleViewModeChange = (mode: 'collections' | 'all-videos' | 'history') => {
        setViewMode(mode);
        localStorage.setItem('homeViewMode', mode);
        setSearchParams((prev: URLSearchParams) => {
            const newParams = new URLSearchParams(prev);
            newParams.set('page', '1');
            return newParams;
        });
    };

    const handleSortClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setSortAnchorEl(event.currentTarget);
    };

    const handleSortClose = (option?: string) => {
        if (option) {
            if (option === 'random') {
                setShuffleSeed(prev => prev + 1);
            }

            if (option !== sortOption) {
                setSortOption(option);
                setSearchParams((prev: URLSearchParams) => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set('page', '1');
                    return newParams;
                });
            } else if (option === 'random') {
                // Even if it matches, if it is random, we want to reset page to 1 because the order changed
                setSearchParams((prev: URLSearchParams) => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set('page', '1');
                    return newParams;
                });
            }
        }
        setSortAnchorEl(null);
    };

    // Pagination logic
    const totalPages = Math.ceil(sortedVideos.length / itemsPerPage);
    const displayedVideos = sortedVideos.slice(
        (page - 1) * itemsPerPage,
        page * itemsPerPage
    );

    const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
        setSearchParams((prev: URLSearchParams) => {
            const newParams = new URLSearchParams(prev);
            newParams.set('page', value.toString());
            return newParams;
        });
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
                                        color: 'text.secondary',
                                        borderColor: 'text.secondary',
                                    }}
                                >
                                    <ViewSidebar sx={{ transform: 'rotate(180deg)' }} />
                                </Button>
                                <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                                    {t('videos')}
                                </Box>
                                <Box component="span" sx={{ display: { xs: 'block', md: 'none' } }}>
                                    {{
                                        'collections': t('collections'),
                                        'all-videos': t('allVideos'),
                                        'history': t('history')
                                    }[viewMode]}
                                </Box>
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 2 }}>
                                <ToggleButtonGroup
                                    value={viewMode}
                                    exclusive
                                    onChange={(_, newMode) => newMode && handleViewModeChange(newMode)}
                                    size="small"
                                >
                                    <ToggleButton value="all-videos" sx={{ px: { xs: 2, md: 2 } }}>
                                        <GridView fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                                            {t('allVideos')}
                                        </Box>
                                    </ToggleButton>
                                    <ToggleButton value="collections" sx={{ px: { xs: 2, md: 2 } }}>
                                        <CollectionsIcon fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                                            {t('collections')}
                                        </Box>
                                    </ToggleButton>
                                    <ToggleButton value="history" sx={{ px: { xs: 2, md: 2 } }}>
                                        <History fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                                            {t('history')}
                                        </Box>
                                    </ToggleButton>
                                </ToggleButtonGroup>

                                <Button
                                    variant="outlined"
                                    onClick={handleSortClick}
                                    size="small"
                                    sx={{
                                        minWidth: 'auto',
                                        px: 1,
                                        color: 'text.secondary',
                                        borderColor: 'text.secondary'
                                    }}
                                >
                                    <Sort />
                                </Button>
                                <Menu
                                    anchorEl={sortAnchorEl}
                                    open={Boolean(sortAnchorEl)}
                                    onClose={() => handleSortClose()}
                                >
                                    <MenuItem onClick={() => handleSortClose('dateDesc')} selected={sortOption === 'dateDesc'}>
                                        <ListItemIcon>
                                            <AccessTime fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText>{t('dateDesc')}</ListItemText>
                                    </MenuItem>
                                    <MenuItem onClick={() => handleSortClose('dateAsc')} selected={sortOption === 'dateAsc'}>
                                        <ListItemIcon>
                                            <AccessTime fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText>{t('dateAsc')}</ListItemText>
                                    </MenuItem>
                                    <MenuItem onClick={() => handleSortClose('viewsDesc')} selected={sortOption === 'viewsDesc'}>
                                        <ListItemIcon>
                                            <Visibility fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText>{t('viewsDesc')}</ListItemText>
                                    </MenuItem>
                                    <MenuItem onClick={() => handleSortClose('viewsAsc')} selected={sortOption === 'viewsAsc'}>
                                        <ListItemIcon>
                                            <Visibility fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText>{t('viewsAsc')}</ListItemText>
                                    </MenuItem>
                                    <MenuItem onClick={() => handleSortClose('nameAsc')} selected={sortOption === 'nameAsc'}>
                                        <ListItemIcon>
                                            <SortByAlpha fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText>{t('nameAsc')}</ListItemText>
                                    </MenuItem>
                                    <MenuItem onClick={() => handleSortClose('random')} selected={sortOption === 'random'}>
                                        <ListItemIcon>
                                            <Shuffle fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText>{t('random')}</ListItemText>
                                    </MenuItem>
                                </Menu>
                            </Box>
                        </Box>
                        {viewMode === 'collections' && displayedVideos.length === 0 ? (
                            <Box sx={{ py: 8, textAlign: 'center' }}>
                                <Typography variant="h6" color="text.secondary">
                                    {t('noCollectionsFound')}
                                </Typography>
                            </Box>
                        ) : (
                            <Grid container spacing={3}>
                                {displayedVideos.map(video => {
                                    const gridProps = isSidebarOpen
                                        ? { xs: 12, sm: 6, lg: 4, xl: 3 }
                                        : { xs: 12, sm: 6, md: 4, lg: 3, xl: 2 };

                                    // In all-videos and history mode, ALWAYS render as VideoCard
                                    if (viewMode === 'all-videos' || viewMode === 'history') {
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
                        )}



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
            )
            }
        </Container >
    );
};

export default Home;
