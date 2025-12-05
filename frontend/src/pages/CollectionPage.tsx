import { Folder } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Container,
    Grid,
    Pagination,
    Typography
} from '@mui/material';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DeleteCollectionModal from '../components/DeleteCollectionModal';
import VideoCard from '../components/VideoCard';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';

const CollectionPage: React.FC = () => {
    const { t } = useLanguage();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { collections, deleteCollection } = useCollection();
    const { videos, deleteVideo } = useVideo();

    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 12;

    const collection = collections.find(c => c.id === id);
    const collectionVideos = collection
        ? videos.filter(video => collection.videos.includes(video.id))
        : [];

    // Pagination logic
    const totalPages = Math.ceil(collectionVideos.length / ITEMS_PER_PAGE);
    const displayedVideos = collectionVideos.slice(
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
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Avatar sx={{ width: 56, height: 56, bgcolor: 'secondary.main', mr: 2 }}>
                        <Folder fontSize="large" />
                    </Avatar>
                    <Box>
                        <Typography variant="h4" component="h1" fontWeight="bold">
                            {collection.name}
                        </Typography>
                        <Typography variant="subtitle1" color="text.secondary">
                            {collectionVideos.length} {t('videos')}
                        </Typography>
                    </Box>
                </Box>
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
        </Container>
    );
};

export default CollectionPage;
