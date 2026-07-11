import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import { Box, Fade, IconButton, useMediaQuery } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { neutral, overlay } from '../../theme/colors';
import type { FavoriteCollectionItem, Video } from '../../types';
import FavoriteHero from './FavoriteHero';

export interface FavoriteHeroItem {
    video: Video;
    collection?: FavoriteCollectionItem;
}

interface FavoriteHeroCarouselProps {
    items: FavoriteHeroItem[];
}

const AUTO_ADVANCE_MS = 7000;

/**
 * Rotating Featured hero: cycles through the top 5-star videos. Auto-advances
 * on a gentle timer that pauses on hover/focus and is disabled under
 * prefers-reduced-motion. Manual prev/next arrows and clickable dots sit in a
 * compact pill at the top-right so they never collide with the hero content.
 */
const FavoriteHeroCarousel: React.FC<FavoriteHeroCarouselProps> = ({ items }) => {
    const { t } = useLanguage();
    const isReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const count = items.length;

    // Keep the index valid if the favorites list shrinks under us.
    useEffect(() => {
        if (index >= count && count > 0) setIndex(0);
    }, [count, index]);

    const go = useCallback((next: number) => {
        setIndex(((next % count) + count) % count);
    }, [count]);

    useEffect(() => {
        if (isReducedMotion || paused || count <= 1) return undefined;
        const id = window.setInterval(() => {
            setIndex((current) => (current + 1) % count);
        }, AUTO_ADVANCE_MS);
        return () => window.clearInterval(id);
    }, [isReducedMotion, paused, count]);

    if (count === 0) return null;

    const safeIndex = Math.min(index, count - 1);
    const current = items[safeIndex];

    return (
        <Box
            // On mobile, break out of FavoritePage's `px: 2` so the hero spans
            // the full screen width edge-to-edge; unchanged on desktop.
            sx={{ position: 'relative', mx: { xs: -2, md: 0 } }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={() => setPaused(false)}
        >
            <Fade in key={current.video.id} timeout={isReducedMotion ? 0 : 450} appear>
                <Box>
                    <FavoriteHero video={current.video} collection={current.collection} />
                </Box>
            </Fade>

            {count > 1 && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        zIndex: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        px: 0.5,
                        py: 0.25,
                        borderRadius: 999,
                        bgcolor: overlay.black55,
                        backdropFilter: 'blur(6px)',
                    }}
                >
                    <IconButton
                        size="small"
                        aria-label={t('previous')}
                        onClick={() => go(safeIndex - 1)}
                        sx={{ color: neutral.white, p: 0.5 }}
                    >
                        <ChevronLeft fontSize="small" />
                    </IconButton>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.25 }}>
                        {items.map((item, dotIndex) => (
                            <Box
                                key={item.video.id}
                                component="button"
                                type="button"
                                aria-label={`${t('featured')} ${dotIndex + 1}`}
                                aria-current={dotIndex === safeIndex}
                                onClick={() => setIndex(dotIndex)}
                                sx={{
                                    p: 0,
                                    border: 'none',
                                    cursor: 'pointer',
                                    width: dotIndex === safeIndex ? 18 : 7,
                                    height: 7,
                                    borderRadius: 999,
                                    transition: 'width 0.25s ease, background-color 0.25s ease',
                                    bgcolor: dotIndex === safeIndex ? neutral.white : overlay.white32,
                                }}
                            />
                        ))}
                    </Box>
                    <IconButton
                        size="small"
                        aria-label={t('next')}
                        onClick={() => go(safeIndex + 1)}
                        sx={{ color: neutral.white, p: 0.5 }}
                    >
                        <ChevronRight fontSize="small" />
                    </IconButton>
                </Box>
            )}
        </Box>
    );
};

export default FavoriteHeroCarousel;
