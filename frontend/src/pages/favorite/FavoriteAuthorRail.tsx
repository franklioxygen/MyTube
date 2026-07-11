import { Person, WarningAmber } from '@mui/icons-material';
import { Avatar, Box, Card, CardActionArea, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import { brand } from '../../theme/colors';
import type { FavoriteAuthorItem } from '../../types';
import FavoriteToggle from '../../components/FavoriteToggle';
import FavoriteRailCarousel from './FavoriteRailCarousel';
import FavoriteSectionHeader from './FavoriteSectionHeader';

interface FavoriteAuthorRailProps {
    favorites: FavoriteAuthorItem[];
    loading?: boolean;
    onUnfavorite: (favorite: FavoriteAuthorItem) => void;
}

const FavoriteAuthorCard: React.FC<{
    favorite: FavoriteAuthorItem;
    onUnfavorite: () => void;
}> = ({ favorite, onUnfavorite }) => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const avatarUrl = useCloudStorageUrl(
        favorite.videoCount > 0 ? favorite.avatarPath : undefined,
        'thumbnail',
    );
    const isUnavailable = favorite.videoCount === 0;

    return (
        <Card
            sx={{
                position: 'relative',
                width: { xs: 104, md: 128 },
                flex: { xs: '0 0 104px', md: '0 0 128px' },
                bgcolor: 'transparent',
                boxShadow: 'none',
                border: 'none',
                scrollSnapAlign: 'start',
            }}
        >
            <CardActionArea
                disabled={isUnavailable}
                onClick={() => navigate(`/author/${encodeURIComponent(favorite.author)}`)}
                sx={{
                    p: 1.25,
                    borderRadius: 3,
                    '&:hover .favorite-author-ring': { transform: 'scale(1.06)' },
                    '&:hover .favorite-author-avatar': {
                        boxShadow: (theme) => `0 0 0 3px ${theme.palette.background.paper}`,
                    },
                }}
            >
                {/* Gradient ring frames the avatar for a premium, deliberate look */}
                <Box
                    className="favorite-author-ring"
                    sx={{
                        width: { xs: 76, md: 92 },
                        height: { xs: 76, md: 92 },
                        mx: 'auto',
                        borderRadius: '50%',
                        p: '3px',
                        background: isUnavailable
                            ? 'transparent'
                            : `linear-gradient(135deg, ${brand.primaryDark}, ${brand.secondary})`,
                        transition: 'transform 0.2s ease',
                    }}
                >
                    <Avatar
                        className="favorite-author-avatar"
                        src={avatarUrl}
                        alt={favorite.displayName}
                        sx={{ width: '100%', height: '100%', transition: 'box-shadow 0.2s' }}
                    >
                        {isUnavailable ? <WarningAmber /> : <Person />}
                    </Avatar>
                </Box>
                <Typography
                    variant="body2"
                    align="center"
                    fontWeight={600}
                    sx={{ mt: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                    {isUnavailable ? t('favoriteUnavailable') : favorite.displayName}
                </Typography>
                {!isUnavailable && (
                    <Typography variant="caption" color="text.secondary" align="center" display="block" noWrap>
                        {favorite.videoCount} {t('videos')}
                    </Typography>
                )}
            </CardActionArea>
            {/* Overlay remove control so favorites (including unavailable
                authors whose card is disabled) can be removed from the rail. */}
            <Box sx={{ position: 'absolute', top: 0, right: 0 }}>
                <FavoriteToggle
                    active
                    onToggle={onUnfavorite}
                    label={t('favoriteAuthor')}
                    activeLabel={t('unfavorite')}
                    color="warning"
                />
            </Box>
        </Card>
    );
};

const FavoriteAuthorRail: React.FC<FavoriteAuthorRailProps> = ({ favorites, loading = false, onUnfavorite }) => {
    const { t } = useLanguage();

    if (!loading && favorites.length === 0) return null;

    return (
        <Box component="section" aria-labelledby="favorite-authors-heading" sx={{ mt: 5 }}>
            <FavoriteSectionHeader
                id="favorite-authors-heading"
                title={t('favoriteAuthors')}
                count={favorites.length}
            />
            <FavoriteRailCarousel prevLabel={t('previous')} nextLabel={t('next')}>
                {loading && favorites.length === 0
                    ? [1, 2, 3, 4].map((item) => (
                        <Box key={item} sx={{ flex: { xs: '0 0 104px', md: '0 0 128px' }, height: 120, bgcolor: 'action.hover', borderRadius: 2 }} />
                    ))
                    : favorites.map((favorite) => (
                        <FavoriteAuthorCard
                            key={favorite.author}
                            favorite={favorite}
                            onUnfavorite={() => onUnfavorite(favorite)}
                        />
                    ))}
            </FavoriteRailCarousel>
        </Box>
    );
};

export default FavoriteAuthorRail;
