import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import { Box, IconButton, useMediaQuery, useTheme } from '@mui/material';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { neutral, overlay } from '../../theme/colors';
import type { FavoriteCollectionItem, Video } from '../../types';
import FavoriteHero from './FavoriteHero';

export interface FavoriteHeroItem {
    video: Video;
    collection?: FavoriteCollectionItem;
    // 'continue' renders a "Continue watching" chip and a playback progress
    // line; 'featured' is the default top-rated presentation.
    variant?: 'continue' | 'featured';
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
    const theme = useTheme();
    const isReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [slideDirection, setSlideDirection] = useState(1);
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const suppressClick = useRef(false);
    const suppressClickTimer = useRef<number | null>(null);
    const count = items.length;

    // Clear the pending suppress-click reset on unmount.
    useEffect(() => () => {
        if (suppressClickTimer.current) window.clearTimeout(suppressClickTimer.current);
    }, []);

    // Keep the index valid if the favorites list shrinks under us.
    useEffect(() => {
        if (index >= count && count > 0) setIndex(0);
    }, [count, index]);

    const go = useCallback((next: number, direction = 1) => {
        setSlideDirection(direction);
        setIndex(((next % count) + count) % count);
    }, [count]);

    const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || !isMobile || count <= 1) return;

        const touch = event.changedTouches[0];
        const horizontalDistance = touch.clientX - start.x;
        const verticalDistance = touch.clientY - start.y;

        // Keep natural page scrolling intact; only deliberate horizontal swipes
        // change slides.
        if (Math.abs(horizontalDistance) < 48 || Math.abs(horizontalDistance) <= Math.abs(verticalDistance)) return;

        // Suppress the synthetic click that some browsers dispatch after the
        // swipe, but auto-clear shortly after so the flag never lingers to
        // swallow the user's next genuine tap when no such click fires.
        suppressClick.current = true;
        if (suppressClickTimer.current) window.clearTimeout(suppressClickTimer.current);
        suppressClickTimer.current = window.setTimeout(() => {
            suppressClick.current = false;
            suppressClickTimer.current = null;
        }, 400);
        if (horizontalDistance < 0) {
            go(index + 1, 1);
        } else {
            go(index - 1, -1);
        }
    };

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
            data-testid="favorite-hero-carousel"
            sx={{
                position: 'relative',
                mx: { xs: -2, md: 0 },
                // Allows vertical page scrolling while keeping horizontal
                // gestures available for the mobile carousel.
                touchAction: isMobile && count > 1 ? 'pan-y' : 'auto',
            }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={() => setPaused(false)}
            onTouchStart={(event) => {
                if (!isMobile || count <= 1) return;
                const touch = event.touches[0];
                touchStart.current = { x: touch.clientX, y: touch.clientY };
            }}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={() => { touchStart.current = null; }}
            onClickCapture={(event) => {
                if (!suppressClick.current) return;
                event.preventDefault();
                event.stopPropagation();
                suppressClick.current = false;
                if (suppressClickTimer.current) {
                    window.clearTimeout(suppressClickTimer.current);
                    suppressClickTimer.current = null;
                }
            }}
        >
            <motion.div
                key={current.video.id}
                initial={isReducedMotion ? false : { opacity: 0, x: slideDirection * 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={isReducedMotion ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
            >
                <FavoriteHero video={current.video} collection={current.collection} variant={current.variant} />
            </motion.div>

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
                        onClick={() => go(safeIndex - 1, -1)}
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
                                onClick={() => go(dotIndex, dotIndex >= safeIndex ? 1 : -1)}
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
                        onClick={() => go(safeIndex + 1, 1)}
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
