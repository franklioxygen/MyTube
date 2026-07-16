import { Avatar, Box, CardContent, Typography, useMediaQuery, useTheme } from '@mui/material';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import { Video } from '../../types';
import { authorAvatarFallbackSx } from '../../utils/authorAvatarStyles';
import { formatRelativeDownloadTime } from '../../utils/formatUtils';
import { VideoCardCollectionInfo } from '../../utils/videoCardUtils';

const DATE_COLLAPSE_MS = 300; // duration of the date show/hide transition

interface VideoCardContentProps {
    video: Video;
    collectionInfo: VideoCardCollectionInfo;
    onAuthorClick: (e: React.MouseEvent) => void;
    isHovered?: boolean;
}

export const VideoCardContent: React.FC<VideoCardContentProps> = ({
    video,
    collectionInfo,
    onAuthorClick,
    isHovered = false
}) => {
    const { t } = useLanguage();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const avatarUrl = useCloudStorageUrl(video.authorAvatarPath, 'thumbnail');

    const authorContainerRef = useRef<HTMLDivElement>(null);
    const authorTextRef = useRef<HTMLSpanElement>(null);
    const animationRef = useRef<Animation | null>(null);
    const [isTruncated, setIsTruncated] = useState(false);

    const dateWrapRef = useRef<HTMLDivElement>(null);
    const [dateWidth, setDateWidth] = useState<number | null>(null);

    const marqueeing = isHovered && isTruncated;
    // Whether the date has finished collapsing/expanding, so the author container
    // is at its final width for the marquee to measure against.
    const [layoutSettled, setLayoutSettled] = useState(false);

    // Truncation is only meaningful in the resting layout (date visible). Once we
    // start marqueeing we free the date's space, which changes the container width;
    // measuring then would flip isTruncated off and oscillate the layout. This ref
    // keeps measurement pinned to the non-marqueeing state.
    const isMarqueeingRef = useRef(false);
    isMarqueeingRef.current = marqueeing;

    // Measure whether the author name overflows its (clipped) container.
    const measureTruncation = useCallback(() => {
        if (isMarqueeingRef.current) return;
        const container = authorContainerRef.current;
        const text = authorTextRef.current;
        if (!container || !text) return;
        setIsTruncated(text.scrollWidth - container.clientWidth > 1);
    }, []);

    useEffect(() => {
        measureTruncation();
    }, [measureTruncation, video.author]);

    // Re-measure when the card layout changes (resize, sidebar, etc.) — but only
    // in the resting state, see isMarqueeingRef above.
    useEffect(() => {
        const container = authorContainerRef.current;
        if (!container || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => {
            if (!isMarqueeingRef.current) measureTruncation();
        });
        ro.observe(container);
        return () => ro.disconnect();
    }, [measureTruncation]);

    // Measure the date's natural width once (and when its text changes) so we can
    // smoothly animate its width to 0 when the name scrolls.
    useLayoutEffect(() => {
        const el = dateWrapRef.current;
        if (el) setDateWidth(el.scrollWidth);
    }, [video.addedAt, video.date, t]);

    // Flip layoutSettled only after the date collapse/expand transition finishes,
    // so the marquee measures scroll distance against the final container width.
    useEffect(() => {
        if (marqueeing) {
            const id = setTimeout(() => setLayoutSettled(true), DATE_COLLAPSE_MS);
            return () => clearTimeout(id);
        }
        setLayoutSettled(false);
    }, [marqueeing]);

    // Scroll the name left then right while hovered, holding ~1s at each end.
    useEffect(() => {
        const container = authorContainerRef.current;
        const text = authorTextRef.current;
        if (!container || !text) return;

        animationRef.current?.cancel();
        animationRef.current = null;

        if (!layoutSettled) {
            text.style.transform = '';
            return;
        }

        const overflow = text.scrollWidth - container.clientWidth;
        if (overflow <= 1 || typeof text.animate !== 'function') {
            text.style.transform = '';
            return;
        }

        const pxPerSecond = 30; // scroll speed
        const moveMs = Math.max(600, (overflow / pxPerSecond) * 1000);
        const holdMs = 1000; // dwell at the beginning and ending
        const totalMs = moveMs * 2 + holdMs * 2;
        const holdFrac = holdMs / totalMs;
        const moveFrac = moveMs / totalMs;
        const endOffset = holdFrac + moveFrac; // start of the ending hold

        animationRef.current = text.animate(
            [
                { transform: 'translateX(0)', offset: 0 },
                { transform: 'translateX(0)', offset: holdFrac }, // hold at beginning
                { transform: `translateX(${-overflow}px)`, offset: endOffset },
                { transform: `translateX(${-overflow}px)`, offset: endOffset + holdFrac }, // hold at ending
                { transform: 'translateX(0)', offset: 1 } // scroll back to beginning
            ],
            { duration: totalMs, iterations: Infinity, easing: 'linear' }
        );

        return () => {
            animationRef.current?.cancel();
            animationRef.current = null;
        };
    }, [layoutSettled, video.author]);

    return (
        <CardContent sx={{ flexGrow: 1, px: 1, py: isMobile ? 1.5 : 1, display: 'flex', flexDirection: 'column' }}>
            <Typography 
                gutterBottom 
                variant="subtitle1" 
                component="div" 
                sx={{ 
                    fontWeight: 600, 
                    lineHeight: 1.2, 
                    mb: 1, 
                    display: '-webkit-box', 
                    WebkitLineClamp: 2, 
                    WebkitBoxOrient: 'vertical', 
                    overflow: 'hidden' 
                }}
            >
                {collectionInfo.isFirstInAnyCollection ? (
                    <>
                        {collectionInfo.firstInCollectionNames[0]}
                        {collectionInfo.firstInCollectionNames.length > 1 && (
                            <Typography 
                                component="span" 
                                color="text.secondary" 
                                sx={{ fontSize: 'inherit' }}
                            >
                                {' '}+{collectionInfo.firstInCollectionNames.length - 1}
                            </Typography>
                        )}
                    </>
                ) : (
                    video.title
                )}
            </Typography>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 'auto', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
                    <Avatar
                        src={avatarUrl || undefined}
                        onClick={onAuthorClick}
                        sx={[authorAvatarFallbackSx, {
                            width: 24,
                            height: 24,
                            mr: 0.75,
                            fontSize: '0.75rem',
                            cursor: 'pointer'
                        }]}
                    >
                        {video.author ? video.author.charAt(0).toUpperCase() : 'A'}
                    </Avatar>
                    <Box
                        ref={authorContainerRef}
                        onClick={onAuthorClick}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            minWidth: 0, // Allows flex item to shrink below content size
                            flex: 1,
                            overflow: 'hidden',
                            cursor: 'pointer'
                        }}
                    >
                        <Typography
                            ref={authorTextRef}
                            component="span"
                            variant="body2"
                            color="text.secondary"
                            sx={{
                                whiteSpace: 'nowrap',
                                fontWeight: 500,
                                '&:hover': { color: 'primary.main' },
                                // When marqueeing, let the text take its natural width so it
                                // can scroll; otherwise shrink+ellipsis like a normal card.
                                ...(marqueeing
                                    ? { flex: '0 0 auto' }
                                    : { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' })
                            }}
                        >
                            {video.author}
                        </Typography>
                    </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {/* While the name scrolls, the date smoothly collapses (width + opacity)
                        so the name can expand into this space. Views stays. */}
                    <Box
                        ref={dateWrapRef}
                        sx={{
                            display: 'flex',
                            overflow: 'hidden',
                            maxWidth: dateWidth == null
                                ? 'none'
                                : marqueeing
                                    ? 0
                                    : dateWidth,
                            opacity: marqueeing ? 0 : 1,
                            transition: `max-width ${DATE_COLLAPSE_MS}ms ease, opacity ${DATE_COLLAPSE_MS}ms ease`
                        }}
                    >
                        <Typography variant="caption" color="text.secondary" sx={{ flex: '0 0 auto' }}>
                            {formatRelativeDownloadTime(video.addedAt, video.date, t)}
                        </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {video.viewCount || 0} {t('views')}
                    </Typography>
                </Box>
            </Box>
        </CardContent>
    );
};
