import { Folder } from '@mui/icons-material';
import {
    Box,
    Card,
    CardActionArea,
    CardContent,
    CardMedia,
    Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import FavoriteToggle from '../../components/FavoriteToggle';
import type { FavoriteCollectionItem, Video } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { useFavoriteThumbnail } from './useFavoriteThumbnail';

interface FavoriteCollectionRailProps {
    favorites: FavoriteCollectionItem[];
    videos: Video[];
    loading?: boolean;
    onUnfavorite: (favorite: FavoriteCollectionItem) => void;
}

const FavoriteCollectionCard: React.FC<{
    favorite: FavoriteCollectionItem;
    video?: Video;
    onUnfavorite: () => void;
}> = ({ favorite, video, onUnfavorite }) => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const thumbnail = useFavoriteThumbnail(video);

    return (
        <Card
            sx={{
                position: 'relative',
                minWidth: { xs: '100%', md: 220 },
                flex: { xs: '1 1 auto', md: '0 0 220px' },
                scrollSnapAlign: 'start',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': { transform: 'translateY(-4px)', boxShadow: 8 },
            }}
        >
            <CardActionArea onClick={() => navigate(`/collection/${encodeURIComponent(favorite.collectionId)}`)}>
                {video ? (
                    <CardMedia
                        component="img"
                        image={thumbnail}
                        alt={favorite.name}
                        height="280"
                        loading="lazy"
                        sx={{ objectFit: 'cover', aspectRatio: '2 / 3' }}
                    />
                ) : (
                    <Box
                        sx={{
                            aspectRatio: '2 / 3',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: 'action.hover',
                        }}
                    >
                        <Folder sx={{ fontSize: 64, color: 'text.disabled' }} />
                    </Box>
                )}
                <CardContent sx={{ pr: 5 }}>
                    <Typography
                        variant="subtitle1"
                        fontWeight={600}
                        sx={{
                            display: '-webkit-box',
                            overflow: 'hidden',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: 2,
                        }}
                    >
                        {favorite.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {favorite.videoCount} {t('videos')}
                    </Typography>
                </CardContent>
            </CardActionArea>
            <Box sx={{ position: 'absolute', top: 8, right: 8 }}>
                <FavoriteToggle
                    active
                    onToggle={onUnfavorite}
                    label={t('favoriteCollection')}
                    activeLabel={t('unfavorite')}
                    color="warning"
                />
            </Box>
        </Card>
    );
};

const FavoriteCollectionRail: React.FC<FavoriteCollectionRailProps> = ({
    favorites,
    videos,
    loading = false,
    onUnfavorite,
}) => {
    const { t } = useLanguage();

    if (!loading && favorites.length === 0) return null;

    return (
        <Box component="section" aria-labelledby="favorite-collections-heading" sx={{ mt: 5 }}>
            <Typography id="favorite-collections-heading" variant="h5" fontWeight={700} sx={{ mb: 2 }}>
                {t('favoriteCollections')}
            </Typography>
            <Box
                sx={{
                    display: 'flex',
                    gap: 2,
                    overflowX: { xs: 'visible', md: 'auto' },
                    flexDirection: { xs: 'column', md: 'row' },
                    pb: 1,
                    scrollSnapType: 'x mandatory',
                }}
            >
                {loading && favorites.length === 0
                    ? [1, 2, 3].map((item) => (
                        <Box key={item} sx={{ minWidth: { xs: '100%', md: 220 }, height: 360, bgcolor: 'action.hover', borderRadius: 2 }} />
                    ))
                    : favorites.map((favorite) => (
                        <FavoriteCollectionCard
                            key={favorite.collectionId}
                            favorite={favorite}
                            video={videos.find((video) => video.id === favorite.thumbnailVideoId)}
                            onUnfavorite={() => onUnfavorite(favorite)}
                        />
                    ))}
            </Box>
        </Box>
    );
};

export default FavoriteCollectionRail;
