import { Star } from '@mui/icons-material';
import { Box, Card, CardActionArea, CardMedia, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import type { Video } from '../../types';
import { useFavoriteThumbnail } from './useFavoriteThumbnail';

const MiniVideoCard: React.FC<{ video: Video }> = ({ video }) => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const thumbnail = useFavoriteThumbnail(video);

    return (
        <Card sx={{ minWidth: 160, flex: '0 0 160px', scrollSnapAlign: 'start' }}>
            <CardActionArea onClick={() => navigate(`/video/${encodeURIComponent(video.id)}`)}>
                <CardMedia component="img" image={thumbnail} alt={video.title} height="96" loading="lazy" sx={{ objectFit: 'cover' }} />
                <Box sx={{ p: 1.25 }}>
                    <Typography variant="subtitle2" fontWeight={600} noWrap title={video.title}>
                        {video.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {video.author || t('unknownAuthor')}
                    </Typography>
                    <Box aria-label={`${video.rating ?? 5} ${t('stars')}`} sx={{ display: 'flex', mt: 0.5 }}>
                        {[1, 2, 3, 4, 5].map((star) => <Star key={star} sx={{ fontSize: 15 }} color="warning" />)}
                    </Box>
                </Box>
            </CardActionArea>
        </Card>
    );
};

const FavoriteTopRatedRail: React.FC<{ videos: Video[] }> = ({ videos }) => {
    const { t } = useLanguage();
    if (videos.length === 0) return null;

    return (
        <Box component="section" aria-labelledby="favorite-top-rated-heading" sx={{ mt: 5 }}>
            <Typography id="favorite-top-rated-heading" variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
                {t('topRated')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('topRatedSubtitle')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, overflowX: { xs: 'visible', md: 'auto' }, flexDirection: { xs: 'column', md: 'row' }, pb: 1, scrollSnapType: 'x mandatory' }}>
                {videos.map((video) => <MiniVideoCard key={video.id} video={video} />)}
            </Box>
        </Box>
    );
};

export default FavoriteTopRatedRail;
