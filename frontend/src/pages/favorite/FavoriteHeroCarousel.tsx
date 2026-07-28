import { ChevronLeft, ChevronRight, CollectionsBookmark } from '@mui/icons-material';
import { Box, IconButton, useMediaQuery, useTheme } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { motion } from 'framer-motion';
import type { MouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
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

type CarouselIndexState = {
    count: number;
    index: number;
};

type CarouselIndexUpdate = number | ((current: number) => number);

const AUTO_ADVANCE_MS = 7000;

const normalizeIndex = (index: number, count: number): number => {
    if (count <= 0) return 0;
    return Math.min(Math.max(index, 0), count - 1);
};

const wrapIndex = (index: number, count: number): number => {
    if (count <= 0) return 0;
    return ((index % count) + count) % count;
};

/**
 * Rotating Featured hero: cycles through the top 5-star videos. Auto-advances
 * on a gentle timer that pauses on hover/focus and is disabled under
 * prefers-reduced-motion. Manual prev/next arrows and clickable dots sit in a
 * compact pill at the top-right so they never collide with the hero content.
 */
const FavoriteHeroCarousel: React.FC<FavoriteHeroCarouselProps> = ({ items }) => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const theme = useTheme();
    const isReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const count = items.length;
    const [indexState, setIndexState] = useState<CarouselIndexState>(() => ({
        count,
        index: 0,
    }));
    const index =
        indexState.count === count
            ? indexState.index
            : normalizeIndex(indexState.index, count);
    const [paused, setPaused] = useState(false);
    const [slideDirection, setSlideDirection] = useState(1);
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const suppressClick = useRef(false);
    const suppressClickTimer = useRef<number | null>(null);

    // Clear the pending suppress-click reset on unmount.
    useEffect(() => () => {
        if (suppressClickTimer.current) window.clearTimeout(suppressClickTimer.current);
    }, []);

    const setCarouselIndex = useCallback((next: CarouselIndexUpdate) => {
        setIndexState((currentState) => {
            const current =
                currentState.count === count
                    ? currentState.index
                    : normalizeIndex(currentState.index, count);
            const nextIndex = typeof next === 'function' ? next(current) : next;

            return {
                count,
                index: wrapIndex(nextIndex, count),
            };
        });
    }, [count]);

    const go = useCallback((next: number, direction = 1) => {
        setSlideDirection(direction);
        setCarouselIndex(next);
    }, [setCarouselIndex]);

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
            setCarouselIndex((current) => current + 1);
        }, AUTO_ADVANCE_MS);
        return () => window.clearInterval(id);
    }, [isReducedMotion, paused, count, setCarouselIndex]);

    if (count === 0) return null;

    const safeIndex = normalizeIndex(index, count);
    const current = items[safeIndex];
    const openCollection = (event: MouseEvent<HTMLButtonElement>) => {
        if (!current.collection) return;
        event.stopPropagation();
        navigate(`/collection/${encodeURIComponent(current.collection.collectionId)}`);
    };
    const renderControls = (
        sx?: SxProps<Theme>,
        { showCarouselNavigation = true }: { showCarouselNavigation?: boolean } = {},
    ) => (
        <Box
            sx={{
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.5,
                py: 0.25,
                borderRadius: 999,
                bgcolor: overlay.black55,
                backdropFilter: 'blur(6px)',
                ...sx,
            }}
        >
            {current.collection && (
                <IconButton
                    size="small"
                    aria-label={t('openCollection')}
                    onClick={openCollection}
                    sx={{
                        color: neutral.white,
                        p: 0.5,
                        borderRight: `1px solid ${overlay.white32}`,
                        borderRadius: 0,
                    }}
                >
                    <CollectionsBookmark fontSize="small" />
                </IconButton>
            )}
            {showCarouselNavigation && (
                <>
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
                </>
            )}
        </Box>
    );
    const shouldShowControls = count > 1 || Boolean(current.collection);
    const carouselControls = shouldShowControls && isMobile
        ? renderControls(undefined, { showCarouselNavigation: count > 1 })
        : undefined;

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
                initial={isReducedMotion ? false : { opacity: 0, x: slideDirection * 6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={isReducedMotion ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }}
            >
                <FavoriteHero
                    video={current.video}
                    collection={current.collection}
                    variant={current.variant}
                    carouselControls={carouselControls}
                />
            </motion.div>

            {shouldShowControls && !isMobile && (
                renderControls({
                    position: 'absolute',
                    top: 12,
                    right: 12,
                }, {
                    showCarouselNavigation: count > 1,
                })
            )}
        </Box>
    );
};

export default FavoriteHeroCarousel;
