import { Delete as DeleteIcon } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Container,
    IconButton,
    Pagination,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import React, { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ExpandableTagsStrip from '../components/ExpandableTagsStrip';
import SortControl from '../components/SortControl';
import { VideoGrid } from '../components/VideoGrid';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { useGridLayout } from '../hooks/useGridLayout';
import { useHomePagination } from '../hooks/useHomePagination';
import { useHomeSettings } from '../hooks/useHomeSettings';
import { useSettings } from '../hooks/useSettings';
import { useVideoFiltering } from '../hooks/useVideoFiltering';
import { useVideoSort } from '../hooks/useVideoSort';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { sortTagsByUsage } from '../utils/tagUtils';

const ALL_TAGS_SORT_STORAGE_SLOT = 'allTagsSortOption';

const ConfirmationModal = lazyWithRetry(
    () => import('../components/ConfirmationModal'),
    'confirmation-modal',
);

const AllTagsPage: React.FC = () => {
    const { t } = useLanguage();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const {
        videos,
        loading,
        availableTags,
        selectedTags,
        handleTagToggle,
        clearSelectedTags,
        deleteVideo,
        deleteVideos,
    } = useVideo();
    const { collections } = useCollection();
    const { data: settings, isLoading: settingsLoading } = useSettings();
    const [, setSearchParams] = useSearchParams();
    const [isDeleteFilteredOpen, setIsDeleteFilteredOpen] = useState(false);

    const {
        itemsPerPage,
        infiniteScroll,
        videoColumns,
        defaultSort,
        showTagsOnThumbnail,
        settingsLoaded,
    } = useHomeSettings({ settings, settingsLoading });

    const gridProps = useGridLayout({ isSidebarOpen: false, videoColumns });
    const videoArray = useMemo(() => (Array.isArray(videos) ? videos : []), [videos]);

    const tagMembershipKey = useMemo(
        () => videoArray.map((v) => `${v.id}:${(v.tags ?? []).join(',')}`).join('|'),
        [videoArray]
    );

    const orderedTags = useMemo(
        () => sortTagsByUsage(availableTags, videoArray),
        // tagMembershipKey avoids reordering on unrelated video field changes
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional tag-only signal
        [availableTags, tagMembershipKey]
    );

    const filteredVideos = useVideoFiltering({
        videos: videoArray,
        viewMode: 'all-videos',
        selectedTags,
        collections,
        authorTags: settings?.authorTags,
        collectionTags: settings?.collectionTags,
    });

    const {
        sortedVideos,
        sortOption,
        sortAnchorEl,
        handleSortClick,
        handleSortClose,
    } = useVideoSort({
        videos: filteredVideos,
        defaultSort,
        storageKey: ALL_TAGS_SORT_STORAGE_SLOT,
        onSortChange: () => {
            setSearchParams((prev: URLSearchParams) => {
                const newParams = new URLSearchParams(prev);
                newParams.set('page', '1');
                return newParams;
            });
        },
    });

    const { page, totalPages, displayedVideos, handlePageChange } = useHomePagination({
        sortedVideos,
        itemsPerPage,
        infiniteScroll,
        selectedTags,
    });

    if (!settingsLoaded || (loading && videoArray.length === 0)) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth={false} sx={{ py: 4, px: { xs: 2, sm: 3 } }}>
            {isDeleteFilteredOpen && (
                <Suspense fallback={null}>
                    <ConfirmationModal
                        isOpen={isDeleteFilteredOpen}
                        onClose={() => setIsDeleteFilteredOpen(false)}
                        onConfirm={async () => {
                            if (filteredVideos.length > 0) {
                                await deleteVideos(filteredVideos.map((v) => v.id));
                            }
                        }}
                        title={t('deleteAllFilteredVideos')}
                        message={t('confirmDeleteFilteredVideos', {
                            count: filteredVideos.length,
                        })}
                        confirmText={t('delete')}
                        cancelText={t('cancel')}
                        isDanger={true}
                    />
                </Suspense>
            )}

            <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
                {t('allTags')}
            </Typography>

            {orderedTags.length === 0 ? (
                <Alert severity="info" sx={{ mb: 3 }}>
                    {t('noTagsAvailable')}
                </Alert>
            ) : (
                <ExpandableTagsStrip
                    tags={orderedTags}
                    selectedTags={selectedTags}
                    onTagToggle={handleTagToggle}
                    maxCollapsedLines={3}
                />
            )}

            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 2,
                    mb: 3,
                    flexWrap: 'wrap',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    {selectedTags.length > 0 && (
                        <>
                            <Button
                                size="small"
                                onClick={clearSelectedTags}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                {t('filteredByTags', { count: selectedTags.length })} — {t('clear')}
                            </Button>
                            <Tooltip title={t('deleteAllFilteredVideos')}>
                                <IconButton
                                    color="error"
                                    onClick={() => setIsDeleteFilteredOpen(true)}
                                    size="small"
                                >
                                    <DeleteIcon />
                                </IconButton>
                            </Tooltip>
                        </>
                    )}
                </Box>
                <SortControl
                    sortOption={sortOption}
                    sortAnchorEl={sortAnchorEl}
                    onSortClick={handleSortClick}
                    onSortClose={handleSortClose}
                />
            </Box>

            {videoArray.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                    {t('noVideosYet')}
                </Typography>
            ) : filteredVideos.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                    {t('noVideos')}
                </Typography>
            ) : (
                <>
                    <VideoGrid
                        videos={videoArray}
                        sortedVideos={sortedVideos}
                        displayedVideos={displayedVideos}
                        collections={collections}
                        viewMode="all-videos"
                        infiniteScroll={infiniteScroll}
                        gridProps={gridProps}
                        onDeleteVideo={deleteVideo}
                        showTagsOnThumbnail={showTagsOnThumbnail}
                        onTagToggle={handleTagToggle}
                    />
                    {!infiniteScroll && totalPages > 1 && (
                        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}>
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
                </>
            )}
        </Container>
    );
};

export default AllTagsPage;
