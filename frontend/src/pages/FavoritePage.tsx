import { Alert, Box, CircularProgress, Fade, useMediaQuery } from '@mui/material';
import { useMemo } from 'react';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { useFavoriteAuthors } from '../hooks/useFavoriteAuthors';
import { useFavoriteCollections } from '../hooks/useFavoriteCollections';
import type { Video } from '../types';
import FavoriteAuthorRail from './favorite/FavoriteAuthorRail';
import FavoriteCollectionRail from './favorite/FavoriteCollectionRail';
import FavoriteEmptyState from './favorite/FavoriteEmptyState';
import FavoriteHeroCarousel, { type FavoriteHeroItem } from './favorite/FavoriteHeroCarousel';
import FavoriteTopRatedRail from './favorite/FavoriteTopRatedRail';

// How many top-rated videos the Featured hero rotates through.
const FEATURED_LIMIT = 5;

interface FavoritePageProps {
    onBrowseCollections: () => void;
    onFindAuthors: () => void;
}

const getActivityTimestamp = (video: Video): number => {
    const value = video.lastPlayedAt ?? video.addedAt ?? video.createdAt;
    if (typeof value === 'number') return value;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : Date.parse(String(value)) || 0;
};

const FavoritePage: React.FC<FavoritePageProps> = ({ onBrowseCollections, onFindAuthors }) => {
    const { t } = useLanguage();
    const isReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const { videos } = useVideo();
    const { collections } = useCollection();
    const favoriteCollections = useFavoriteCollections();
    const favoriteAuthors = useFavoriteAuthors();

    const topRatedVideos = useMemo(
        () => (Array.isArray(videos) ? videos : [])
            .filter((video) => video.rating === 5)
            .sort((a, b) => getActivityTimestamp(b) - getActivityTimestamp(a)),
        [videos],
    );
    const featuredVideo = topRatedVideos[0];
    const featuredItems = useMemo<FavoriteHeroItem[]>(() => {
        const findCollection = (video: Video) => favoriteCollections.data?.find((favorite) => {
            const collection = collections.find((candidate) => candidate.id === favorite.collectionId);
            return collection?.videos.includes(video.id);
        });
        return topRatedVideos
            .slice(0, FEATURED_LIMIT)
            .map((video) => ({ video, collection: findCollection(video) }));
    }, [collections, favoriteCollections.data, topRatedVideos]);

    const favoriteCollectionItems = favoriteCollections.data ?? [];
    const favoriteAuthorItems = favoriteAuthors.data ?? [];
    const hasContent = Boolean(featuredVideo || favoriteCollectionItems.length || favoriteAuthorItems.length);
    const isLoading = favoriteCollections.isLoading || favoriteAuthors.isLoading;

    if (isLoading && !hasContent) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
                <CircularProgress aria-label="Loading favorites" />
            </Box>
        );
    }

    return (
        <Box sx={{ px: { xs: 2, md: 0 }, pb: 6 }}>
            {(favoriteCollections.error || favoriteAuthors.error) && (
                <Alert severity="warning" sx={{ mb: 3 }}>{t('favoritesLoadFailed')}</Alert>
            )}

            {!hasContent ? (
                <FavoriteEmptyState
                    onBrowseCollections={onBrowseCollections}
                    onFindAuthors={onFindAuthors}
                />
            ) : (
                <>
                    {featuredItems.length > 0 && (
                        <Fade in timeout={isReducedMotion ? 0 : 400}>
                            <Box>
                                <FavoriteHeroCarousel items={featuredItems} />
                            </Box>
                        </Fade>
                    )}
                    <Fade in timeout={isReducedMotion ? 0 : 500}>
                        <Box>
                            <FavoriteCollectionRail
                                favorites={favoriteCollectionItems}
                                videos={videos}
                                loading={favoriteCollections.isLoading}
                            />
                        </Box>
                    </Fade>
                    <Fade in timeout={isReducedMotion ? 0 : 600}>
                        <Box>
                            <FavoriteAuthorRail
                                favorites={favoriteAuthorItems}
                                loading={favoriteAuthors.isLoading}
                            />
                        </Box>
                    </Fade>
                    <Fade in timeout={isReducedMotion ? 0 : 700}>
                        <Box>
                            <FavoriteTopRatedRail videos={topRatedVideos} />
                        </Box>
                    </Fade>
                </>
            )}
        </Box>
    );
};

export default FavoritePage;
