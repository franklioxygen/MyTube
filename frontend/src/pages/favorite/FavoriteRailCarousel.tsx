import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import { Box, IconButton } from '@mui/material';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { neutral, overlay } from '../../theme/colors';
import { railScrollerSx } from './favoriteRailStyles';

interface FavoriteRailCarouselProps {
    children: ReactNode;
    prevLabel: string;
    nextLabel: string;
}

const ArrowButton: React.FC<{
    side: 'left' | 'right';
    label: string;
    onClick: () => void;
}> = ({ side, label, onClick }) => (
    <Box
        className="rail-arrow"
        sx={{
            position: 'absolute',
            top: '50%',
            [side]: 0,
            transform: 'translateY(-50%)',
            // Desktop-only affordance; mobile uses native swipe.
            display: { xs: 'none', md: 'flex' },
            opacity: 0,
            transition: 'opacity 0.2s ease',
            zIndex: 5,
        }}
    >
        <IconButton
            aria-label={label}
            onClick={onClick}
            sx={{
                bgcolor: overlay.black70,
                color: neutral.white,
                backdropFilter: 'blur(4px)',
                boxShadow: 4,
                '&:hover': { bgcolor: overlay.black80 },
            }}
        >
            {side === 'left' ? <ChevronLeft /> : <ChevronRight />}
        </IconButton>
    </Box>
);

/**
 * Wraps a horizontal rail with hover-reveal prev/next arrows on desktop. Arrows
 * only appear when the rail actually overflows, and each side hides once you
 * reach that end. Native scroll/swipe is preserved underneath (and is the sole
 * control on mobile).
 */
const FavoriteRailCarousel: React.FC<FavoriteRailCarouselProps> = ({
    children,
    prevLabel,
    nextLabel,
}) => {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const [canLeft, setCanLeft] = useState(false);
    const [canRight, setCanRight] = useState(false);

    const update = useCallback(() => {
        const el = scrollerRef.current;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        setCanLeft(el.scrollLeft > 1);
        setCanRight(el.scrollLeft < max - 1);
    }, []);

    useEffect(() => {
        update();
        const el = scrollerRef.current;
        if (!el) return undefined;
        const observer =
            typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        observer?.observe(el);
        window.addEventListener('resize', update);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', update);
        };
    }, [update, children]);

    const scrollByPage = (direction: -1 | 1) => {
        const el = scrollerRef.current;
        if (!el) return;
        el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
    };

    return (
        <Box sx={{ position: 'relative', '&:hover .rail-arrow': { opacity: 1 } }}>
            <Box ref={scrollerRef} onScroll={update} sx={railScrollerSx} data-testid="rail-scroller">
                {children}
            </Box>
            {canLeft && <ArrowButton side="left" label={prevLabel} onClick={() => scrollByPage(-1)} />}
            {canRight && <ArrowButton side="right" label={nextLabel} onClick={() => scrollByPage(1)} />}
        </Box>
    );
};

export default FavoriteRailCarousel;
