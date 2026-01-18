import { Alert, Box, CircularProgress, Container, Pagination, Typography, useMediaQuery, useTheme } from '@mui/material';
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ConfirmationModal from '../components/ConfirmationModal';
import { HomeHeader } from '../components/HomeHeader';
import { HomeSidebar } from '../components/HomeSidebar';
import { LCPImagePreloader } from '../components/LCPImagePreloader';
import { VideoGrid } from '../components/VideoGrid';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { useGridLayout } from '../hooks/useGridLayout';
import { useHomePagination } from '../hooks/useHomePagination';
import { useHomeSettings } from '../hooks/useHomeSettings';
import { useVideoFiltering } from '../hooks/useVideoFiltering';
import { useVideoSort } from '../hooks/useVideoSort';
import { useViewMode } from '../hooks/useViewMode';

const Home: React.FC = () => {
    const { t } = useLanguage();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
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
    const [_searchParams, setSearchParams] = useSearchParams();
    const [isDeleteFilteredOpen, setIsDeleteFilteredOpen] = useState(false);

    // Custom hooks
    const { viewMode, handleViewModeChange } = useViewMode();
    const {
        isSidebarOpen,
        itemsPerPage,
        infiniteScroll,
        videoColumns,
        defaultSort,
        showTagsOnThumbnail,
        settingsLoaded,
        handleSidebarToggle
    } = useHomeSettings();
    const gridProps = useGridLayout({ isSidebarOpen, videoColumns });

    // Add default empty array to ensure videos is always an array
    const videoArray = Array.isArray(videos) ? videos : [];

    // Filter videos based on view mode
    const filteredVideos = useVideoFiltering({
        videos: videoArray,
        viewMode,
        selectedTags,
        collections
    });

    // Use the custom hook for sorting
    const {
        sortedVideos,
        sortOption,
        sortAnchorEl,
        handleSortClick,
        handleSortClose
    } = useVideoSort({
        videos: filteredVideos,
        defaultSort,
        onSortChange: () => {
            setSearchParams((prev: URLSearchParams) => {
                const newParams = new URLSearchParams(prev);
                newParams.set('page', '1');
                return newParams;
            });
        }
    });

    // Pagination logic
    const {
        page,
        totalPages,
        displayedVideos,
        handlePageChange
    } = useHomePagination({
        sortedVideos,
        itemsPerPage,
        infiniteScroll,
        selectedTags
    });

    if (!settingsLoaded || (loading && videoArray.length === 0)) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
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




    // Regular home view (not in search mode)
    return (
        <Container maxWidth={false} sx={{ py: 4, px: { xs: 0, sm: 3 } }}>
            {/* Preload first video thumbnail for better LCP */}
            {videoArray.length > 0 && <LCPImagePreloader videos={videoArray} />}

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
                    <HomeSidebar
                        isSidebarOpen={isSidebarOpen}
                        collections={collections}
                        availableTags={availableTags}
                        selectedTags={selectedTags}
                        onTagToggle={handleTagToggle}
                        videos={videoArray}
                    />

                    {/* Videos grid */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <HomeHeader
                            viewMode={viewMode}
                            onViewModeChange={handleViewModeChange}
                            onSidebarToggle={handleSidebarToggle}
                            selectedTagsCount={selectedTags.length}
                            onDeleteFilteredClick={() => setIsDeleteFilteredOpen(true)}
                            sortOption={sortOption}
                            sortAnchorEl={sortAnchorEl}
                            onSortClick={handleSortClick}
                            onSortClose={handleSortClose}
                        />
                        {viewMode === 'collections' && displayedVideos.length === 0 ? (
                            <Box sx={{ py: 8, textAlign: 'center' }}>
                                <Typography variant="h6" color="text.secondary">
                                    {t('noCollectionsFound')}
                                </Typography>
                            </Box>
                        ) : (
                            <VideoGrid
                                videos={videoArray}
                                sortedVideos={sortedVideos}
                                displayedVideos={displayedVideos}
                                collections={collections}
                                viewMode={viewMode}
                                infiniteScroll={infiniteScroll}
                                gridProps={gridProps}
                                onDeleteVideo={deleteVideo}
                                showTagsOnThumbnail={showTagsOnThumbnail}
                            />
                        )}

                        {!infiniteScroll && totalPages > 1 && (
                            <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center', px: { xs: 2, sm: 0 } }}>
                                <Pagination
                                    count={totalPages}
                                    page={page}
                                    onChange={handlePageChange}
                                    color="primary"
                                    size={isMobile ? 'medium' : 'large'}
                                    siblingCount={isMobile ? 0 : 1}
                                    showFirstButton
                                    showLastButton
                                />
                            </Box>
                        )}
                    </Box>
                </Box>
            )
            }
        </Container >
    );
};

export default Home;
