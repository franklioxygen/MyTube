import { Delete } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    CircularProgress,
    Container,
    Grid,
    IconButton,
    Tooltip,
    Typography
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ConfirmationModal from '../components/ConfirmationModal';
import VideoCard from '../components/VideoCard';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useVideo } from '../contexts/VideoContext';
import { Video } from '../types';

const AuthorVideos: React.FC = () => {
    const { t } = useLanguage();
    const { authorName } = useParams<{ authorName: string }>();
    const author = authorName;
    const { videos, loading, deleteVideo } = useVideo();
    const { collections } = useCollection();
    const { showSnackbar } = useSnackbar();
    const navigate = useNavigate();

    const [authorVideos, setAuthorVideos] = useState<Video[]>([]);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (!author) return;

        if (videos) {
            const filteredVideos = videos.filter(
                video => video.author === author
            );
            setAuthorVideos(filteredVideos);
        }
    }, [author, videos]);

    const handleDeleteAuthor = async () => {
        if (!authorVideos.length) return;

        setIsDeleting(true);
        try {
            // Delete all videos for this author
            // Use showSnackbar: false to avoid spamming the user with notifications
            await Promise.all(
                authorVideos.map(video =>
                    deleteVideo(video.id, { showSnackbar: false })
                )
            );

            showSnackbar(t('authorDeletedSuccessfully'));
            // Navigate back to home or safe page
            navigate('/');
        } catch (error) {
            console.error('Error deleting author videos:', error);
            showSnackbar(t('failedToDeleteAuthor'));
        } finally {
            setIsDeleting(false);
            setIsDeleteModalOpen(false);
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
                <Typography sx={{ ml: 2 }}>{t('loadingVideos')}</Typography>
            </Box>
        );
    }

    // Filter videos to only show the first video from each collection
    const filteredVideos = authorVideos.filter(video => {
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

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Avatar sx={{ width: 56, height: 56, bgcolor: 'primary.main', mr: 2, fontSize: '1.5rem' }}>
                        {author ? author.charAt(0).toUpperCase() : 'A'}
                    </Avatar>
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Typography variant="h4" component="h1" fontWeight="bold">
                                {author || t('unknownAuthor')}
                            </Typography>
                            {authorVideos.length > 0 && (
                                <Tooltip title={t('deleteAuthor')}>
                                    <IconButton
                                        color="error"
                                        onClick={() => setIsDeleteModalOpen(true)}
                                        aria-label="delete author"
                                    >
                                        <Delete />
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Box>
                        <Typography variant="subtitle1" color="text.secondary">
                            {authorVideos.length} {t('videos')}
                        </Typography>
                    </Box>
                </Box>
            </Box>

            {authorVideos.length === 0 ? (
                <Alert severity="info" variant="outlined">{t('noVideosForAuthor')}</Alert>
            ) : (
                <Grid container spacing={3}>
                    {filteredVideos.map(video => (
                        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={video.id}>
                            <VideoCard
                                video={video}
                                collections={collections}
                                onDeleteVideo={deleteVideo}
                                showDeleteButton={true}
                            />
                        </Grid>
                    ))}
                </Grid>
            )}

            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteAuthor}
                title={t('deleteAuthor')}
                message={t('deleteAuthorConfirmation', { author: author || '' })}
                confirmText={isDeleting ? t('deleting') : t('delete')}
                cancelText={t('cancel')}
                isDanger={true}
            />
        </Container>
    );
};

export default AuthorVideos;
