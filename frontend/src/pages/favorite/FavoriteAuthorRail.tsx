import { Person, WarningAmber } from '@mui/icons-material';
import { Avatar, Box, Card, CardActionArea, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import FavoriteToggle from '../../components/FavoriteToggle';
import { useLanguage } from '../../contexts/LanguageContext';
import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import type { FavoriteAuthorItem } from '../../types';

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
                minWidth: { xs: '100%', md: 128 },
                flex: { xs: '1 1 auto', md: '0 0 128px' },
                bgcolor: 'transparent',
                boxShadow: 'none',
                scrollSnapAlign: 'start',
            }}
        >
            <CardActionArea
                disabled={isUnavailable}
                onClick={() => navigate(`/author/${encodeURIComponent(favorite.author)}`)}
                sx={{
                    p: 1,
                    borderRadius: 2,
                    '&:hover .favorite-author-avatar': {
                        boxShadow: (theme) => `0 0 0 3px ${theme.palette.primary.main}`,
                    },
                }}
            >
                <Avatar
                    className="favorite-author-avatar"
                    src={avatarUrl}
                    alt={favorite.displayName}
                    sx={{ width: 80, height: 80, mx: 'auto', transition: 'box-shadow 0.2s' }}
                >
                    {isUnavailable ? <WarningAmber /> : <Person />}
                </Avatar>
                <Typography
                    variant="body2"
                    align="center"
                    sx={{ mt: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                    {isUnavailable ? t('favoriteUnavailable') : favorite.displayName}
                </Typography>
            </CardActionArea>
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
            <Typography id="favorite-authors-heading" variant="h5" fontWeight={700} sx={{ mb: 2 }}>
                {t('favoriteAuthors')}
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
                    ? [1, 2, 3, 4].map((item) => (
                        <Box key={item} sx={{ minWidth: { xs: '100%', md: 128 }, height: 120, bgcolor: 'action.hover', borderRadius: 2 }} />
                    ))
                    : favorites.map((favorite) => (
                        <FavoriteAuthorCard
                            key={favorite.author}
                            favorite={favorite}
                            onUnfavorite={() => onUnfavorite(favorite)}
                        />
                    ))}
            </Box>
        </Box>
    );
};

export default FavoriteAuthorRail;
