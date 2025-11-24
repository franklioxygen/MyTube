import {
    Add,
    CalendarToday,
    Delete,
    Download,
    FastForward,
    FastRewind,
    Folder,
    Forward10,
    Fullscreen,
    FullscreenExit,
    Link as LinkIcon,
    Loop,
    Pause,
    PlayArrow,
    Replay10,
    VideoLibrary
} from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Button,
    Card,
    CardContent,
    CardMedia,
    Chip,
    CircularProgress,
    Container,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    Grid,
    InputLabel,
    MenuItem,
    Rating,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ConfirmationModal from '../components/ConfirmationModal';
import { useLanguage } from '../contexts/LanguageContext';
import { Collection, Comment, Video } from '../types';

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
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const { t } = useLanguage();

    const [video, setVideo] = useState<Video | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [showCollectionModal, setShowCollectionModal] = useState<boolean>(false);
    const [newCollectionName, setNewCollectionName] = useState<string>('');
    const [selectedCollection, setSelectedCollection] = useState<string>('');
    const [videoCollections, setVideoCollections] = useState<Collection[]>([]);
    const [comments, setComments] = useState<Comment[]>([]);
    const [loadingComments, setLoadingComments] = useState<boolean>(false);
    const [showComments, setShowComments] = useState<boolean>(false);
    const [commentsLoaded, setCommentsLoaded] = useState<boolean>(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isLooping, setIsLooping] = useState<boolean>(false);

    // Confirmation Modal State
    const [confirmationModal, setConfirmationModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
        confirmText: t('confirm'),
        isDanger: false
    });

    const handlePlayPause = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleToggleLoop = () => {
        if (videoRef.current) {
            videoRef.current.loop = !isLooping;
            setIsLooping(!isLooping);
        }
    };

    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

    const handleToggleFullscreen = () => {
        const videoContainer = videoRef.current?.parentElement;
        if (!videoContainer) return;

        if (!document.fullscreenElement) {
            videoContainer.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    };

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    const handleSeek = (seconds: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime += seconds;
        }
    };

    useEffect(() => {
        // Don't try to fetch the video if it's being deleted
        if (isDeleting) {
            return;
        }

        const fetchVideo = async () => {
            if (!id) return;

            // First check if the video is in the videos prop
            const foundVideo = videos.find(v => v.id === id);

            if (foundVideo) {
                setVideo(foundVideo);
                setLoading(false);
                return;
            }

            // If not found in props, try to fetch from API
            try {
                const response = await axios.get(`${API_URL}/videos/${id}`);
                setVideo(response.data);
                setError(null);
            } catch (err) {
                console.error('Error fetching video:', err);
                setError(t('videoNotFoundOrLoaded'));

                // Redirect to home after 3 seconds if video not found
                setTimeout(() => {
                    navigate('/');
                }, 3000);
            } finally {
                setLoading(false);
            }
        };

        fetchVideo();
        fetchVideo();
    }, [id, videos, navigate, isDeleting]);

    // Fetch settings and apply defaults
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await axios.get(`${API_URL}/settings`);
                const { defaultAutoPlay, defaultAutoLoop } = response.data;

                if (videoRef.current) {
                    if (defaultAutoPlay) {
                        videoRef.current.autoplay = true;
                        setIsPlaying(true);
                    }
                    if (defaultAutoLoop) {
                        videoRef.current.loop = true;
                        setIsLooping(true);
                    }
                }
            } catch (error) {
                console.error('Error fetching settings:', error);
            }
        };

        fetchSettings();
    }, [id]); // Re-run when video changes

    const fetchComments = async () => {
        if (!id) return;

        setLoadingComments(true);
        try {
            const response = await axios.get(`${API_URL}/videos/${id}/comments`);
            setComments(response.data);
            setCommentsLoaded(true);
        } catch (err) {
            console.error('Error fetching comments:', err);
            // We don't set a global error here as comments are secondary
        } finally {
            setLoadingComments(false);
        }
    };

    const handleToggleComments = () => {
        if (!showComments && !commentsLoaded) {
            fetchComments();
        }
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

    const executeDelete = async () => {
        if (!id) return;

        setIsDeleting(true);
        setDeleteError(null);

        try {
            const result = await onDeleteVideo(id);

            if (result.success) {
                // Navigate to home immediately after successful deletion
                navigate('/', { replace: true });
            } else {
                setDeleteError(result.error || t('deleteFailed'));
                setIsDeleting(false);
            }
        } catch (err) {
            setDeleteError(t('unexpectedErrorOccurred'));
            console.error(err);
            setIsDeleting(false);
        }
    };

    const handleDelete = () => {
        setConfirmationModal({
            isOpen: true,
            title: t('deleteVideo'),
            message: t('confirmDelete'),
            onConfirm: executeDelete,
            confirmText: t('delete'),
            isDanger: true
        });
    };

    const handleAddToCollection = () => {
        setShowCollectionModal(true);
    };

    const handleCloseModal = () => {
        setShowCollectionModal(false);
        setNewCollectionName('');
        setSelectedCollection('');
    };

    const handleCreateCollection = async () => {
        if (!newCollectionName.trim() || !id) {
            return;
        }

        try {
            await onCreateCollection(newCollectionName, id);
            handleCloseModal();
        } catch (error) {
            console.error('Error creating collection:', error);
        }
    };

    const handleAddToExistingCollection = async () => {
        if (!selectedCollection || !id) {
            return;
        }

        try {
            await onAddToCollection(selectedCollection, id);
            handleCloseModal();
        } catch (error) {
            console.error('Error adding to collection:', error);
        }
    };

    const executeRemoveFromCollection = async () => {
        if (!id) return;

        try {
            await onRemoveFromCollection(id);
            handleCloseModal();
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
            isDanger: true
        });
    };

    const handleRatingChange = async (event: React.SyntheticEvent, newValue: number | null) => {
        if (!newValue || !id) return;

        try {
            await axios.post(`${API_URL}/videos/${id}/rate`, { rating: newValue });
            setVideo(prev => prev ? { ...prev, rating: newValue } : null);
        } catch (error) {
            console.error('Error updating rating:', error);
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
                <Alert severity="error">{error || t('videoNotFound')}</Alert>
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
                    <Box sx={{ width: '100%', bgcolor: 'black', borderRadius: 2, overflow: 'hidden', boxShadow: 4 }}>
                        <video
                            ref={videoRef}
                            style={{ width: '100%', aspectRatio: '16/9', display: 'block' }}
                            controls
                            src={`${BACKEND_URL}${video.videoPath || video.sourceUrl}`}
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                            playsInline
                        >
                            Your browser does not support the video tag.
                        </video>

                        {/* Custom Controls Area */}
                        <Box sx={{
                            p: 1,
                            bgcolor: theme.palette.mode === 'dark' ? '#1a1a1a' : '#f5f5f5',
                            opacity: isFullscreen ? 0.3 : 1,
                            transition: 'opacity 0.3s',
                            '&:hover': { opacity: 1 }
                        }}>
                            <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                alignItems="center"
                                justifyContent="center"
                                spacing={{ xs: 2, sm: 2 }}
                            >
                                {/* Row 1 on Mobile: Play/Pause and Loop */}
                                <Stack direction="row" spacing={2} justifyContent="center" width={{ xs: '100%', sm: 'auto' }}>
                                    <Tooltip title={isPlaying ? t('paused') : t('playing')}>
                                        <Button
                                            variant="contained"
                                            color={isPlaying ? "warning" : "primary"}
                                            onClick={handlePlayPause}
                                            fullWidth={isMobile}
                                        >
                                            {isPlaying ? <Pause /> : <PlayArrow />}
                                        </Button>
                                    </Tooltip>

                                    <Tooltip title={`${t('loop')} ${isLooping ? t('on') : t('off')}`}>
                                        <Button
                                            variant={isLooping ? "contained" : "outlined"}
                                            color="secondary"
                                            onClick={handleToggleLoop}
                                            fullWidth={isMobile}
                                        >
                                            <Loop />
                                        </Button>
                                    </Tooltip>

                                    <Tooltip title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}>
                                        <Button
                                            variant="outlined"
                                            onClick={handleToggleFullscreen}
                                            fullWidth={isMobile}
                                        >
                                            {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
                                        </Button>
                                    </Tooltip>
                                </Stack>

                                {/* Row 2 on Mobile: Seek Controls */}
                                <Stack direction="row" spacing={1} justifyContent="center" width={{ xs: '100%', sm: 'auto' }}>
                                    <Tooltip title="-1m">
                                        <Button variant="outlined" onClick={() => handleSeek(-60)}>
                                            <FastRewind />
                                        </Button>
                                    </Tooltip>
                                    <Tooltip title="-10s">
                                        <Button variant="outlined" onClick={() => handleSeek(-10)}>
                                            <Replay10 />
                                        </Button>
                                    </Tooltip>
                                    <Tooltip title="+10s">
                                        <Button variant="outlined" onClick={() => handleSeek(10)}>
                                            <Forward10 />
                                        </Button>
                                    </Tooltip>
                                    <Tooltip title="+1m">
                                        <Button variant="outlined" onClick={() => handleSeek(60)}>
                                            <FastForward />
                                        </Button>
                                    </Tooltip>
                                </Stack>
                            </Stack>
                        </Box>
                    </Box>
                    {/* Info Column */}
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="h5" component="h1" fontWeight="bold" gutterBottom>
                            {video.title}
                        </Typography>

                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                            <Rating
                                value={video.rating || 0}
                                onChange={handleRatingChange}
                            />
                            <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                                {video.rating ? `(${video.rating})` : t('rateThisVideo')}
                            </Typography>
                        </Box>

                        <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            justifyContent="space-between"
                            alignItems={{ xs: 'flex-start', sm: 'center' }}
                            spacing={2}
                            sx={{ mb: 2 }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <Avatar sx={{ bgcolor: 'primary.main', mr: 2 }}>
                                    {video.author ? video.author.charAt(0).toUpperCase() : 'A'}
                                </Avatar>
                                <Box>
                                    <Typography
                                        variant="subtitle1"
                                        fontWeight="bold"
                                        onClick={handleAuthorClick}
                                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                                    >
                                        {video.author}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {formatDate(video.date)}
                                    </Typography>
                                </Box>
                            </Box>

                            <Stack direction="row" spacing={1}>
                                <Button
                                    variant="outlined"
                                    startIcon={<Add />}
                                    onClick={handleAddToCollection}
                                >
                                    {t('addToCollection')}
                                </Button>
                                <Button
                                    variant="outlined"
                                    color="error"
                                    startIcon={<Delete />}
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                >
                                    {isDeleting ? t('deleting') : t('delete')}
                                </Button>
                            </Stack>
                        </Stack>

                        {deleteError && (
                            <Alert severity="error" sx={{ mb: 2 }}>
                                {deleteError}
                            </Alert>
                        )}

                        <Divider sx={{ my: 2 }} />

                        <Box sx={{ bgcolor: 'background.paper', p: 2, borderRadius: 2 }}>
                            <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap">
                                {video.sourceUrl && (
                                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                                        <a href={video.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: theme.palette.primary.main, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
                                            <LinkIcon fontSize="small" sx={{ mr: 0.5 }} />
                                            <strong>{t('originalLink')}</strong>
                                        </a>
                                    </Typography>
                                )}
                                {video.videoPath && (
                                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                                        <a href={`${BACKEND_URL}${video.videoPath}`} download style={{ color: theme.palette.primary.main, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
                                            <Download fontSize="small" sx={{ mr: 0.5 }} />
                                            <strong>{t('download')}</strong>
                                        </a>
                                    </Typography>
                                )}
                                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                                    <VideoLibrary fontSize="small" sx={{ mr: 0.5 }} />
                                    <strong>{t('source')}</strong> {video.source === 'bilibili' ? 'Bilibili' : (video.source === 'local' ? 'Local Upload' : 'YouTube')}
                                </Typography>
                                {video.addedAt && (
                                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                                        <CalendarToday fontSize="small" sx={{ mr: 0.5 }} />
                                        <strong>{t('addedDate')}</strong> {new Date(video.addedAt).toLocaleDateString()}
                                    </Typography>
                                )}
                            </Stack>

                            {videoCollections.length > 0 && (
                                <Box sx={{ mt: 2 }}>
                                    <Typography variant="subtitle2" gutterBottom>{t('collections')}:</Typography>
                                    <Stack direction="row" spacing={1} flexWrap="wrap">
                                        {videoCollections.map(c => (
                                            <Chip
                                                key={c.id}
                                                icon={<Folder />}
                                                label={c.name}
                                                onClick={() => handleCollectionClick(c.id)}
                                                color="secondary"
                                                variant="outlined"
                                                clickable
                                                sx={{ mb: 1 }}
                                            />
                                        ))}
                                    </Stack>
                                </Box>
                            )}
                        </Box>

                        {/* Comments Section */}
                        <Box sx={{ mt: 4 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                <Typography variant="h6" fontWeight="bold">
                                    {t('latestComments')}
                                </Typography>
                                <Button
                                    variant="outlined"
                                    onClick={handleToggleComments}
                                    size="small"
                                >
                                    {showComments ? "Hide Comments" : "Show Comments"}
                                </Button>
                            </Box>

                            {showComments && (
                                <>
                                    {loadingComments ? (
                                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                            <CircularProgress size={24} />
                                        </Box>
                                    ) : comments.length > 0 ? (
                                        <Stack spacing={2}>
                                            {comments.map((comment) => (
                                                <Box key={comment.id} sx={{ display: 'flex', gap: 2 }}>
                                                    <Avatar src={comment.avatar} alt={comment.author}>
                                                        {comment.author.charAt(0).toUpperCase()}
                                                    </Avatar>
                                                    <Box sx={{ flex: 1 }}>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                                            <Typography variant="subtitle2" fontWeight="bold">
                                                                {comment.author}
                                                            </Typography>
                                                            <Typography variant="caption" color="text.secondary">
                                                                {comment.date}
                                                            </Typography>
                                                        </Box>
                                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                                            {comment.content}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                            ))}
                                        </Stack>
                                    ) : (
                                        <Typography variant="body2" color="text.secondary">
                                            {t('noComments')}
                                        </Typography>
                                    )}
                                </>
                            )}
                        </Box>
                    </Box>
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
                                </CardContent>
                            </Card>
                        ))}
                        {relatedVideos.length === 0 && (
                            <Typography variant="body2" color="text.secondary">{t('noOtherVideos')}</Typography>
                        )}
                    </Stack>
                </Grid>
            </Grid>

            {/* Collection Modal */}
            <Dialog open={showCollectionModal} onClose={handleCloseModal} maxWidth="sm" fullWidth>
                <DialogTitle>{t('addToCollection')}</DialogTitle>
                <DialogContent dividers>
                    {videoCollections.length > 0 && (
                        <Alert severity="info" sx={{ mb: 3 }} action={
                            <Button color="error" size="small" onClick={handleRemoveFromCollection}>
                                {t('remove')}
                            </Button>
                        }>
                            {t('currentlyIn')} <strong>{videoCollections[0].name}</strong>
                            <Typography variant="caption" display="block">
                                {t('collectionWarning')}
                            </Typography>
                        </Alert>
                    )}

                    {collections && collections.length > 0 && (
                        <Box sx={{ mb: 4 }}>
                            <Typography variant="subtitle2" gutterBottom>{t('addToExistingCollection')}</Typography>
                            <Stack direction="row" spacing={2}>
                                <FormControl fullWidth size="small">
                                    <InputLabel>{t('selectCollection')}</InputLabel>
                                    <Select
                                        value={selectedCollection}
                                        label={t('selectCollection')}
                                        onChange={(e) => setSelectedCollection(e.target.value)}
                                    >
                                        {collections.map(collection => (
                                            <MenuItem
                                                key={collection.id}
                                                value={collection.id}
                                                disabled={videoCollections.length > 0 && videoCollections[0].id === collection.id}
                                            >
                                                {collection.name} {videoCollections.length > 0 && videoCollections[0].id === collection.id ? t('current') : ''}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <Button
                                    variant="contained"
                                    onClick={handleAddToExistingCollection}
                                    disabled={!selectedCollection}
                                >
                                    {t('add')}
                                </Button>
                            </Stack>
                        </Box>
                    )}

                    <Box>
                        <Typography variant="subtitle2" gutterBottom>{t('createNewCollection')}</Typography>
                        <Stack direction="row" spacing={2}>
                            <TextField
                                fullWidth
                                size="small"
                                label={t('collectionName')}
                                value={newCollectionName}
                                onChange={(e) => setNewCollectionName(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && newCollectionName.trim() && handleCreateCollection()}
                            />
                            <Button
                                variant="contained"
                                onClick={handleCreateCollection}
                                disabled={!newCollectionName.trim()}
                            >
                                {t('create')}
                            </Button>
                        </Stack>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseModal} color="inherit">{t('cancel')}</Button>
                </DialogActions>
            </Dialog>

            <ConfirmationModal
                isOpen={confirmationModal.isOpen}
                onClose={() => setConfirmationModal({ ...confirmationModal, isOpen: false })}
                onConfirm={confirmationModal.onConfirm}
                title={confirmationModal.title}
                message={confirmationModal.message}
                confirmText={confirmationModal.confirmText}
                isDanger={confirmationModal.isDanger}
            />
        </Container>
    );
};

export default VideoPlayer;
