import { CreateNewFolder, Delete } from '@mui/icons-material';
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
    const { collections, createCollection, addToCollection } = useCollection();
    const { showSnackbar } = useSnackbar();
    const navigate = useNavigate();

    const [authorVideos, setAuthorVideos] = useState<Video[]>([]);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isCreateCollectionModalOpen, setIsCreateCollectionModalOpen] = useState(false);
    const [isCreatingCollection, setIsCreatingCollection] = useState(false);

    useEffect(() => {
        if (!author) return;

        const filteredVideos = videos.filter(
            video => video.author === author
        );
        setAuthorVideos(filteredVideos);
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

    const handleOpenCreateCollectionModal = () => {
        if (!author || !authorVideos.length) return;
        setIsCreateCollectionModalOpen(true);
    };

    const handleCreateCollectionFromAuthor = async () => {
        if (!author || !authorVideos.length) return;

        setIsCreatingCollection(true);
        try {
            // Check if collection with this name already exists
            const existingCollection = collections.find(
                col => (col.name || col.title) === author
            );

            let targetCollection;

            if (existingCollection) {
                // Use existing collection
                targetCollection = existingCollection;
            } else {
                // Create new collection with first video (this will create the collection and add the first video)
                const firstVideo = authorVideos[0];
                const newCollection = await createCollection(author, firstVideo.id);

                if (!newCollection) {
                    throw new Error('Failed to create collection');
                }

                targetCollection = newCollection;
            }

            // Get videos that are not already in the target collection
            const videosToAdd = authorVideos.filter(
                video => !targetCollection.videos.includes(video.id)
            );

            // Add videos to the collection
            if (videosToAdd.length > 0) {
                await Promise.all(
                    videosToAdd.map(video =>
                        addToCollection(targetCollection.id, video.id)
                    )
                );
            }

            // Show appropriate success message
            if (existingCollection) {
                showSnackbar(t('videosAddedToCollection'));
            } else {
                showSnackbar(t('collectionCreatedFromAuthor'));
            }
            setIsCreateCollectionModalOpen(false);
        } catch (error) {
            console.error('Error creating collection from author:', error);
            showSnackbar(t('failedToCreateCollectionFromAuthor'), 'error');
        } finally {
            setIsCreatingCollection(false);
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    // Show all videos for the author (no collection filtering)
    const filteredVideos = authorVideos;

    // Build confirmation message
    const getCreateCollectionMessage = (): string => {
        // Check if collection with this name already exists
        const existingCollection = collections.find(
            col => (col.name || col.title) === author
        );

        // Check which videos are already in other collections (not the target collection)
        const videosInOtherCollections = authorVideos.filter(video => {
            if (existingCollection && existingCollection.videos.includes(video.id)) {
                return false; // Already in target collection, skip
            }
            return collections.some(collection => collection.videos.includes(video.id));
        });

        // Check which videos are not in the target collection
        const videosNotInTarget = existingCollection
            ? authorVideos.filter(video => !existingCollection.videos.includes(video.id))
            : authorVideos;

        if (existingCollection) {
            // Using existing collection
            if (videosInOtherCollections.length > 0) {
                return t('addVideosToExistingCollectionConfirmationWithMove' as any, {
                    author: author || '',
                    count: videosNotInTarget.length,
                    moveCount: videosInOtherCollections.length
                });
            }
            return t('addVideosToExistingCollectionConfirmation' as any, {
                author: author || '',
                count: videosNotInTarget.length
            });
        } else {
            // Creating new collection
            if (videosInOtherCollections.length > 0) {
                return t('createCollectionFromAuthorConfirmationWithMove' as any, {
                    author: author || '',
                    count: videosInOtherCollections.length
                });
            }
            return t('createCollectionFromAuthorConfirmation' as any, { author: author || '' });
        }
    };

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
                                <>
                                    <Tooltip title={t('createCollectionFromAuthorTooltip')}>
                                        <IconButton
                                            color="primary"
                                            onClick={handleOpenCreateCollectionModal}
                                            disabled={isCreatingCollection || isDeleting}
                                            aria-label="create collection from author"
                                        >
                                            <CreateNewFolder />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title={t('deleteAuthor')}>
                                        <IconButton
                                            color="error"
                                            onClick={() => {
                                                setIsDeleteModalOpen(true);
                                            }}
                                            disabled={isCreatingCollection || isDeleting}
                                            aria-label="delete author"
                                        >
                                            <Delete />
                                        </IconButton>
                                    </Tooltip>
                                </>
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
                                onDeleteVideo={deleteVideo}
                                showDeleteButton={true}
                            />
                        </Grid>
                    ))}
                </Grid>
            )}

            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => {
                    setIsDeleteModalOpen(false);
                }}
                onConfirm={handleDeleteAuthor}
                title={t('deleteAuthor')}
                message={t('deleteAuthorConfirmation', { author: author || '' })}
                confirmText={isDeleting ? t('deleting') : t('delete')}
                cancelText={t('cancel')}
                isDanger={true}
            />

            <ConfirmationModal
                isOpen={isCreateCollectionModalOpen}
                onClose={() => {
                    setIsCreateCollectionModalOpen(false);
                }}
                onConfirm={handleCreateCollectionFromAuthor}
                title={(() => {
                    const existingCollection = collections.find(
                        col => (col.name || col.title) === author
                    );
                    return existingCollection
                        ? t('addVideosToCollection' as any)
                        : t('createCollectionFromAuthor');
                })()}
                message={getCreateCollectionMessage()}
                confirmText={isCreatingCollection ? t('creatingCollection') : t('create')}
                cancelText={t('cancel')}
                isDanger={false}
            />
        </Container>
    );
};

export default AuthorVideos;
