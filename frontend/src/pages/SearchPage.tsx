import { Download, OndemandVideo, YouTube } from '@mui/icons-material';
import {
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
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import VideoCard from '../components/VideoCard';
import { useCollection } from '../contexts/CollectionContext';
import { useDownload } from '../contexts/DownloadContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { formatDuration } from '../utils/formatUtils';

const SearchPage: React.FC = () => {
    const { t } = useLanguage();
    const {
        deleteVideo,
        localSearchResults,
        searchResults,
        youtubeLoading,
        handleSearch,
        searchTerm: contextSearchTerm
    } = useVideo();
    const { collections } = useCollection();
    const { handleVideoSubmit } = useDownload();
    const [searchParams] = useSearchParams();

    const query = searchParams.get('q');

    useEffect(() => {
        if (query && query !== contextSearchTerm) {
            handleSearch(query);
        }
    }, [query, contextSearchTerm, handleSearch]);

    const handleDownload = async (url: string) => {
        try {
            await handleVideoSubmit(url);
        } catch (error) {
            console.error('Error downloading from search:', error);
        }
    };


    // Helper function to format view count
    const formatViewCount = (count?: number) => {
        if (!count) return '0';
        if (count < 1000) return count.toString();
        if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
        return `${(count / 1000000).toFixed(1)}M`;
    };

    const hasLocalResults = localSearchResults && localSearchResults.length > 0;
    const hasYouTubeResults = searchResults && searchResults.length > 0;

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('searchResultsFor')} "{query}"
                </Typography>
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
                                    onDeleteVideo={deleteVideo}
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
                                            onClick={() => handleDownload(result.sourceUrl)}
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
};

export default SearchPage;
