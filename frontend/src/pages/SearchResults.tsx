import { Download, OndemandVideo, YouTube } from '@mui/icons-material';
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
    Typography
} from '@mui/material';
import React, { useEffect } from 'react';
import VideoCard from '../components/VideoCard';
import { useCollection } from '../contexts/CollectionContext';
import { useDownload } from '../contexts/DownloadContext';
import { useVideo } from '../contexts/VideoContext';
import { formatDuration } from '../utils/formatUtils';

const SearchResults: React.FC = () => {
    const {
        searchResults,
        localSearchResults,
        searchTerm,
        loading,
        youtubeLoading,
        deleteVideo,
        resetSearch,
        setIsSearchMode,
        showYoutubeSearch
    } = useVideo();
    const { collections } = useCollection();
    const { handleVideoSubmit } = useDownload();

    // If search term is empty, reset search and go back to home
    useEffect(() => {
        if (!searchTerm || searchTerm.trim() === '') {
            if (resetSearch) {
                resetSearch();
            }
        }
    }, [searchTerm, resetSearch]);

    const handleDownload = async (videoUrl: string) => {
        try {
            // We need to stop the search mode before downloading?
            // Actually App.tsx implementation was:
            // setIsSearchMode(false);
            // await handleVideoSubmit(videoUrl);
            // Let's replicate that behavior if we want to exit search on download
            // Or maybe just download and stay on search results?
            // The original implementation in App.tsx exited search mode.
            setIsSearchMode(false);
            await handleVideoSubmit(videoUrl);
        } catch (error) {
            console.error('Error downloading from search results:', error);
        }
    };

    // If search term is empty, don't render search results
    if (!searchTerm || searchTerm.trim() === '') {
        return null;
    }

    // If the entire page is loading
    if (loading) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
                <Typography variant="h5" gutterBottom>Searching for "{searchTerm}"...</Typography>
                <CircularProgress />
            </Box>
        );
    }

    const hasLocalResults = localSearchResults && localSearchResults.length > 0;
    const hasYouTubeResults = showYoutubeSearch && searchResults && searchResults.length > 0;
    const noResults = !hasLocalResults && !hasYouTubeResults && (!showYoutubeSearch || !youtubeLoading);

    // Helper function to format view count
    const formatViewCount = (count?: number) => {
        if (!count) return '0';
        if (count < 1000) return count.toString();
        if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
        return `${(count / 1000000).toFixed(1)}M`;
    };

    if (noResults) {
        return (
            <Container maxWidth="xl" sx={{ py: 4 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                    <Typography variant="h4" component="h1" fontWeight="bold">
                        Search Results for "{searchTerm}"
                    </Typography>
                </Box>
                <Alert severity="info" variant="outlined">No results found. Try a different search term.</Alert>
            </Container>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    Search Results for "{searchTerm}"
                </Typography>
            </Box>

            {/* Local Video Results */}
            <Box sx={{ mb: 6 }}>
                <Typography variant="h5" sx={{ mb: 3, fontWeight: 600, color: 'primary.main' }}>
                    From Your Library
                </Typography>
                {hasLocalResults ? (
                    <Grid container spacing={3}>
                        {localSearchResults.map((video) => <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={video.id}>
                            <VideoCard
                                video={video}
                                collections={collections}
                                onDeleteVideo={deleteVideo}
                                showDeleteButton={true}
                            />
                        </Grid>
                        )}
                    </Grid>
                ) : (
                    <Typography color="text.secondary">No matching videos in your library.</Typography>
                )}
            </Box>

            {/* YouTube Search Results */}
            {showYoutubeSearch && (
                <Box>
                    <Typography variant="h5" sx={{ mb: 3, fontWeight: 600, color: '#ff0000' }}>
                        From YouTube
                    </Typography>

                    {youtubeLoading ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
                            <CircularProgress color="error" />
                            <Typography sx={{ mt: 2 }}>Loading YouTube results...</Typography>
                        </Box>
                    ) : hasYouTubeResults ? (
                        <Grid container spacing={3}>
                            {searchResults.map((result) => <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={result.id}>
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
                                                {formatViewCount(result.viewCount)} views
                                            </Typography>
                                        )}
                                    </CardContent>
                                    <CardActions sx={{ p: 2, pt: 0 }}>
                                        <Button
                                            fullWidth
                                            variant="contained"
                                            startIcon={<Download />}
                                            onClick={() => handleDownload(result.sourceUrl)}
                                        >
                                            Download
                                        </Button>
                                    </CardActions>
                                </Card>
                            </Grid>
                            )}
                        </Grid>
                    ) : (
                        <Typography color="text.secondary">No YouTube results found.</Typography>
                    )}
                </Box>
            )}
        </Container>
    );
};

export default SearchResults;
