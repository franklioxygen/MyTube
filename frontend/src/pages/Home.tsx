import { ArrowBack, Collections as CollectionsIcon, Download, GridView, OndemandVideo, YouTube } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    Card,
    CardActions,
    CardContent,
    CardMedia,
    Chip,
    CircularProgress,
    Container,
    Grid,
    Pagination,
    ToggleButton,
    ToggleButtonGroup,
    Typography
} from '@mui/material';
import { useEffect, useState } from 'react';
import AuthorsList from '../components/AuthorsList';
import CollectionCard from '../components/CollectionCard';
import Collections from '../components/Collections';
import TagsList from '../components/TagsList';
import VideoCard from '../components/VideoCard';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { Collection, Video } from '../types';

interface SearchResult {
    id: string;
    title: string;
    author: string;
    thumbnailUrl: string;
    duration?: number;
    viewCount?: number;
    source: 'youtube' | 'bilibili';
    sourceUrl: string;
}

interface HomeProps {
    videos: Video[];
    loading: boolean;
    error: string | null;
    onDeleteVideo: (id: string) => Promise<any>;
    collections: Collection[];
    isSearchMode: boolean;
    searchTerm: string;
    localSearchResults: Video[];
    youtubeLoading: boolean;
    searchResults: SearchResult[];
    onDownload: (url: string, title?: string) => void;
    onResetSearch: () => void;
}

