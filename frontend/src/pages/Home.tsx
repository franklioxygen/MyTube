
import { Collections as CollectionsIcon, Delete as DeleteIcon, GridView, History, ViewSidebar } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Collapse,
    Container,
    Grid,
    IconButton,
    Pagination,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography
} from '@mui/material';
import axios from 'axios';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VirtuosoGrid } from 'react-virtuoso';
import AuthorsList from '../components/AuthorsList';
import CollectionCard from '../components/CollectionCard';
import Collections from '../components/Collections';
import ConfirmationModal from '../components/ConfirmationModal';
import SortControl from '../components/SortControl';
import TagsList from '../components/TagsList';
import VideoCard from '../components/VideoCard';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { useVideoSort } from '../hooks/useVideoSort';

const API_URL = import.meta.env.VITE_API_URL;

const Home: React.FC = () => {
    const { t } = useLanguage();
    const {
        videos,
        loading,
        error,
        availableTags,
        selectedTags,
        handleTagToggle,
        deleteVideo,
        deleteVideos
    } = useVideo();
    const { collections } = useCollection();


    const [searchParams, setSearchParams] = useSearchParams();
    const page = parseInt(searchParams.get('page') || '1', 10);
    const [itemsPerPage, setItemsPerPage] = useState(12);

    const [viewMode, setViewMode] = useState<'collections' | 'all-videos' | 'history'>(() => {
        const saved = localStorage.getItem('homeViewMode');
        return (saved as 'collections' | 'all-videos' | 'history') || 'all-videos';
    });


    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [infiniteScroll, setInfiniteScroll] = useState(false);
    const [videoColumns, setVideoColumns] = useState(4);
    const [isDeleteFilteredOpen, setIsDeleteFilteredOpen] = useState(false);

    // Determine Grid props based on sidebar and columns settings
    // Hoisted memoization to be used by both specialized and paginated views
    const gridProps = useMemo(() => {
        if (isSidebarOpen) {
            if (videoColumns === 2) return { xs: 12, sm: 6, lg: 6, xl: 6 };
            if (videoColumns === 3) return { xs: 12, sm: 6, lg: 4, xl: 4 };
            if (videoColumns === 4) return { xs: 12, sm: 6, lg: 4, xl: 3 };
            if (videoColumns === 5) return { xs: 12, sm: 6, md: 4, lg: 3, xl: 2 };
            return { xs: 12, sm: 6, md: 4, lg: 3, xl: 2 }; // 6 columns
        } else {
            if (videoColumns === 2) return { xs: 12, sm: 6, lg: 6, xl: 6 };
            if (videoColumns === 3) return { xs: 12, sm: 6, md: 4, lg: 4, xl: 4 };
            if (videoColumns === 4) return { xs: 12, sm: 6, md: 4, lg: 3, xl: 3 };
            if (videoColumns === 5) return { xs: 12, sm: 6, md: 4, lg: 2, xl: 2 };
            return { xs: 12, sm: 6, md: 4, lg: 2, xl: 2 }; // 6 columns
        }
    }, [isSidebarOpen, videoColumns]);

    // Components for VirtuosoGrid - MUST be defined before any conditional returns
    // Using useMemo to create stable component references
    // These components must work with virtualization - avoid forcing all items to render
    const VirtuosoList = useMemo(() =>
        React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Grid>>((props, ref) => {
            // Extract style and other props, but ensure we don't force all items to render
            const { style, ...restProps } = props;
            return (
                <Grid
                    container
                    rowSpacing={{ xs: 2, sm: 3 }}
                    columnSpacing={{ xs: 0, sm: 3 }}
                    {...restProps}
                    ref={ref}
                    style={{
                        ...style,
                        display: 'flex',
                        flexWrap: 'wrap',
                        // Critical: Don't set height or minHeight that would force all items to render
                        // Let VirtuosoGrid handle the height calculation
                    }}
                />
            );
        }),
        []
    );

    const VirtuosoItem = useMemo(() =>
        React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Grid>>((props, ref) => {
            const { style, ...restProps } = props;
            return (
                <Grid
                    size={gridProps}
                    {...restProps}
                    ref={ref}
                    style={{
                        ...style,
                        // Remove width override to let Grid handle sizing
                        // VirtuosoGrid will manage which items are rendered
                    }}
                />
            );
        }),
        [gridProps]
    );



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
                    if (typeof response.data.infiniteScroll !== 'undefined') {
                        setInfiniteScroll(response.data.infiniteScroll);
                    }
                    if (typeof response.data.videoColumns !== 'undefined') {
                        setVideoColumns(response.data.videoColumns);
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

    // Reset page when switching view modes or tags (paginated mode only)
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
                .filter(video => {
                    // Must have lastPlayedAt
                    if (!video.lastPlayedAt) return false;
                    
                    // Apply tag filtering if tags are selected
                    if (selectedTags.length > 0) {
                        const videoTags = video.tags || [];
                        return selectedTags.every(tag => videoTags.includes(tag));
                    }
                    
                    return true;
                })
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

    // Use the custom hook for sorting
    const {
        sortedVideos,
        sortOption,
        sortAnchorEl,
        handleSortClick,
        handleSortClose
    } = useVideoSort({
        videos: filteredVideos,
        onSortChange: () => {
            setSearchParams((prev: URLSearchParams) => {
                const newParams = new URLSearchParams(prev);
                newParams.set('page', '1');
                return newParams;
            });
        }
    });

    // Pagination logic
    const totalPages = Math.ceil(sortedVideos.length / itemsPerPage);

    // Get displayed videos based on mode (Only used for PAGINATION)
    const displayedVideos = useMemo(() => {
        if (infiniteScroll) {
            // When infinite scroll is on, we ignore this slice and pass strict 'sortedVideos' to Virtuoso
            // but we might want to return sortedVideos directly here if used elsewhere
            return sortedVideos;
        } else {
            // For pagination, return current page
            return sortedVideos.slice(
                (page - 1) * itemsPerPage,
                page * itemsPerPage
            );
        }
    }, [infiniteScroll, sortedVideos, page, itemsPerPage]);

    const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
        setSearchParams((prev: URLSearchParams) => {
            const newParams = new URLSearchParams(prev);
            newParams.set('page', value.toString());
            return newParams;
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Keyboard navigation for pagination (only when infinite scroll is disabled)
    useEffect(() => {
        if (infiniteScroll) {
            return; // Disable keyboard navigation when infinite scroll is enabled
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            // Don't handle keyboard navigation if user is typing in an input field
            const target = event.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            // Only handle if there are multiple pages
            if (totalPages <= 1) {
                return;
            }

            if (event.key === 'ArrowLeft' && page > 1) {
                event.preventDefault();
                setSearchParams((prev: URLSearchParams) => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set('page', (page - 1).toString());
                    return newParams;
                });
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (event.key === 'ArrowRight' && page < totalPages) {
                event.preventDefault();
                setSearchParams((prev: URLSearchParams) => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set('page', (page + 1).toString());
                    return newParams;
                });
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [page, totalPages, setSearchParams, infiniteScroll]);

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

    const handleViewModeChange = (mode: 'collections' | 'all-videos' | 'history') => {
        setViewMode(mode);
        localStorage.setItem('homeViewMode', mode);
        setSearchParams((prev: URLSearchParams) => {
            const newParams = new URLSearchParams(prev);
            newParams.set('page', '1');
            return newParams;
        });
    };




    // Regular home view (not in search mode)
    return (
        <Container maxWidth={false} sx={{ py: 4, px: { xs: 0, sm: 3 } }}>
            {/* Delete Filtered Videos Modal */}
            <ConfirmationModal
                isOpen={isDeleteFilteredOpen}
                onClose={() => setIsDeleteFilteredOpen(false)}
                onConfirm={async () => {
                    const videosToDelete = videoArray.filter(video => {
                        if (selectedTags.length === 0) return false;
                        const videoTags = video.tags || [];
                        return selectedTags.every(tag => videoTags.includes(tag));
                    });

                    if (videosToDelete.length > 0) {
                        await deleteVideos(videosToDelete.map(v => v.id));
                        // Optionally clear tags after delete, or keep them? Keeping them might show empty list.
                        // Let's keep them for now, user can clear if they want. 
                        // Actually, better to clear tags if all videos are gone? 
                        // No, simpler is better.
                    }
                }}
                title={t('deleteAllFilteredVideos')}
                message={t('confirmDeleteFilteredVideos', {
                    count: videoArray.filter(video => {
                        if (selectedTags.length === 0) return false;
                        const videoTags = video.tags || [];
                        return selectedTags.every(tag => videoTags.includes(tag));
                    }).length
                })}
                confirmText={t('delete')}
                cancelText={t('cancel')}
                isDanger={true}
            />

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
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, px: { xs: 2, sm: 0 } }}>
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
                                {selectedTags.length > 0 && (
                                    <Tooltip title={t('deleteAllFilteredVideos')}>
                                        <IconButton
                                            color="error"
                                            onClick={() => setIsDeleteFilteredOpen(true)}
                                            size="small"
                                            sx={{ ml: 1 }}
                                        >
                                            <DeleteIcon />
                                        </IconButton>
                                    </Tooltip>
                                )}
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

                                <SortControl
                                    sortOption={sortOption}
                                    sortAnchorEl={sortAnchorEl}
                                    onSortClick={handleSortClick}
                                    onSortClose={handleSortClose}
                                />
                            </Box>
                        </Box>
                        {viewMode === 'collections' && displayedVideos.length === 0 ? (
                            <Box sx={{ py: 8, textAlign: 'center' }}>
                                <Typography variant="h6" color="text.secondary">
                                    {t('noCollectionsFound')}
                                </Typography>
                            </Box>
                        ) : (
                            infiniteScroll ? (
                                <VirtuosoGrid
                                    key={`virtuoso-${viewMode}-${sortedVideos.length}`}
                                    useWindowScroll
                                    data={sortedVideos}
                                    components={{
                                        List: VirtuosoList,
                                        Item: VirtuosoItem
                                    }}
                                    overscan={5}
                                    itemContent={(_index, video) => {
                                        // In all-videos and history mode, ALWAYS render as VideoCard
                                        if (viewMode === 'all-videos' || viewMode === 'history') {
                                            return (
                                                <VideoCard
                                                    video={video}
                                                    collections={collections}
                                                    disableCollectionGrouping={true}
                                                    onDeleteVideo={deleteVideo}
                                                    showDeleteButton={true}
                                                />
                                            );
                                        }

                                        // In collections mode, check if this video is the first in a collection
                                        // Since sorting logic filters this, we should generally be good, 
                                        // but we still want to render CollectionCard where appropriate.
                                        // The `sortedVideos` for collections mode ONLY contains the "representatives".
                                        // So we just need to find the collection it represents.

                                        // Find the collection this video represents (it must be the first video)
                                        const collection = collections.find(c => c.videos[0] === video.id);

                                        if (collection) {
                                            return (
                                                <CollectionCard
                                                    collection={collection}
                                                    videos={videoArray}
                                                />
                                            );
                                        }

                                        // Fallback (shouldn't happen often in collections view unless logic allows loose videos)
                                        return (
                                            <VideoCard
                                                video={video}
                                                collections={collections}
                                                onDeleteVideo={deleteVideo}
                                                showDeleteButton={true}
                                            />
                                        );
                                    }}
                                />
                            ) : (
                                <Grid
                                    container
                                    rowSpacing={{ xs: 2, sm: 3 }}
                                    columnSpacing={{ xs: 0, sm: 3 }}
                                >
                                    {displayedVideos.map((video) => {
                                        // In all-videos and history mode, ALWAYS render as VideoCard
                                        if (viewMode === 'all-videos' || viewMode === 'history') {
                                            return (
                                                <Grid size={gridProps} key={video.id}>
                                                    <VideoCard
                                                        video={video}
                                                        collections={collections}
                                                        disableCollectionGrouping={true}
                                                        onDeleteVideo={deleteVideo}
                                                        showDeleteButton={true}
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
                                                    onDeleteVideo={deleteVideo}
                                                    showDeleteButton={true}
                                                />
                                            </Grid>
                                        );
                                    })}
                                </Grid>
                            )
                        )}


                        {!infiniteScroll && totalPages > 1 && (
                            <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center', px: { xs: 2, sm: 0 } }}>
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
