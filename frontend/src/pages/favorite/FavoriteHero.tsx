import { PlayArrow, Star } from '@mui/icons-material';
import { Box, Button, Card, CardMedia, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import type { FavoriteCollectionItem, Video } from '../../types';
import { formatDuration } from '../../utils/formatUtils';
import { useFavoriteThumbnail } from './useFavoriteThumbnail';

interface FavoriteHeroProps {
    video: Video;
    collection?: FavoriteCollectionItem;
}

const FavoriteHero: React.FC<FavoriteHeroProps> = ({ video, collection }) => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const theme = useTheme();
    const isReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const thumbnail = useFavoriteThumbnail(video);

    return (
        <Box component="section" aria-labelledby="favorite-featured-heading">
            <Typography id="favorite-featured-heading" variant="h5" fontWeight={700} sx={{ mb: 2 }}>
                {t('featured')}
            </Typography>
            <Card
                sx={{
                    position: 'relative',
                    minHeight: { xs: 420, md: 340 },
                    overflow: 'hidden',
                    bgcolor: theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                    transition: isReducedMotion ? 'none' : 'transform 0.3s ease',
                    '&:hover': isReducedMotion ? undefined : { transform: 'translateY(-2px)' },
                }}
            >
                <Box
                    sx={{
                        position: 'absolute',
                        inset: -24,
                        backgroundImage: `url(${thumbnail})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        filter: 'blur(20px)',
                        opacity: 0.45,
                        transform: 'scale(1.08)',
                    }}
                />
                <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.52) 48%, rgba(0,0,0,0.08) 100%)' }} />
                <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: { xs: 2, md: 4 }, minHeight: 'inherit', p: { xs: 2, md: 4 }, flexDirection: { xs: 'column', md: 'row' } }}>
                    <CardMedia
                        component="img"
                        image={thumbnail}
                        alt={video.title}
                        sx={{ width: { xs: '100%', md: '46%' }, aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 2, boxShadow: 8 }}
                    />
                    <Box sx={{ color: 'common.white', maxWidth: 620 }}>
                        <Typography variant="overline" sx={{ letterSpacing: 2, opacity: 0.8 }}>
                            {t('topRated')}
                        </Typography>
                        <Typography variant="h4" component="h2" fontWeight={800} sx={{ mt: 0.5 }}>
                            {video.title}
                        </Typography>
                        <Typography sx={{ mt: 1, opacity: 0.9 }}>
                            {video.author || t('unknownAuthor')}
                            {video.duration ? ` · ${formatDuration(video.duration)}` : ''}
                        </Typography>
                        <Box sx={{ display: 'flex', mt: 1 }} aria-label={`5 ${t('stars')}`}>
                            {[1, 2, 3, 4, 5].map((star) => <Star key={star} color="warning" sx={{ fontSize: 20 }} />)}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 3, flexWrap: 'wrap' }}>
                            <Button variant="contained" color="primary" startIcon={<PlayArrow />} onClick={() => navigate(`/video/${encodeURIComponent(video.id)}`)}>
                                {t('play')}
                            </Button>
                            {collection && (
                                <Button variant="outlined" sx={{ color: 'common.white', borderColor: 'rgba(255,255,255,0.65)' }} onClick={() => navigate(`/collection/${encodeURIComponent(collection.collectionId)}`)}>
                                    {t('openCollection')}
                                </Button>
                            )}
                        </Box>
                    </Box>
                </Box>
            </Card>
        </Box>
    );
};

export default FavoriteHero;
