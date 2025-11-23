import { ArrowBack, Folder } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Button,
    CircularProgress,
    Container,
    Grid,
    Typography
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DeleteCollectionModal from '../components/DeleteCollectionModal';
import VideoCard from '../components/VideoCard';
import { Collection, Video } from '../types';

interface CollectionPageProps {
    collections: Collection[];
    videos: Video[];
    onDeleteVideo: (id: string) => Promise<any>;
    onDeleteCollection: (id: string, deleteVideos: boolean) => Promise<any>;
}

const CollectionPage: React.FC<CollectionPageProps> = ({ collections, videos, onDeleteVideo, onDeleteCollection }) => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [collection, setCollection] = useState<Collection | null>(null);
    const [collectionVideos, setCollectionVideos] = useState<Video[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);

    useEffect(() => {
        if (collections && collections.length > 0 && id) {
            const foundCollection = collections.find(c => c.id === id);

            if (foundCollection) {
                setCollection(foundCollection);

                // Find all videos that are in this collection
                const videosInCollection = videos.filter(video =>
                    foundCollection.videos.includes(video.id)
                );

                setCollectionVideos(videosInCollection);
            } else {
                // Collection not found, redirect to home
                navigate('/');
            }
        }

        setLoading(false);
    }, [id, collections, videos, navigate]);

    const handleBack = () => {
        navigate(-1);
    };

    const handleCloseDeleteModal = () => {
        setShowDeleteModal(false);
    };

    const handleDeleteCollectionOnly = async () => {
        if (!id) return;
        const success = await onDeleteCollection(id, false);
        if (success) {
            navigate('/');
        }
        setShowDeleteModal(false);
    };

    const handleDeleteCollectionAndVideos = async () => {
        if (!id) return;
        const success = await onDeleteCollection(id, true);
        if (success) {
            navigate('/');
        }
        setShowDeleteModal(false);
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
                <Typography sx={{ ml: 2 }}>Loading collection...</Typography>
            </Box>
        );
    }

    if (!collection) {
        return (
            <Container sx={{ mt: 4 }}>
                <Alert severity="error">Collection not found</Alert>
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
                            {collectionVideos.length} video{collectionVideos.length !== 1 ? 's' : ''}
                        </Typography>
                    </Box>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={<ArrowBack />}
                    onClick={handleBack}
                >
                    Back
                </Button>
            </Box>

            {collectionVideos.length === 0 ? (
                <Alert severity="info" variant="outlined">No videos in this collection.</Alert>
            ) : (
                <Grid container spacing={3}>
                    {collectionVideos.map(video => (
                        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={video.id}>
                            <VideoCard
                                video={video}
                                collections={collections}
                                onDeleteVideo={onDeleteVideo}
                                showDeleteButton={true}
                                disableCollectionGrouping={true}
                            />
                        </Grid>
                    ))}
                </Grid>
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
