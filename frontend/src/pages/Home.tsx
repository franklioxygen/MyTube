import { ArrowBack, Download, OndemandVideo, YouTube } from '@mui/icons-material';
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
import { Link } from 'react-router-dom';
import AuthorsList from '../components/AuthorsList';
import Collections from '../components/Collections';
import VideoCard from '../components/VideoCard';
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


    // Add default empty array to ensure videos is always an array
    const videoArray = Array.isArray(videos) ? videos : [];

    if (loading && videoArray.length === 0 && !isSearchMode) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
                <Typography sx={{ ml: 2 }}>Loading videos...</Typography>
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

    // Filter videos to only show the first video from each collection
    const filteredVideos = videoArray.filter(video => {
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
                        Search Results for "{searchTerm}"
                    </Typography>
                    {onResetSearch && (
                        <Button
                            variant="outlined"
                            startIcon={<ArrowBack />}
                            onClick={onResetSearch}
                        >
                            Back to Home
                        </Button>
                    )}
                </Box>

                {/* Local Video Results */}
                <Box sx={{ mb: 6 }}>
                    <Typography variant="h5" sx={{ mb: 3, fontWeight: 600, color: 'primary.main' }}>
                        From Your Library
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
                        <Typography color="text.secondary">No matching videos in your library.</Typography>
                    )}
                </Box>

                {/* YouTube Search Results */}
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
                                                    {formatViewCount(result.viewCount)} views
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
                                                Download
                                            </Button>
                                        </CardActions>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                    ) : (
                        <Typography color="text.secondary">No YouTube results found.</Typography>
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
                        No videos yet. Submit a YouTube URL to download your first video!
                    </Typography>
                </Box>
            ) : (
                <Grid container spacing={4}>
                    {/* Sidebar container for Collections and Authors */}
                    <Grid size={{ xs: 12, md: 3 }}>
                        <Box sx={{ position: 'sticky', top: 80 }}>
                            <Collections collections={collections} />
                            <Box sx={{ mt: 2 }}>
                                <AuthorsList videos={videoArray} />
                            </Box>
                            <Box sx={{ mt: 3, textAlign: 'center' }}>
                                <Button
                                    component={Link}
                                    to="/manage"
                                    variant="outlined"
                                    fullWidth
                                >
                                    Manage Videos
                                </Button>
                            </Box>
                        </Box>
                    </Grid>

                    {/* Videos grid */}
                    <Grid size={{ xs: 12, md: 9 }}>
                        <Grid container spacing={3}>
                            {filteredVideos.map(video => (
                                <Grid size={{ xs: 12, sm: 6, lg: 4, xl: 3 }} key={video.id}>
                                    <VideoCard
                                        video={video}
                                        collections={collections}
                                    />
                                </Grid>
                            ))}
                        </Grid>
                    </Grid>
                </Grid>
            )}
        </Container>
    );
};

export default Home;
