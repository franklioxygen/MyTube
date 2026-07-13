import { Star } from '@mui/icons-material';
import { Box, Button, Card, CardMedia, Chip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { brand, neutral, overlay } from '../../theme/colors';
import type { FavoriteCollectionItem, Video } from '../../types';
import { api } from '../../utils/apiClient';
import { formatDuration, parseDuration } from '../../utils/formatUtils';
import { useFavoriteThumbnail } from './useFavoriteThumbnail';

interface FavoriteHeroProps {
    video: Video;
    collection?: FavoriteCollectionItem;
    variant?: 'continue' | 'featured';
}

const FavoriteHero: React.FC<FavoriteHeroProps> = ({ video, collection, variant = 'featured' }) => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const theme = useTheme();
    const isReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const thumbnail = useFavoriteThumbnail(video);

    const isContinue = variant === 'continue';
    // Playback progress as a 0–1 fraction, for the resume line on the thumbnail.
    const durationSeconds = parseDuration(video.duration);
    const progressSeconds = typeof video.progress === 'number' ? video.progress : 0;
    const progressRatio = durationSeconds > 0
        ? Math.min(1, Math.max(0, progressSeconds / durationSeconds))
        : 0;
    const showProgressLine = isContinue && progressRatio > 0;

    // The favorites list projection omits `description` (a heavy free-text
    // column), so fetch the full video record for the featured item to show
    // its description. Shares the ['video', id] cache key with the player and
    // uses the list row as a placeholder for an instant first paint.
    const { data: fullVideo } = useQuery<Video>({
        queryKey: ['video', video.id],
        queryFn: async () => (await api.get(`/videos/${video.id}`)).data,
        placeholderData: video,
        enabled: !!video.id,
        retry: false,
    });
    const description = fullVideo?.description;

    const openVideo = () => navigate(`/video/${encodeURIComponent(video.id)}`);

    return (
        <Box component="section" aria-labelledby="favorite-featured-heading">
            <Card
                sx={{
                    position: 'relative',
                    overflow: 'hidden',
                    // The card is sized entirely by its content — thumbnail, the
                    // two reserved title lines and an optional button — so it has
                    // no empty band under short featured videos on any viewport.
                    // Full-bleed edge-to-edge card on mobile; rounded on desktop.
                    borderRadius: { xs: 0, md: 2 },
                    bgcolor: theme.palette.mode === 'dark' ? 'grey.900' : 'background.paper',
                    border: 'none',
                    transition: isReducedMotion ? 'none' : 'box-shadow 0.3s ease',
                    boxShadow: theme.palette.mode === 'dark'
                        ? '0 12px 40px rgba(0,0,0,0.5)'
                        : '0 12px 40px rgba(0,0,0,0.14)',
                }}
            >
                {/* Blurred backdrop derived from the thumbnail */}
                <Box
                    aria-hidden
                    sx={{
                        position: 'absolute',
                        inset: -32,
                        backgroundImage: `url(${thumbnail})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        filter: 'blur(28px)',
                        opacity: theme.palette.mode === 'dark' ? 0.5 : 0,
                        transform: 'scale(1.1)',
                    }}
                />
                <Box
                    aria-hidden
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        // Dark mode keeps the cinematic thumbnail wash. Light
                        // mode uses a clean paper surface instead of a muddy
                        // dark backdrop against the surrounding page.
                        background: {
                            xs: theme.palette.mode === 'dark'
                                ? `linear-gradient(to top, ${overlay.black90} 0%, ${overlay.black70} 46%, ${overlay.black35} 74%, transparent 100%)`
                                : 'linear-gradient(to bottom, rgba(255,255,255,0.96), rgba(255,255,255,0.9))',
                            md: theme.palette.mode === 'dark'
                                ? `linear-gradient(105deg, ${overlay.black90} 0%, ${overlay.black70} 42%, ${overlay.black35} 72%, transparent 100%)`
                                : 'linear-gradient(105deg, rgba(255,255,255,0.98), rgba(255,255,255,0.92))',
                        },
                    }}
                />
                <Box
                    sx={{
                        position: 'relative',
                        zIndex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: { xs: 2, md: 3.5 },
                        p: { xs: 2, md: 3.5 },
                        flexDirection: { xs: 'column', md: 'row' },
                    }}
                >
                    {/* Clickable thumbnail → opens the video */}
                    <Box
                        role="button"
                        tabIndex={0}
                        aria-label={`${t('play')} — ${video.title}`}
                        onClick={openVideo}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openVideo();
                            }
                        }}
                        sx={{
                            position: 'relative',
                            width: { xs: '100%', md: '48%' },
                            flexShrink: 0,
                            borderRadius: 2,
                            overflow: 'hidden',
                            cursor: 'pointer',
                            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
                            '&:focus-visible': { outline: `2px solid ${brand.primaryDark}`, outlineOffset: 2 },
                        }}
                    >
                        <CardMedia
                            component="img"
                            className="hero-img"
                            image={thumbnail}
                            alt={video.title}
                            sx={{
                                width: '100%',
                                aspectRatio: '16 / 9',
                                objectFit: 'cover',
                                display: 'block',
                            }}
                        />
                        {/* Featured / Continue Watching badge pinned to the top-right corner */}
                        <Chip
                            icon={<Star sx={{ fontSize: 15 }} />}
                            label={isContinue ? t('continueWatching') : t('featured')}
                            size="small"
                            id="favorite-featured-heading"
                            sx={{
                                position: 'absolute',
                                // On mobile, sit level with the carousel indicator
                                // pill (which anchors to the carousel's top: 12);
                                // the chip's top: 0 lines their centers up.
                                top: { xs: 0, md: 8 },
                                left: 8,
                                fontWeight: 700,
                                letterSpacing: 0.6,
                                textTransform: 'uppercase',
                                color: neutral.white,
                                background: `linear-gradient(135deg, ${brand.primaryDark}, ${brand.secondary})`,
                                '& .MuiChip-icon': { color: neutral.white },
                            }}
                        />
                        {video.duration && (
                            <Chip
                                label={formatDuration(video.duration)}
                                size="small"
                                sx={{ position: 'absolute', bottom: 8, right: 8, height: 22, bgcolor: overlay.black75, color: neutral.white, fontWeight: 600 }}
                            />
                        )}
                        {/* Resume progress line pinned to the bottom edge */}
                        {showProgressLine && (
                            <Box
                                aria-hidden
                                sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '2px', bgcolor: overlay.black55 }}
                            >
                                <Box
                                    sx={{
                                        height: '100%',
                                        width: `${progressRatio * 100}%`,
                                        background: `linear-gradient(135deg, ${brand.primaryDark}, ${brand.secondary})`,
                                    }}
                                />
                            </Box>
                        )}
                    </Box>

                    <Box sx={{ color: theme.palette.mode === 'dark' ? neutral.white : 'text.primary', maxWidth: 620, width: { xs: '100%', md: 'auto' } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25, flexWrap: 'wrap' }}>
                            <Typography
                                sx={{
                                    color: theme.palette.mode === 'dark' ? overlay.white80 : 'text.secondary',
                                    fontWeight: 500,
                                }}
                            >
                                {video.author || t('unknownAuthor')}
                            </Typography>
                        </Box>
                        <Typography
                            variant="h5"
                            component="h2"
                            fontWeight={800}
                            sx={{
                                lineHeight: 1.2,
                                // Reserve two title lines even for a shorter
                                // title; allow up to three lines on desktop.
                                minHeight: '2.4em',
                                display: '-webkit-box',
                                overflow: 'hidden',
                                WebkitBoxOrient: 'vertical',
                                WebkitLineClamp: { xs: 2, md: 3 },
                                // Break long unbreakable runs (URLs, hashtag
                                // strings) so the clamp wraps instead of
                                // overflowing the card horizontally.
                                overflowWrap: 'anywhere',
                                wordBreak: 'break-word',
                            }}
                        >
                            {video.title}
                        </Typography>
                        {/* Short description, desktop only, clamped to three lines */}
                        {description && (
                            <Typography
                                variant="body2"
                                sx={{
                                    display: { xs: 'none', md: '-webkit-box' },
                                    mt: 1,
                                    color: theme.palette.mode === 'dark' ? overlay.white80 : 'text.secondary',
                                    lineHeight: 1.4,
                                    overflow: 'hidden',
                                    WebkitBoxOrient: 'vertical',
                                    WebkitLineClamp: 3,
                                    // Break long unbreakable runs so the clamp
                                    // wraps instead of overflowing horizontally.
                                    overflowWrap: 'anywhere',
                                    wordBreak: 'break-word',
                                }}
                            >
                                {description}
                            </Typography>
                        )}
                        {collection && (
                            <Box sx={{ display: 'flex', gap: 1.5, mt: 2.5, flexWrap: 'wrap' }}>
                                <Button
                                    variant="outlined"
                                    sx={theme.palette.mode === 'dark'
                                        ? { color: neutral.white, borderColor: overlay.white70, '&:hover': { borderColor: neutral.white, bgcolor: overlay.white10 } }
                                        : undefined}
                                    onClick={() => navigate(`/collection/${encodeURIComponent(collection.collectionId)}`)}
                                >
                                    {t('openCollection')}
                                </Button>
                            </Box>
                        )}
                    </Box>
                </Box>
            </Card>
        </Box>
    );
};

export default FavoriteHero;
