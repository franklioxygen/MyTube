import { Alert, Box, CircularProgress, Fade, useMediaQuery } from '@mui/material';
import { useMemo } from 'react';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { useFavoriteAuthors } from '../hooks/useFavoriteAuthors';
import { useFavoriteCollections } from '../hooks/useFavoriteCollections';
import type { Video } from '../types';
import { parseDuration } from '../utils/formatUtils';
import { getBestVideoResumeProgress, readVideoResumeProgress } from '../utils/videoResumeProgress';
import FavoriteAuthorRail from './favorite/FavoriteAuthorRail';
import FavoriteCollectionRail from './favorite/FavoriteCollectionRail';
import FavoriteEmptyState from './favorite/FavoriteEmptyState';
import FavoriteHeroCarousel, { type FavoriteHeroItem } from './favorite/FavoriteHeroCarousel';
import FavoriteTopRatedRail from './favorite/FavoriteTopRatedRail';

// The hero carousel leads with up to two "continue watching" videos, then
// rotates through a few random top-rated videos.
const CONTINUE_LIMIT = 2;
const RANDOM_FEATURED_LIMIT = 3;
// A video within this fraction of the end counts as finished, so it never
// resurfaces as "continue watching".
const FINISHED_RATIO = 0.95;

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

// Playback progress the player would actually resume from. Visitor accounts (and
// any failed/offline server save) only have progress in the local resume store,
// so relying on video.progress alone would drop those videos from the hero.
const getEffectiveProgress = (video: Video): number =>
    getBestVideoResumeProgress(video.id, video.progress, video.progressUpdatedAt);

// Most recent playback activity, used to order the continue-watching videos.
// Prefer whichever of the server or local resume timestamps is newer.
const getProgressTimestamp = (video: Video): number => {
    const serverTimestamp = video.progressUpdatedAt ?? video.lastPlayedAt ?? 0;
    const localTimestamp = readVideoResumeProgress(video.id)?.updatedAt ?? 0;
    return Math.max(serverTimestamp, localTimestamp);
};

// A video is resumable when it has meaningful progress that hasn't reached the
// (near) end. Finished videos already have their progress reset to 0 upstream.
const isUnfinished = (video: Video): boolean => {
    const progress = getEffectiveProgress(video);
    if (progress <= 0) return false;
    const duration = parseDuration(video.duration);
    if (duration > 0 && progress / duration >= FINISHED_RATIO) return false;
    return true;
};

const getSecureRandomIndex = (upperBound: number): number => {
    // Avoid modulo bias by discarding values above the largest multiple of the
    // upper bound. This keeps the Fisher–Yates shuffle uniform.
    const limit = Math.floor(0x1_0000_0000 / upperBound) * upperBound;
    const value = new Uint32Array(1);
    do {
        crypto.getRandomValues(value);
    } while (value[0] >= limit);
    return value[0] % upperBound;
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

    // Lead the hero with the user's most recently watched, still-unfinished
    // videos so they can pick up where they left off.
    const continueWatchingVideos = useMemo(
        () => (Array.isArray(videos) ? videos : [])
            .filter(isUnfinished)
            .sort((a, b) => getProgressTimestamp(b) - getProgressTimestamp(a))
            .slice(0, CONTINUE_LIMIT),
        [videos],
    );

    // Follow the continue-watching videos with a random handful of top-rated
    // videos (excluding any already shown, to avoid duplicate carousel slides).
    const randomFeaturedVideos = useMemo(() => {
        const continueIds = new Set(continueWatchingVideos.map((video) => video.id));
        const pool = topRatedVideos.filter((video) => !continueIds.has(video.id));
        for (let i = pool.length - 1; i > 0; i -= 1) {
            const j = getSecureRandomIndex(i + 1);
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, RANDOM_FEATURED_LIMIT);
    }, [topRatedVideos, continueWatchingVideos]);

    const featuredItems = useMemo<FavoriteHeroItem[]>(() => {
        const findCollection = (video: Video) => favoriteCollections.data?.find((favorite) => {
            const collection = collections.find((candidate) => candidate.id === favorite.collectionId);
            return collection?.videos.includes(video.id);
        });
        return [
            ...continueWatchingVideos.map((video) => ({
                video,
                collection: findCollection(video),
                variant: 'continue' as const,
            })),
            ...randomFeaturedVideos.map((video) => ({
                video,
                collection: findCollection(video),
                variant: 'featured' as const,
            })),
        ];
    }, [collections, favoriteCollections.data, continueWatchingVideos, randomFeaturedVideos]);

    const favoriteCollectionItems = favoriteCollections.data ?? [];
    const favoriteAuthorItems = favoriteAuthors.data ?? [];
    const hasContent = Boolean(featuredItems.length || favoriteCollectionItems.length || favoriteAuthorItems.length);
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
                                onUnfavorite={(favorite) => favoriteAuthors.toggle({ author: favorite.author })}
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
