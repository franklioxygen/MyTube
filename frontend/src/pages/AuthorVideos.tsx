import { ArrowBack } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Button,
    CircularProgress,
    Container,
    Grid,
    Typography
} from '@mui/material';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import VideoCard from '../components/VideoCard';
import { useLanguage } from '../contexts/LanguageContext';
import { Collection, Video } from '../types';

const API_URL = import.meta.env.VITE_API_URL;

interface AuthorVideosProps {
    videos: Video[];
    onDeleteVideo: (id: string) => Promise<any>;
    collections: Collection[];
}

const AuthorVideos: React.FC<AuthorVideosProps> = ({ videos: allVideos, onDeleteVideo, collections = [] }) => {
    const { t } = useLanguage();
    const { author } = useParams<{ author: string }>();
    const navigate = useNavigate();
    const [authorVideos, setAuthorVideos] = useState<Video[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!author) return;

        // If videos are passed as props, filter them
        if (allVideos && allVideos.length > 0) {
            const filteredVideos = allVideos.filter(
                video => video.author === author
            );
            setAuthorVideos(filteredVideos);
            setLoading(false);
            return;
        }

        // Otherwise fetch from API
        const fetchVideos = async () => {
            try {
                const response = await axios.get(`${API_URL}/videos`);
                // Filter videos by author
                const filteredVideos = response.data.filter(
                    (video: Video) => video.author === author
                );
                setAuthorVideos(filteredVideos);
                setError(null);
            } catch (err) {
                console.error('Error fetching videos:', err);
                setError('Failed to load videos. Please try again later.');
            } finally {
                setLoading(false);
            }
        };

        fetchVideos();
    }, [author, allVideos]);

    const handleBack = () => {
        navigate(-1);
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
                <Typography sx={{ ml: 2 }}>{t('loadingVideos')}</Typography>
            </Box>
        );
    }

    if (error) {
        return (
            <Container sx={{ mt: 4 }}>
                <Alert severity="error">{t('loadVideosError')}</Alert>
            </Container>
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
                        <Typography variant="h4" component="h1" fontWeight="bold">
                            {author ? decodeURIComponent(author) : t('unknownAuthor')}
                        </Typography>
                        <Typography variant="subtitle1" color="text.secondary">
                            {authorVideos.length} {t('videos')}
                        </Typography>
                    </Box>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={<ArrowBack />}
                    onClick={handleBack}
                >
                    {t('back')}
                </Button>
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
                                onDeleteVideo={onDeleteVideo}
                                showDeleteButton={true}
                            />
                        </Grid>
                    ))}
                </Grid>
            )}
        </Container>
    );
};

export default AuthorVideos;
