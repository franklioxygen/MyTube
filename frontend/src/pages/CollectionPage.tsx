import { Folder, ViewSidebar } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Button,
    Container,
    Grid,
    Pagination,
    Typography
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DeleteCollectionModal from '../components/DeleteCollectionModal';
import SortControl from '../components/SortControl';
import { TagsSidebar } from '../components/TagsSidebar';
import VideoCard from '../components/VideoCard';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageTagFilter } from '../contexts/PageTagFilterContext';
import { useVideo } from '../contexts/VideoContext';
import { useVideoSort } from '../hooks/useVideoSort';

const CollectionPage: React.FC = () => {
    const { t } = useLanguage();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { collections, deleteCollection } = useCollection();
    const { videos, deleteVideo } = useVideo();
    const { setPageTagFilter } = usePageTagFilter();

    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [page, setPage] = useState(1);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const ITEMS_PER_PAGE = 12;

    const collection = collections.find(c => c.id === id);
    const collectionVideos = collection
        ? videos.filter(video => collection.videos.includes(video.id))
        : [];
    const availableTags = useMemo(
        () => Array.from(new Set(collectionVideos.flatMap(v => v.tags || []))).sort(),
        [collectionVideos]
    );

    const [filterVersion, setFilterVersion] = useState(0);

    const handleTagToggle = useCallback((tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
        );
        setPage(1);
        setFilterVersion(v => v + 1);
    }, []);

    const videosFilteredByTags = useMemo(() => {
        if (selectedTags.length === 0) return collectionVideos;
        return collectionVideos.filter(video =>
            selectedTags.every(tag => (video.tags || []).includes(tag))
        );
    }, [collectionVideos, selectedTags]);

    // Keep a ref so the context always reads current values (menu gets latest when it opens)
    const filterRef = useRef({ availableTags, selectedTags, onTagToggle: handleTagToggle });
    filterRef.current = { availableTags, selectedTags, onTagToggle: handleTagToggle };

    // Register page tag filter; bump filterVersion only in handleTagToggle so Header re-renders on tag click (no effect loop)
    useEffect(() => {
        const stableFilter = {
            get availableTags() {
                return filterRef.current.availableTags;
            },
            get selectedTags() {
                return filterRef.current.selectedTags;
            },
            onTagToggle: (tag: string) => filterRef.current.onTagToggle(tag),
            _version: filterVersion
        };
        setPageTagFilter(stableFilter);
        return () => setPageTagFilter(null);
    }, [filterVersion, setPageTagFilter]);

    // Sort videos (after tag filter)
    const {
        sortedVideos,
        sortOption,
        sortAnchorEl,
        handleSortClick,
        handleSortClose
    } = useVideoSort({
        videos: videosFilteredByTags,
        defaultSort: 'dateDesc',
        onSortChange: () => setPage(1)
    });

    // Pagination logic
    const totalPages = Math.ceil(sortedVideos.length / ITEMS_PER_PAGE);
    const displayedVideos = sortedVideos.slice(
        (page - 1) * ITEMS_PER_PAGE,
        page * ITEMS_PER_PAGE
    );

    const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
        setPage(value);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCloseDeleteModal = () => {
        setShowDeleteModal(false);
    };

    const handleDeleteCollectionOnly = async () => {
        if (!id) return;
        const result = await deleteCollection(id, false);
        if (result.success) {
            navigate('/');
        }
        setShowDeleteModal(false);
    };

    const handleDeleteCollectionAndVideos = async () => {
        if (!id) return;
        const result = await deleteCollection(id, true);
        if (result.success) {
            navigate('/');
        }
        setShowDeleteModal(false);
    };

    if (!collection) {
        return (
            <Container sx={{ mt: 4 }}>
                <Alert severity="error">{t('collectionNotFound')}</Alert>
            </Container>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
                <TagsSidebar
                    isSidebarOpen={isSidebarOpen}
                    availableTags={availableTags}
                    selectedTags={selectedTags}
                    onTagToggle={handleTagToggle}
                />

                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Button
                                onClick={() => setIsSidebarOpen(prev => !prev)}
                                variant="outlined"
                                size="small"
                                sx={{
                                    minWidth: 'auto',
                                    p: 1,
                                    display: { xs: 'none', md: 'inline-flex' },
                                    color: 'text.secondary',
                                    borderColor: 'text.secondary',
                                    mr: 2,
                                    height: 38,
                                }}
                            >
                                <ViewSidebar sx={{ transform: 'rotate(180deg)' }} />
                            </Button>
                            <Avatar sx={{ width: 56, height: 56, bgcolor: 'secondary.main', mr: 2 }}>
                                <Folder fontSize="large" />
                            </Avatar>
                            <Box>
                                <Typography variant="h4" component="h1" fontWeight="bold">
                                    {collection.name}
                                </Typography>
                                <Typography variant="subtitle1" color="text.secondary">
                                    {collectionVideos.length === 0
                                        ? `0 ${t('videos')}`
                                        : selectedTags.length > 0
                                            ? `${sortedVideos.length} / ${collectionVideos.length} ${t('videos')}`
                                            : `${collectionVideos.length} ${t('videos')}`}
                                </Typography>
                            </Box>
                        </Box>

                        {collectionVideos.length > 0 && (
                            <SortControl
                                sortOption={sortOption}
                                sortAnchorEl={sortAnchorEl}
                                onSortClick={handleSortClick}
                                onSortClose={handleSortClose}
                                sx={{ height: 38 }}
                            />
                        )}
                    </Box>

                    {collectionVideos.length === 0 ? (
                        <Alert severity="info" variant="outlined">{t('noVideosInCollection')}</Alert>
                    ) : sortedVideos.length === 0 ? (
                        <Alert severity="info" variant="outlined">
                            {t('noVideosFoundMatching')}
                        </Alert>
                    ) : (
                        <Box>
                            <Grid container spacing={3}>
                                {displayedVideos.map(video => (
                                    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={video.id}>
                                        <VideoCard
                                            video={video}
                                            collections={collections}
                                            onDeleteVideo={deleteVideo}
                                            showDeleteButton={true}
                                            disableCollectionGrouping={true}
                                        />
                                    </Grid>
                                ))}
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
                    )}
                </Box>
            </Box>

            <DeleteCollectionModal
                isOpen={showDeleteModal}
                onClose={handleCloseDeleteModal}
                onDeleteCollectionOnly={handleDeleteCollectionOnly}
                onDeleteCollectionAndVideos={handleDeleteCollectionAndVideos}
                collectionName={collection?.name || ''}
                videoCount={collectionVideos.length}
            />

        </Container>
    );
};

export default CollectionPage;
