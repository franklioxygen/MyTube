import { CreateNewFolder, Delete, LocalOffer, ViewSidebar } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Button,
    CircularProgress,
    Container,
    Grid,
    IconButton,
    Tooltip,
    Typography
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ConfirmationModal from '../components/ConfirmationModal';
import SortControl from '../components/SortControl';
import TagsModal from '../components/TagsModal';
import { TagsSidebar } from '../components/TagsSidebar';
import VideoCard from '../components/VideoCard';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageTagFilter } from '../contexts/PageTagFilterContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useVideo } from '../contexts/VideoContext';
import { useCloudStorageUrl } from '../hooks/useCloudStorageUrl';
import { useSettings } from '../hooks/useSettings';
import { useVideoSort } from '../hooks/useVideoSort';
import { Video } from '../types';


const AuthorVideos: React.FC = () => {
    const { t } = useLanguage();
    const { authorName } = useParams<{ authorName: string }>();
    const authorParam = authorName;
    const { videos, loading, deleteVideo, availableTags: globalAvailableTags, updateVideo } = useVideo();
    const { collections, createCollection, addToCollection } = useCollection();
    const { showSnackbar } = useSnackbar();
    const { setPageTagFilter } = usePageTagFilter();
    const navigate = useNavigate();
    const { data: settings } = useSettings();

    const [authorVideos, setAuthorVideos] = useState<Video[]>([]);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isCreateCollectionModalOpen, setIsCreateCollectionModalOpen] = useState(false);
    const [isCreatingCollection, setIsCreatingCollection] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);

    const authorDisplayName = authorVideos[0]?.author ?? authorParam ?? '';
    const showTagsOnThumbnail = settings?.showTagsOnThumbnail ?? false;

    useEffect(() => {
        if (!authorParam) return;

        const filteredVideos = videos.filter(
            video => video.author === authorParam
        );
        setAuthorVideos(filteredVideos);
    }, [authorParam, videos]);

    const availableTags = useMemo(
        () => Array.from(new Set(authorVideos.flatMap(v => v.tags || []))).sort(),
        [authorVideos]
    );

    const commonTags = useMemo(() => {
        if (authorVideos.length === 0) return [];
        // Start with tags from first video
        let intersection = new Set(authorVideos[0].tags || []);
        // Intersect with rest
        for (let i = 1; i < authorVideos.length; i++) {
            const vTags = new Set(authorVideos[i].tags || []);
            intersection = new Set([...intersection].filter(x => vTags.has(x)));
        }
        return Array.from(intersection).sort();
    }, [authorVideos]);

    const [filterVersion, setFilterVersion] = useState(0);

    const handleTagToggle = useCallback((tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
        );
        setFilterVersion(v => v + 1);
    }, []);

    const videosFilteredByTags = useMemo(() => {
        if (selectedTags.length === 0) return authorVideos;
        return authorVideos.filter(video =>
            selectedTags.every(tag => (video.tags || []).includes(tag))
        );
    }, [authorVideos, selectedTags]);

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

    // Get avatar path from first video that has an avatar
    const authorAvatarPath = authorVideos.find(video => video.authorAvatarPath)?.authorAvatarPath;
    const avatarUrl = useCloudStorageUrl(authorAvatarPath, 'thumbnail');

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
        if (!authorDisplayName || !authorVideos.length) return;
        setIsCreateCollectionModalOpen(true);
    };

    const handleSaveAuthorTags = async (newCommonTags: string[]) => {
        if (authorVideos.length === 0) return;

        try {
            // Find tags to add (in new but not in old common)
            const tagsToAdd = newCommonTags.filter(tag => !commonTags.includes(tag));

            // Find tags to remove (in old common but not in new)
            const tagsToRemove = commonTags.filter(tag => !newCommonTags.includes(tag));

            if (tagsToAdd.length === 0 && tagsToRemove.length === 0) {
                setIsTagsModalOpen(false);
                return;
            }

            // Apply changes to all videos by this author
            await Promise.all(
                authorVideos.map(async video => {
                    let currentTags = video.tags || [];

                    // Add new tags
                    if (tagsToAdd.length > 0) {
                        currentTags = Array.from(new Set([...currentTags, ...tagsToAdd]));
                    }

                    // Remove tags
                    if (tagsToRemove.length > 0) {
                        currentTags = currentTags.filter(tag => !tagsToRemove.includes(tag));
                    }

                    if (JSON.stringify(video.tags) !== JSON.stringify(currentTags)) {
                        await updateVideo(video.id, { tags: currentTags });
                    }
                })
            );
            showSnackbar(t('videoUpdated'));
            setIsTagsModalOpen(false);
        } catch (error) {
            console.error('Error updating tags:', error);
            showSnackbar(t('error'), 'error');
        }
    };

    const handleCreateCollectionFromAuthor = async () => {
        if (!authorDisplayName || !authorVideos.length) return;

        setIsCreatingCollection(true);
        try {
            // Check if collection with this name already exists
            const existingCollection = collections.find(
                col => (col.name || col.title) === authorDisplayName
            );

            let targetCollection;

            if (existingCollection) {
                // Use existing collection
                targetCollection = existingCollection;
            } else {
                // Create new collection with first video (this will create the collection and add the first video)
                const firstVideo = authorVideos[0];
                const newCollection = await createCollection(authorDisplayName, firstVideo.id);

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

    // Sort videos (after tag filter)
    const {
        sortedVideos,
        sortOption,
        sortAnchorEl,
        handleSortClick,
        handleSortClose
    } = useVideoSort({
        videos: videosFilteredByTags,
        defaultSort: 'dateDesc'
    });

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    // Build confirmation message
    const getCreateCollectionMessage = (): string => {
        const existingCollection = collections.find(
            col => (col.name || col.title) === authorDisplayName
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
                    author: authorDisplayName || '',
                    count: videosNotInTarget.length,
                    moveCount: videosInOtherCollections.length
                });
            }
            return t('addVideosToExistingCollectionConfirmation' as any, {
                author: authorDisplayName || '',
                count: videosNotInTarget.length
            });
        } else {
            // Creating new collection
            if (videosInOtherCollections.length > 0) {
                return t('createCollectionFromAuthorConfirmationWithMove' as any, {
                    author: authorDisplayName || '',
                    count: videosInOtherCollections.length
                });
            }
            return t('createCollectionFromAuthorConfirmation' as any, { author: authorDisplayName || '' });
        }
    };

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
                            <Avatar
                                src={avatarUrl || undefined}
                                sx={{ width: 56, height: 56, bgcolor: 'primary.main', mr: 2, fontSize: '1.5rem' }}
                            >
                                {authorDisplayName ? authorDisplayName.charAt(0).toUpperCase() : 'A'}
                            </Avatar>
                            <Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Typography variant="h4" component="h1" fontWeight="bold">
                                        {authorDisplayName || t('unknownAuthor')}
                                    </Typography>
                                    <Tooltip title={t('addTags')}>
                                        <IconButton
                                            color="primary"
                                            onClick={() => setIsTagsModalOpen(true)}
                                            disabled={isCreatingCollection || isDeleting}
                                            aria-label="add tags to author"
                                        >
                                            <LocalOffer />
                                        </IconButton>
                                    </Tooltip>
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
                                                    onClick={() => setIsDeleteModalOpen(true)}
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
                                    {authorVideos.length === 0
                                        ? `0 ${t('videos')}`
                                        : selectedTags.length > 0
                                            ? `${sortedVideos.length} / ${authorVideos.length} ${t('videos')}`
                                            : `${authorVideos.length} ${t('videos')}`}
                                </Typography>
                            </Box>
                        </Box>

                        {authorVideos.length > 0 && (
                            <SortControl
                                sortOption={sortOption}
                                sortAnchorEl={sortAnchorEl}
                                onSortClick={handleSortClick}
                                onSortClose={handleSortClose}
                                sx={{ height: 38 }}
                            />
                        )}
                    </Box>

                    {authorVideos.length === 0 ? (
                        <Alert severity="info" variant="outlined">{t('noVideosForAuthor')}</Alert>
                    ) : sortedVideos.length === 0 ? (
                        <Alert severity="info" variant="outlined">
                            {t('noVideosFoundMatching')}
                        </Alert>
                    ) : (
                        <Grid container spacing={3}>
                            {sortedVideos.map(video => (
                                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={video.id}>
                                    <VideoCard
                                        video={video}
                                        onDeleteVideo={deleteVideo}
                                        showDeleteButton={true}
                                        showTagsOnThumbnail={showTagsOnThumbnail}
                                    />
                                </Grid>
                            ))}
                        </Grid>
                    )}
                </Box>
            </Box>

            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => {
                    setIsDeleteModalOpen(false);
                }}
                onConfirm={handleDeleteAuthor}
                title={t('deleteAuthor')}
                message={t('deleteAuthorConfirmation', { author: authorDisplayName || '' })}
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
                        col => (col.name || col.title) === authorDisplayName
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

            <TagsModal
                open={isTagsModalOpen}
                onClose={() => setIsTagsModalOpen(false)}
                videoTags={commonTags}
                availableTags={globalAvailableTags ?? []}
                onSave={handleSaveAuthorTags}
            />
        </Container>
    );
};

export default AuthorVideos;
