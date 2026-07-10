import { Star } from '@mui/icons-material';
import { Box, Card, CardActionArea, CardMedia, Chip, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { neutral, overlay } from '../../theme/colors';
import type { Video } from '../../types';
import { formatDuration } from '../../utils/formatUtils';
import FavoriteRailCarousel from './FavoriteRailCarousel';
import FavoriteSectionHeader from './FavoriteSectionHeader';
import { useFavoriteThumbnail } from './useFavoriteThumbnail';

const MiniVideoCard: React.FC<{ video: Video }> = ({ video }) => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const thumbnail = useFavoriteThumbnail(video);

    return (
        <Card
            sx={{
                width: { xs: 200, md: 208 },
                flex: { xs: '0 0 200px', md: '0 0 208px' },
                scrollSnapAlign: 'start',
                border: 'none',
            }}
        >
            <CardActionArea onClick={() => navigate(`/video/${encodeURIComponent(video.id)}`)}>
                <Box sx={{ position: 'relative', aspectRatio: '16 / 9', overflow: 'hidden' }}>
                    <CardMedia
                        component="img"
                        image={thumbnail}
                        alt={video.title}
                        loading="lazy"
                        sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    {video.duration && (
                        <Chip
                            label={formatDuration(video.duration)}
                            size="small"
                            sx={{ position: 'absolute', bottom: 8, right: 8, height: 20, fontSize: '0.72rem', bgcolor: overlay.black70, color: neutral.white }}
                        />
                    )}
                </Box>
                <Box sx={{ p: 1.5 }}>
                    <Typography variant="subtitle2" fontWeight={600} noWrap title={video.title}>
                        {video.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {video.author || t('unknownAuthor')}
                    </Typography>
                    <Box aria-label={`${video.rating ?? 5} ${t('stars')}`} sx={{ display: 'flex', mt: 0.5 }}>
                        {[1, 2, 3, 4, 5].map((star) => <Star key={star} sx={{ fontSize: 15, color: neutral.grey400 }} />)}
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
            <FavoriteSectionHeader
                id="favorite-top-rated-heading"
                title={t('topRated')}
                subtitle={t('topRatedSubtitle')}
                count={videos.length}
            />
            <FavoriteRailCarousel prevLabel={t('previous')} nextLabel={t('next')}>
                {videos.map((video) => <MiniVideoCard key={video.id} video={video} />)}
            </FavoriteRailCarousel>
        </Box>
    );
};

export default FavoriteTopRatedRail;
