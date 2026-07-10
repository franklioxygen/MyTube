import { VideoLibrary } from '@mui/icons-material';
import { Box, Card, CardActionArea, CardMedia, Chip, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import FavoriteToggle from '../../components/FavoriteToggle';
import { useLanguage } from '../../contexts/LanguageContext';
import { neutral, overlay } from '../../theme/colors';
import type { FavoriteCollectionItem, Video } from '../../types';
import FavoriteRailCarousel from './FavoriteRailCarousel';
import FavoriteSectionHeader from './FavoriteSectionHeader';
import { useFavoriteThumbnail } from './useFavoriteThumbnail';

interface FavoriteCollectionRailProps {
    favorites: FavoriteCollectionItem[];
    videos: Video[];
    loading?: boolean;
    onUnfavorite: (favorite: FavoriteCollectionItem) => void;
}

/** Deterministic branded gradient so cover-less collections still look intentional. */
const COVER_GRADIENTS = [
    'linear-gradient(140deg, #00e5ff 0%, #651fff 100%)',
    'linear-gradient(140deg, #FF7eb3 0%, #651fff 100%)',
    'linear-gradient(140deg, #00bfff 0%, #00727d 100%)',
    'linear-gradient(140deg, #f857a6 0%, #ff5858 100%)',
    'linear-gradient(140deg, #7028e4 0%, #00e5ff 100%)',
    'linear-gradient(140deg, #f7971e 0%, #ff3e3e 100%)',
] as const;

const gradientForName = (name: string): string => {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) hash = (hash + name.charCodeAt(i)) % COVER_GRADIENTS.length;
    return COVER_GRADIENTS[hash];
};

const FavoriteCollectionCard: React.FC<{
    favorite: FavoriteCollectionItem;
    video?: Video;
    onUnfavorite: () => void;
}> = ({ favorite, video, onUnfavorite }) => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const thumbnail = useFavoriteThumbnail(video);
    const hasCover = Boolean(video);

    return (
        <Card
            sx={{
                position: 'relative',
                width: { xs: 150, md: 208 },
                flex: { xs: '0 0 150px', md: '0 0 208px' },
                scrollSnapAlign: 'start',
                border: 'none',
            }}
        >
            <CardActionArea onClick={() => navigate(`/collection/${encodeURIComponent(favorite.collectionId)}`)}>
                <Box sx={{ position: 'relative', aspectRatio: '2 / 3', overflow: 'hidden' }}>
                    {hasCover ? (
                        <CardMedia
                            component="img"
                            image={thumbnail}
                            alt={favorite.name}
                            loading="lazy"
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                    ) : (
                        <Box
                            sx={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: gradientForName(favorite.name),
                            }}
                        >
                            <VideoLibrary sx={{ fontSize: 72, color: overlay.white32 }} />
                            <Typography
                                aria-hidden
                                sx={{
                                    position: 'absolute',
                                    fontSize: 88,
                                    fontWeight: 800,
                                    color: overlay.white70,
                                    lineHeight: 1,
                                    userSelect: 'none',
                                }}
                            >
                                {favorite.name.charAt(0).toUpperCase()}
                            </Typography>
                        </Box>
                    )}

                    {/* Bottom scrim so the title is legible over any cover */}
                    <Box
                        aria-hidden
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            background: `linear-gradient(to top, ${overlay.black90} 0%, ${overlay.black45} 34%, transparent 62%)`,
                        }}
                    />

                    {/* Video-count badge */}
                    <Chip
                        icon={<VideoLibrary sx={{ fontSize: 15 }} />}
                        label={favorite.videoCount}
                        size="small"
                        sx={{
                            position: 'absolute',
                            top: 8,
                            left: 8,
                            height: 24,
                            fontWeight: 700,
                            color: neutral.white,
                            bgcolor: overlay.black70,
                            backdropFilter: 'blur(4px)',
                            '& .MuiChip-icon': { color: neutral.white, ml: 0.5 },
                        }}
                    />

                    {/* Title + meta over the scrim */}
                    <Box sx={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
                        <Typography
                            variant="subtitle1"
                            fontWeight={700}
                            sx={{
                                color: neutral.white,
                                lineHeight: 1.25,
                                display: '-webkit-box',
                                overflow: 'hidden',
                                WebkitBoxOrient: 'vertical',
                                WebkitLineClamp: 2,
                                textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                            }}
                        >
                            {favorite.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: overlay.white80 }}>
                            {favorite.videoCount} {t('videos')}
                        </Typography>
                    </Box>
                </Box>
            </CardActionArea>
            <Box sx={{ position: 'absolute', top: 4, right: 4 }}>
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
            <FavoriteSectionHeader
                id="favorite-collections-heading"
                title={t('favoriteCollections')}
                count={favorites.length}
            />
            <FavoriteRailCarousel prevLabel={t('previous')} nextLabel={t('next')}>
                {loading && favorites.length === 0
                    ? [1, 2, 3].map((item) => (
                        <Box key={item} sx={{ flex: { xs: '0 0 150px', md: '0 0 208px' }, aspectRatio: '2 / 3', bgcolor: 'action.hover', borderRadius: 4 }} />
                    ))
                    : favorites.map((favorite) => (
                        <FavoriteCollectionCard
                            key={favorite.collectionId}
                            favorite={favorite}
                            video={videos.find((video) => video.id === favorite.thumbnailVideoId)}
                            onUnfavorite={() => onUnfavorite(favorite)}
                        />
                    ))}
            </FavoriteRailCarousel>
        </Box>
    );
};

export default FavoriteCollectionRail;
