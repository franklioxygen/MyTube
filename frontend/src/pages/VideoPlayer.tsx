import {
    Alert,
    Box,
    CircularProgress,
    Container,
    Grid,
    Typography
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CollectionModal from '../components/CollectionModal';
import ConfirmationModal from '../components/ConfirmationModal';
import SubscribeModal from '../components/SubscribeModal';
import CommentsSection from '../components/VideoPlayer/CommentsSection';
import UpNextSidebar from '../components/VideoPlayer/UpNextSidebar';
import VideoControls from '../components/VideoPlayer/VideoControls';
import VideoInfo from '../components/VideoPlayer/VideoInfo';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { useCloudStorageUrl } from '../hooks/useCloudStorageUrl';
import { useSettings } from '../hooks/useSettings';
import { useVideoCollections } from '../hooks/useVideoCollections';
import { useVideoMutations } from '../hooks/useVideoMutations';
import { useVideoPlayerSettings } from '../hooks/useVideoPlayerSettings';
import { useVideoProgress } from '../hooks/useVideoProgress';
import { useVideoQueries } from '../hooks/useVideoQueries';
import { useVideoRecommendations } from '../hooks/useVideoRecommendations';
import { useVideoSubscriptions } from '../hooks/useVideoSubscriptions';

const VideoPlayer: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { videos } = useVideo();
    const { userRole } = useAuth();
    const { data: settings } = useSettings();
    const isVisitor = userRole === 'visitor';

    const [showComments, setShowComments] = useState<boolean>(false);
    const [autoPlayNext, setAutoPlayNext] = useState<boolean>(() => {
        const saved = localStorage.getItem('autoPlayNext');
        return saved !== null ? JSON.parse(saved) : false;
    });

    useEffect(() => {
        localStorage.setItem('autoPlayNext', JSON.stringify(autoPlayNext));
    }, [autoPlayNext]);

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

    // Use custom hooks
    const { video, loading, error, comments, loadingComments } = useVideoQueries({
        videoId: id,
        videos,
        showComments
    });

    // Handle error redirect and invisible videos in visitor mode
    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => {
                navigate('/');
            }, 3000);
            return () => clearTimeout(timer);
        }
        // In visitor mode, redirect if video is invisible
        if (isVisitor && video && (video.visibility ?? 1) === 0) {
            const timer = setTimeout(() => {
                navigate('/');
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [error, navigate, isVisitor, video]);

    // Update document title
    useEffect(() => {
        if (video?.title) {
            const siteName = settings?.websiteName || 'MyTube';
            document.title = `${video.title} - ${siteName}`;
        }

        return () => {
            // Revert title on cleanup
            if (settings?.websiteName) {
                document.title = settings.websiteName;
            } else {
                document.title = "MyTube - My Videos, My Rules.";
            }
        };
    }, [video?.title, settings?.websiteName]);

    // Use video player settings hook
    const {
        autoPlay: settingsAutoPlay,
        autoLoop,
        subtitlesEnabled,
        availableTags,
        handleSubtitlesToggle,
        handleLoopToggle,
        pauseOnFocusLoss
    } = useVideoPlayerSettings();

    const autoPlay = autoPlayNext || settingsAutoPlay;

    // Get cloud storage URLs
    const videoUrl = useCloudStorageUrl(video?.videoPath, 'video', video?.signedUrl);

    // Get thumbnail URL for poster
    // Only load thumbnail from cloud if the video itself is in cloud storage
    const isVideoInCloud = video?.videoPath?.startsWith('cloud:') ?? false;
    const thumbnailPathForCloud = isVideoInCloud ? video?.thumbnailPath : null;
    const posterUrl = useCloudStorageUrl(thumbnailPathForCloud, 'thumbnail', video?.signedThumbnailUrl);
    const localPosterUrl = !isVideoInCloud && video?.thumbnailPath
        ? `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5551'}${video.thumbnailPath}`
        : undefined;

    // Use custom hooks
    const {
        collections,
        videoCollections,
        modalVideoCollections,
        showCollectionModal,
        handleAddToCollection,
        handleCloseModal,
        handleCreateCollection,
        handleAddToExistingCollection,
        handleRemoveFromCollection
    } = useVideoCollections({ videoId: id });

    const {
        authorChannelUrl,
        isSubscribed,
        subscriptionId,
        showSubscribeModal,
        setShowSubscribeModal,
        handleAuthorClick: handleAuthorClickFromHook,
        handleSubscribe,
        handleSubscribeConfirm,
        handleUnsubscribe: handleUnsubscribeFromHook,
        unsubscribeMutation
    } = useVideoSubscriptions({ video });

    const {
        ratingMutation,
        titleMutation,
        tagsMutation,
        visibilityMutation,
        deleteMutation
    } = useVideoMutations({
        videoId: id,
        onDeleteSuccess: () => navigate('/', { replace: true })
    });

    const { handleTimeUpdate, setIsDeleting } = useVideoProgress({ videoId: id, video });

    const { relatedVideos } = useVideoRecommendations({ video });

    const handleToggleComments = () => {
        setShowComments(!showComments);
    };

    // Handle author click with navigation
    const handleAuthorClick = () => {
        const result = handleAuthorClickFromHook();
        if (result?.shouldNavigate) {
            navigate(result.path);
        }
    };

    // Handle unsubscribe with confirmation modal
    const handleUnsubscribe = () => {
        if (!subscriptionId) return;

        setConfirmationModal({
            isOpen: true,
            title: t('unsubscribe'),
            message: t('confirmUnsubscribe', { author: video?.author || '' }),
            onConfirm: () => {
                handleUnsubscribeFromHook(() => {
                    unsubscribeMutation.mutate(subscriptionId);
                });
                setConfirmationModal({ ...confirmationModal, isOpen: false });
            },
            confirmText: t('unsubscribe'),
            cancelText: t('cancel'),
            isDanger: true
        });
    };

    const handleCollectionClick = (collectionId: string) => {
        navigate(`/collection/${collectionId}`);
    };

    const executeDelete = async () => {
        if (!id) return;
        setIsDeleting(true);
        try {
            await deleteMutation.mutateAsync(id);
        } catch (error) {
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
            cancelText: t('cancel'),
            isDanger: true
        });
    };

    const handleRatingChange = async (newValue: number) => {
        if (!id) return;
        await ratingMutation.mutateAsync(newValue);
    };

    const handleSaveTitle = async (newTitle: string) => {
        if (!id) return;
        await titleMutation.mutateAsync(newTitle);
    };

    const handleUpdateTags = async (newTags: string[]) => {
        if (!id) return;
        await tagsMutation.mutateAsync(newTags);
    };

    const handleToggleVisibility = async () => {
        if (!id || !video) return;
        const newVisibility = video.visibility === 0 ? 1 : 0;
        await visibilityMutation.mutateAsync(newVisibility);
    };

    const executeRemoveFromCollection = async () => {
        await handleRemoveFromCollection();
        setConfirmationModal({ ...confirmationModal, isOpen: false });
    };

    const handleRemoveFromCollectionWithConfirm = () => {
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

    // Scroll to top when video ID changes
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [id]);

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



    const handleVideoEnded = () => {
        if (autoPlayNext && relatedVideos.length > 0) {
            navigate(`/video/${relatedVideos[0].id}`);
        }
    };

    return (
        <Container maxWidth={false} disableGutters sx={{ py: { xs: 0, md: 4 }, px: { xs: 0, md: 2 } }}>
            <Grid container spacing={{ xs: 0, md: 4 }}>
                {/* Main Content Column */}
                <Grid size={{ xs: 12, lg: 8 }}>
                    <VideoControls
                        src={(videoUrl || video?.sourceUrl) || null}
                        poster={posterUrl || localPosterUrl || video?.thumbnailUrl}
                        autoPlay={autoPlay}
                        autoLoop={autoLoop}
                        pauseOnFocusLoss={pauseOnFocusLoss}
                        onTimeUpdate={handleTimeUpdate}
                        startTime={video.progress || 0}
                        subtitles={video.subtitles}
                        subtitlesEnabled={subtitlesEnabled}
                        onSubtitlesToggle={handleSubtitlesToggle}
                        onLoopToggle={handleLoopToggle}
                        onEnded={handleVideoEnded}
                    />

                    <Box sx={{ px: { xs: 2, md: 0 } }}>
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
                            isSubscribed={isSubscribed}
                            onSubscribe={handleSubscribe}
                            onUnsubscribe={handleUnsubscribe}
                            onToggleVisibility={handleToggleVisibility}
                        />

                        {(video.source === 'youtube' || video.source === 'bilibili') && (
                            <CommentsSection
                                comments={comments}
                                loading={loadingComments}
                                showComments={showComments}
                                onToggleComments={handleToggleComments}
                            />
                        )}
                    </Box>
                </Grid>

                {/* Sidebar Column - Up Next */}
                <Grid size={{ xs: 12, lg: 4 }}>
                    <UpNextSidebar
                        relatedVideos={relatedVideos}
                        autoPlayNext={autoPlayNext}
                        onAutoPlayNextChange={setAutoPlayNext}
                        onVideoClick={(videoId) => navigate(`/video/${videoId}`)}
                        onAddToCollection={handleAddToCollection}
                    />
                </Grid>
            </Grid>

            <CollectionModal
                open={showCollectionModal}
                onClose={handleCloseModal}
                videoCollections={modalVideoCollections}
                collections={collections}
                onAddToCollection={handleAddToExistingCollection}
                onCreateCollection={handleCreateCollection}
                onRemoveFromCollection={handleRemoveFromCollectionWithConfirm}
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

            <SubscribeModal
                open={showSubscribeModal}
                onClose={() => setShowSubscribeModal(false)}
                onConfirm={handleSubscribeConfirm}
                authorName={video?.author}
                url={authorChannelUrl || ''}
            />
        </Container>
    );
};

export default VideoPlayer;
