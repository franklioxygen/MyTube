import {
    Alert,
    Box,
    Card,
    CardContent,
    CardMedia,
    Chip,
    CircularProgress,
    Container,
    Grid,
    Stack,
    Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ConfirmationModal from '../components/ConfirmationModal';
import CollectionModal from '../components/VideoPlayer/CollectionModal';
import CommentsSection from '../components/VideoPlayer/CommentsSection';
import VideoControls from '../components/VideoPlayer/VideoControls';
import VideoInfo from '../components/VideoPlayer/VideoInfo';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { Collection, Video } from '../types';

const API_URL = import.meta.env.VITE_API_URL;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

interface VideoPlayerProps {
    videos: Video[];
    onDeleteVideo: (id: string) => Promise<{ success: boolean; error?: string }>;
    collections: Collection[];
    onAddToCollection: (collectionId: string, videoId: string) => Promise<void>;
    onCreateCollection: (name: string, videoId: string) => Promise<void>;
    onRemoveFromCollection: (videoId: string) => Promise<any>;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
    videos,
    onDeleteVideo,
    collections,
    onAddToCollection,
    onCreateCollection,
    onRemoveFromCollection
}) => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const queryClient = useQueryClient();

    const [showCollectionModal, setShowCollectionModal] = useState<boolean>(false);
    const [videoCollections, setVideoCollections] = useState<Collection[]>([]);
    const [showComments, setShowComments] = useState<boolean>(false);

    // Confirmation Modal State
    const [confirmationModal, setConfirmationModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
        confirmText: t('confirm'),
        cancelText: t('cancel'),
        isDanger: false
    });

    // Fetch video details
    const { data: video, isLoading: loading, error } = useQuery({
        queryKey: ['video', id],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/videos/${id}`);
            return response.data;
        },
        initialData: () => {
            return videos.find(v => v.id === id);
        },
        enabled: !!id,
        retry: false
    });

    // Handle error redirect
    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => {
                navigate('/');
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [error, navigate]);

    // Fetch settings
    const { data: settings } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data;
        }
    });

    const autoPlay = settings?.defaultAutoPlay || false;
    const autoLoop = settings?.defaultAutoLoop || false;
    const availableTags = settings?.tags || [];

    // Fetch comments
    const { data: comments = [], isLoading: loadingComments } = useQuery({
        queryKey: ['comments', id],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/videos/${id}/comments`);
            return response.data;
        },
        enabled: showComments && !!id
    });

    const handleToggleComments = () => {
        setShowComments(!showComments);
    };

    // Find collections that contain this video
    useEffect(() => {
        if (collections && collections.length > 0 && id) {
            const belongsToCollections = collections.filter(collection =>
                collection.videos.includes(id)
            );
            setVideoCollections(belongsToCollections);
        } else {
            setVideoCollections([]);
        }
    }, [collections, id]);

    // Format the date (assuming format YYYYMMDD from youtube-dl)
    const formatDate = (dateString?: string) => {
        if (!dateString || dateString.length !== 8) {
            return 'Unknown date';
        }

        const year = dateString.substring(0, 4);
        const month = dateString.substring(4, 6);
        const day = dateString.substring(6, 8);

        return `${year}-${month}-${day}`;
    };

    // Handle navigation to author videos page
    const handleAuthorClick = () => {
        if (video) {
            navigate(`/author/${encodeURIComponent(video.author)}`);
        }
    };

    const handleCollectionClick = (collectionId: string) => {
        navigate(`/collection/${collectionId}`);
    };

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async (videoId: string) => {
            return await onDeleteVideo(videoId);
        },
        onSuccess: (result) => {
            if (result.success) {
                navigate('/', { replace: true });
            }
        }
    });

    const executeDelete = async () => {
        if (!id) return;
        await deleteMutation.mutateAsync(id);
    };

    const handleDelete = () => {
        setConfirmationModal({
            isOpen: true,
            title: t('deleteVideo'),
            message: t('confirmDelete'),
            onConfirm: executeDelete,
            confirmText: t('delete'),
            cancelText: t('cancel'),
            isDanger: true
        });
    };

    const handleAddToCollection = () => {
        setShowCollectionModal(true);
    };

    const handleCloseModal = () => {
        setShowCollectionModal(false);
    };

    const handleCreateCollection = async (name: string) => {
        if (!id) return;
        try {
            await onCreateCollection(name, id);
        } catch (error) {
            console.error('Error creating collection:', error);
        }
    };

    const handleAddToExistingCollection = async (collectionId: string) => {
        if (!id) return;
        try {
            await onAddToCollection(collectionId, id);
        } catch (error) {
            console.error('Error adding to collection:', error);
        }
    };

    const executeRemoveFromCollection = async () => {
        if (!id) return;

        try {
            await onRemoveFromCollection(id);
        } catch (error) {
            console.error('Error removing from collection:', error);
        }
    };

    const handleRemoveFromCollection = () => {
        setConfirmationModal({
            isOpen: true,
            title: t('removeFromCollection'),
            message: t('confirmRemoveFromCollection'),
            onConfirm: executeRemoveFromCollection,
            confirmText: t('remove'),
            cancelText: t('cancel'),
            isDanger: true
        });
    };

    // Rating mutation
    const ratingMutation = useMutation({
        mutationFn: async (newValue: number) => {
            await axios.post(`${API_URL}/videos/${id}/rate`, { rating: newValue });
            return newValue;
        },
        onSuccess: (newValue) => {
            queryClient.setQueryData(['video', id], (old: Video | undefined) => old ? { ...old, rating: newValue } : old);
        }
    });

    const handleRatingChange = async (newValue: number) => {
        if (!id) return;
        await ratingMutation.mutateAsync(newValue);
    };

    // Title mutation
    const titleMutation = useMutation({
        mutationFn: async (newTitle: string) => {
            const response = await axios.put(`${API_URL}/videos/${id}`, { title: newTitle });
            return response.data;
        },
        onSuccess: (data, newTitle) => {
            if (data.success) {
                queryClient.setQueryData(['video', id], (old: Video | undefined) => old ? { ...old, title: newTitle } : old);
                showSnackbar(t('titleUpdated'));
            }
        },
        onError: () => {
            showSnackbar(t('titleUpdateFailed'), 'error');
        }
    });

    const handleSaveTitle = async (newTitle: string) => {
        if (!id) return;
        await titleMutation.mutateAsync(newTitle);
    };

    // Tags mutation
    const tagsMutation = useMutation({
        mutationFn: async (newTags: string[]) => {
            const response = await axios.put(`${API_URL}/videos/${id}`, { tags: newTags });
            return response.data;
        },
        onSuccess: (data, newTags) => {
            if (data.success) {
                queryClient.setQueryData(['video', id], (old: Video | undefined) => old ? { ...old, tags: newTags } : old);
            }
        },
        onError: () => {
            showSnackbar(t('error'), 'error');
        }
    });

    const handleUpdateTags = async (newTags: string[]) => {
        if (!id) return;
        await tagsMutation.mutateAsync(newTags);
    };

    const [hasViewed, setHasViewed] = useState<boolean>(false);
    const lastProgressSave = useRef<number>(0);
    const currentTimeRef = useRef<number>(0);

    // Reset hasViewed when video changes
    useEffect(() => {
        setHasViewed(false);
        currentTimeRef.current = 0;
    }, [id]);

    // Save progress on unmount
    useEffect(() => {
        return () => {
            if (id && currentTimeRef.current > 0) {
                axios.put(`${API_URL}/videos/${id}/progress`, { progress: Math.floor(currentTimeRef.current) })
                    .catch(err => console.error('Error saving progress on unmount:', err));
            }
        };
    }, [id]);

    const handleTimeUpdate = (currentTime: number) => {
        currentTimeRef.current = currentTime;

        // Increment view count after 10 seconds
        if (currentTime > 10 && !hasViewed && id) {
            setHasViewed(true);
            axios.post(`${API_URL}/videos/${id}/view`)
                .then(res => {
                    if (res.data.success && video) {
                        queryClient.setQueryData(['video', id], (old: Video | undefined) => old ? { ...old, viewCount: res.data.viewCount } : old);
                    }
                })
                .catch(err => console.error('Error incrementing view count:', err));
        }

        // Save progress every 5 seconds
        const now = Date.now();
        if (now - lastProgressSave.current > 5000 && id) {
            lastProgressSave.current = now;
            axios.put(`${API_URL}/videos/${id}/progress`, { progress: Math.floor(currentTime) })
                .catch(err => console.error('Error saving progress:', err));
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
                <Typography sx={{ ml: 2 }}>{t('loadingVideo')}</Typography>
            </Box>
        );
    }

    if (error || !video) {
        return (
            <Container sx={{ mt: 4 }}>
                <Alert severity="error">{t('videoNotFoundOrLoaded')}</Alert>
            </Container>
        );
    }

    // Get related videos (exclude current video)
    const relatedVideos = videos.filter(v => v.id !== id).slice(0, 10);

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Grid container spacing={4}>
                {/* Main Content Column */}
                <Grid size={{ xs: 12, lg: 8 }}>
                    <VideoControls
                        src={`${BACKEND_URL}${video.videoPath || video.sourceUrl}`}
                        autoPlay={autoPlay}
                        autoLoop={autoLoop}
                        onTimeUpdate={handleTimeUpdate}
                        startTime={video.progress || 0}
                    />

                    <VideoInfo
                        video={video}
                        onTitleSave={handleSaveTitle}
                        onRatingChange={handleRatingChange}
                        onAuthorClick={handleAuthorClick}
                        onAddToCollection={handleAddToCollection}
                        onDelete={handleDelete}
                        isDeleting={deleteMutation.isPending}
                        deleteError={deleteMutation.error ? (deleteMutation.error as any).message || t('deleteFailed') : null}
                        videoCollections={videoCollections}
                        onCollectionClick={handleCollectionClick}
                        availableTags={availableTags}
                        onTagsUpdate={handleUpdateTags}
                    />

                    <CommentsSection
                        comments={comments}
                        loading={loadingComments}
                        showComments={showComments}
                        onToggleComments={handleToggleComments}
                    />
                </Grid>

                {/* Sidebar Column - Up Next */}
                <Grid size={{ xs: 12, lg: 4 }}>
                    <Typography variant="h6" gutterBottom fontWeight="bold">{t('upNext')}</Typography>
                    <Stack spacing={2}>
                        {relatedVideos.map(relatedVideo => (
                            <Card
                                key={relatedVideo.id}
                                sx={{ display: 'flex', cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                                onClick={() => navigate(`/video/${relatedVideo.id}`)}
                            >
                                <Box sx={{ width: 168, minWidth: 168, position: 'relative' }}>
                                    <CardMedia
                                        component="img"
                                        sx={{ width: '100%', height: 94, objectFit: 'cover' }}
                                        image={`${BACKEND_URL}${relatedVideo.thumbnailPath}`}
                                        alt={relatedVideo.title}
                                        onError={(e) => {
                                            const target = e.target as HTMLImageElement;
                                            target.onerror = null;
                                            target.src = 'https://via.placeholder.com/168x94?text=No+Thumbnail';
                                        }}
                                    />
                                    {relatedVideo.duration && (
                                        <Chip
                                            label={relatedVideo.duration || '00:00'}
                                            size="small"
                                            sx={{
                                                position: 'absolute',
                                                bottom: 4,
                                                right: 4,
                                                height: 20,
                                                fontSize: '0.75rem',
                                                bgcolor: 'rgba(0,0,0,0.8)',
                                                color: 'white'
                                            }}
                                        />
                                    )}
                                </Box>
                                <CardContent sx={{ flex: '1 0 auto', p: 1, '&:last-child': { pb: 1 } }}>
                                    <Typography variant="body2" fontWeight="bold" sx={{ lineHeight: 1.2, mb: 0.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                        {relatedVideo.title}
                                    </Typography>
                                    <Typography variant="caption" display="block" color="text.secondary">
                                        {relatedVideo.author}
                                    </Typography>
                                    <Typography variant="caption" display="block" color="text.secondary">
                                        {formatDate(relatedVideo.date)}
                                    </Typography>
                                    {relatedVideo.viewCount !== undefined && (
                                        <Typography variant="caption" display="block" color="text.secondary">
                                            {relatedVideo.viewCount} {t('views')}
                                        </Typography>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                        {relatedVideos.length === 0 && (
                            <Typography variant="body2" color="text.secondary">{t('noOtherVideos')}</Typography>
                        )}
                    </Stack>
                </Grid>
            </Grid>

            <CollectionModal
                open={showCollectionModal}
                onClose={handleCloseModal}
                videoCollections={videoCollections}
                collections={collections}
                onAddToCollection={handleAddToExistingCollection}
                onCreateCollection={handleCreateCollection}
                onRemoveFromCollection={handleRemoveFromCollection}
            />

            <ConfirmationModal
                isOpen={confirmationModal.isOpen}
                onClose={() => setConfirmationModal({ ...confirmationModal, isOpen: false })}
                onConfirm={confirmationModal.onConfirm}
                title={confirmationModal.title}
                message={confirmationModal.message}
                confirmText={confirmationModal.confirmText}
                cancelText={confirmationModal.cancelText}
                isDanger={confirmationModal.isDanger}
            />
        </Container>
    );
};

export default VideoPlayer;