const Home: React.FC<HomeProps> = ({
    videos = [],
    loading,
    error,
    onDeleteVideo,
    collections = [],
    isSearchMode = false,
    searchTerm = '',
    localSearchResults = [],
    youtubeLoading = false,
    searchResults = [],
    onDownload,
    onResetSearch
}) => {
    const API_URL = import.meta.env.VITE_API_URL;
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 12;
    const { t } = useLanguage();
    const { availableTags, selectedTags, handleTagToggle } = useVideo();
    const [viewMode, setViewMode] = useState<'collections' | 'all-videos'>(() => {
        const saved = localStorage.getItem('homeViewMode');
        return (saved as 'collections' | 'all-videos') || 'collections';
    });

    // Reset page when filters change
    useEffect(() => {
        setPage(1);
    }, [videos, collections, selectedTags]);


    // Add default empty array to ensure videos is always an array
    const videoArray = Array.isArray(videos) ? videos : [];

    if (loading && videoArray.length === 0 && !isSearchMode) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
                <Typography sx={{ ml: 2 }}>{t('loadingVideos')}</Typography>
            </Box>
        );
    }

    if (error && videoArray.length === 0 && !isSearchMode) {
        return (
            <Container sx={{ mt: 4 }}>
                <Alert severity="error">{error}</Alert>
            </Container>
        );
    }

    // Filter videos based on view mode
    const filteredVideos = viewMode === 'all-videos'
        ? videoArray.filter(video => {
            // In all-videos mode, only apply tag filtering
            if (selectedTags.length > 0) {
                const videoTags = video.tags || [];
                return selectedTags.every(tag => videoTags.includes(tag));
            }
            return true;
        })
        : videoArray.filter(video => {
            // In collections mode, show only first video from each collection
            // Tag filtering
            if (selectedTags.length > 0) {
                const videoTags = video.tags || [];
                const hasMatchingTag = selectedTags.every(tag => videoTags.includes(tag));
                if (!hasMatchingTag) return false;
            }

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



    const handleViewModeChange = (mode: 'collections' | 'all-videos') => {
        setViewMode(mode);
        localStorage.setItem('homeViewMode', mode);
        setPage(1); // Reset pagination
    };

    // Pagination logic
    const totalPages = Math.ceil(filteredVideos.length / ITEMS_PER_PAGE);
    const displayedVideos = filteredVideos.slice(
        (page - 1) * ITEMS_PER_PAGE,
        page * ITEMS_PER_PAGE
    );

    const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
        setPage(value);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };



    // Helper function to format duration in seconds to MM:SS
    const formatDuration = (seconds?: number) => {
        if (!seconds) return '';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    // Helper function to format view count
    const formatViewCount = (count?: number) => {
        if (!count) return '0';
        if (count < 1000) return count.toString();
        if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
        return `${(count / 1000000).toFixed(1)}M`;
    };

    // If in search mode, show search results
    if (isSearchMode) {
        const hasLocalResults = localSearchResults && localSearchResults.length > 0;
        const hasYouTubeResults = searchResults && searchResults.length > 0;

        return (
            <Container maxWidth="xl" sx={{ py: 4 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                    <Typography variant="h4" component="h1" fontWeight="bold">
                        {t('searchResultsFor')} "{searchTerm}"
                    </Typography>
                    {onResetSearch && (
                        <Button
                            variant="outlined"
                            startIcon={<ArrowBack />}
                            onClick={onResetSearch}
                        >
                            {t('backToHome')}
                        </Button>
                    )}
                </Box>

                {/* Local Video Results */}
                <Box sx={{ mb: 6 }}>
                    <Typography variant="h5" sx={{ mb: 3, fontWeight: 600, color: 'primary.main' }}>
                        {t('fromYourLibrary')}
                    </Typography>
                    {hasLocalResults ? (
                        <Grid container spacing={3}>
                            {localSearchResults.map((video) => (
                                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={video.id}>
                                    <VideoCard
                                        video={video}
                                        collections={collections}
                                        onDeleteVideo={onDeleteVideo}
                                        showDeleteButton={true}
                                    />
                                </Grid>
                            ))}
                        </Grid>
                    ) : (
                        <Typography color="text.secondary">{t('noMatchingVideos')}</Typography>
                    )}
                </Box>

                {/* YouTube Search Results */}
                <Box>
                    <Typography variant="h5" sx={{ mb: 3, fontWeight: 600, color: '#ff0000' }}>
                        {t('fromYouTube')}
                    </Typography>

                    {youtubeLoading ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
                            <CircularProgress color="error" />
                            <Typography sx={{ mt: 2 }}>{t('loadingYouTubeResults')}</Typography>
                        </Box>
                    ) : hasYouTubeResults ? (
                        <Grid container spacing={3}>
                            {searchResults.map((result) => (
                                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={result.id}>
                                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                        <Box sx={{ position: 'relative', paddingTop: '56.25%' }}>
                                            <CardMedia
                                                component="img"
                                                image={result.thumbnailUrl || 'https://via.placeholder.com/480x360?text=No+Thumbnail'}
                                                alt={result.title}
                                                sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                                                onError={(e) => {
                                                    const target = e.target as HTMLImageElement;
                                                    target.onerror = null;
                                                    target.src = 'https://via.placeholder.com/480x360?text=No+Thumbnail';
                                                }}
                                            />
                                            {result.duration && (
                                                <Chip
                                                    label={formatDuration(result.duration)}
                                                    size="small"
                                                    sx={{ position: 'absolute', bottom: 8, right: 8, bgcolor: 'rgba(0,0,0,0.8)', color: 'white' }}
                                                />
                                            )}
                                            <Box sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'rgba(0,0,0,0.7)', borderRadius: '50%', p: 0.5, display: 'flex' }}>
                                                {result.source === 'bilibili' ? <OndemandVideo sx={{ color: '#23ade5' }} /> : <YouTube sx={{ color: '#ff0000' }} />}
                                            </Box>
                                        </Box>
                                        <CardContent sx={{ flexGrow: 1, p: 2 }}>
                                            <Typography gutterBottom variant="subtitle1" component="div" sx={{ fontWeight: 600, lineHeight: 1.2, mb: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                                {result.title}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                                {result.author}
                                            </Typography>
                                            {result.viewCount && (
                                                <Typography variant="caption" color="text.secondary">
                                                    {formatViewCount(result.viewCount)} {t('views')}
                                                </Typography>
                                            )}
                                        </CardContent>
                                        <CardActions sx={{ p: 2, pt: 0 }}>
                                            <Button
                                                fullWidth
                                                variant="contained"
                                                startIcon={<Download />}
                                                onClick={() => onDownload(result.sourceUrl, result.title)}
                                            >
                                                {t('download')}
                                            </Button>
                                        </CardActions>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                    ) : (
                        <Typography color="text.secondary">{t('noYouTubeResults')}</Typography>
                    )}
                </Box>
            </Container>
        );
    }

    // Regular home view (not in search mode)
    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            {videoArray.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 8 }}>
                    <Typography variant="h5" color="text.secondary">
                        {t('noVideosYet')}
                    </Typography>
                </Box>
            ) : (
                <Grid container spacing={4}>
                    {/* Sidebar container for Collections, Authors, and Tags */}
                    <Grid size={{ xs: 12, md: 3 }} sx={{ display: { xs: 'none', md: 'block' } }}>
                        <Box sx={{ position: 'sticky', top: 80 }}>
                            <Collections collections={collections} />
                            <Box sx={{ mt: 2 }}>
                                <TagsList
                                    availableTags={availableTags}
                                    selectedTags={selectedTags}
                                    onTagToggle={handleTagToggle}
                                />
                            </Box>
                            <Box sx={{ mt: 2 }}>
                                <AuthorsList videos={videoArray} />
                            </Box>
                        </Box>
                    </Grid>

                    {/* Videos grid */}
                    <Grid size={{ xs: 12, md: 9 }}>
                        {/* View mode toggle */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                            <Typography variant="h5" fontWeight="bold">
                                {t('videos')}
                            </Typography>
                            <ToggleButtonGroup
                                value={viewMode}
                                exclusive
                                onChange={(_, newMode) => newMode && handleViewModeChange(newMode)}
                                size="small"
                            >
                                <ToggleButton value="collections">
                                    <CollectionsIcon fontSize="small" sx={{ mr: 1 }} />
                                    {t('collections')}
                                </ToggleButton>
                                <ToggleButton value="all-videos">
                                    <GridView fontSize="small" sx={{ mr: 1 }} />
                                    {t('allVideos')}
                                </ToggleButton>
                            </ToggleButtonGroup>
                        </Box>
                        <Grid container spacing={3}>
                            {displayedVideos.map(video => {
                                // In all-videos mode, ALWAYS render as VideoCard
                                if (viewMode === 'all-videos') {
                                    return (
                                        <Grid size={{ xs: 12, sm: 6, lg: 4, xl: 3 }} key={video.id}>
                                            <VideoCard
                                                video={video}
                                                collections={collections}
                                                disableCollectionGrouping={true}
                                            />
                                        </Grid>
                                    );
                                }

                                // In collections mode, check if this video is the first in a collection
                                const collection = collections.find(c => c.videos[0] === video.id);

                                // If it is, render CollectionCard
                                if (collection) {
                                    return (
                                        <Grid size={{ xs: 12, sm: 6, lg: 4, xl: 3 }} key={`collection-${collection.id}`}>
                                            <CollectionCard
                                                collection={collection}
                                                videos={videoArray}
                                            />
                                        </Grid>
                                    );
                                }

                                // Otherwise render VideoCard for non-collection videos
                                return (
                                    <Grid size={{ xs: 12, sm: 6, lg: 4, xl: 3 }} key={video.id}>
                                        <VideoCard
                                            video={video}
                                            collections={collections}
                                        />
                                    </Grid>
                                );
                            })}
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
                    </Grid>
                </Grid>
            )}
        </Container>
    );
};

export default Home;
