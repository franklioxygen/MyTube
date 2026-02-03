import { Folder, LocalOffer } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Chip,
    Container,
    Grid,
    IconButton,
    Pagination,
    Tooltip,
    Typography
} from '@mui/material';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DeleteCollectionModal from '../components/DeleteCollectionModal';
import SortControl from '../components/SortControl';
import TagsModal from '../components/TagsModal';
import VideoCard from '../components/VideoCard';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useVideo } from '../contexts/VideoContext';
import { useSettings } from '../hooks/useSettings';
import { useSettingsMutations } from '../hooks/useSettingsMutations';
import { useVideoSort } from '../hooks/useVideoSort';

function normalizeTagValue(value: string): string {
    return value.trim().toLowerCase();
}

const CollectionPage: React.FC = () => {
    const { t } = useLanguage();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { showSnackbar } = useSnackbar();
    const { collections, deleteCollection } = useCollection();
    const { videos, deleteVideo, availableTags } = useVideo();
    const { data: settings } = useSettings();
    const { saveMutation } = useSettingsMutations({
        setMessage: (msg) => msg && showSnackbar(msg.text, msg.type),
        setInfoModal: () => {}
    });

    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 12;

    const collection = collections.find(c => c.id === id);
    const collectionVideos = collection
        ? videos.filter(video => collection.videos.includes(video.id))
        : [];
    const collectionTagsList = (collection && settings?.collectionTags?.[collection.id]) ?? [];

    // Sort videos
    const {
        sortedVideos,
        sortOption,
        sortAnchorEl,
        handleSortClick,
        handleSortClose
    } = useVideoSort({
        videos: collectionVideos,
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

    const handleSaveCollectionTags = async (tags: string[]) => {
        if (!settings || !collection) return;
        const normalizedTags = Array.from(
            new Set(tags.map((tag) => normalizeTagValue(tag)).filter(Boolean))
        );
        const collectionTags = { ...(settings.collectionTags ?? {}), [collection.id]: normalizedTags };
        if (normalizedTags.length === 0) {
            delete collectionTags[collection.id];
        }
        await saveMutation.mutateAsync({ ...settings, collectionTags });
        setIsTagsModalOpen(false);
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
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Avatar sx={{ width: 56, height: 56, bgcolor: 'secondary.main', mr: 2 }}>
                        <Folder fontSize="large" />
                    </Avatar>
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="h4" component="h1" fontWeight="bold">
                                {collection.name}
                            </Typography>
                            <Tooltip title={t('addTags')}>
                                <IconButton
                                    color="primary"
                                    onClick={() => setIsTagsModalOpen(true)}
                                    aria-label="add tags to collection"
                                >
                                    <LocalOffer />
                                </IconButton>
                            </Tooltip>
                        </Box>
                        <Typography variant="subtitle1" color="text.secondary">
                            {collectionVideos.length} {t('videos')}
                        </Typography>
                        {collectionTagsList.length > 0 && (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                                {collectionTagsList.map((tag) => (
                                    <Chip key={tag} label={tag} size="small" variant="outlined" />
                                ))}
                            </Box>
                        )}
                    </Box>
                </Box>

                {/* Sort Control */}
                {collectionVideos.length > 0 && (
                    <SortControl
                        sortOption={sortOption}
                        sortAnchorEl={sortAnchorEl}
                        onSortClick={handleSortClick}
                        onSortClose={handleSortClose}
                        sx={{ height: '38px', marginTop: '2px' }}
                    />
                )}
            </Box>

            {collectionVideos.length === 0 ? (
                <Alert severity="info" variant="outlined">{t('noVideosInCollection')}</Alert>
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

            <DeleteCollectionModal
                isOpen={showDeleteModal}
                onClose={handleCloseDeleteModal}
                onDeleteCollectionOnly={handleDeleteCollectionOnly}
                onDeleteCollectionAndVideos={handleDeleteCollectionAndVideos}
                collectionName={collection?.name || ''}
                videoCount={collectionVideos.length}
            />

            <TagsModal
                open={isTagsModalOpen}
                onClose={() => setIsTagsModalOpen(false)}
                videoTags={collectionTagsList}
                availableTags={availableTags}
                onSave={handleSaveCollectionTags}
            />
        </Container>
    );
};

export default CollectionPage;
