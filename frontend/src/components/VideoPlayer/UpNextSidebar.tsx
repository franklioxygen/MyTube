import {
    Add
} from '@mui/icons-material';
import {
    Box,
    Card,
    CardContent,
    CardMedia,
    Chip,
    FormControlLabel,
    Grid,
    IconButton,
    Skeleton,
    Stack,
    Switch,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useVisitorMode } from '../../contexts/VisitorModeContext';
import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import { Video } from '../../types';
import { formatDate, formatDuration } from '../../utils/formatUtils';

interface UpNextSidebarProps {
    relatedVideos: Video[];
    autoPlayNext: boolean;
    onAutoPlayNextChange: (checked: boolean) => void;
    onVideoClick: (videoId: string) => void;
    onAddToCollection: (videoId: string) => void;
}

const SidebarThumbnail: React.FC<{ video: Video }> = ({ video }) => {
    const [isImageLoaded, setIsImageLoaded] = useState(false);
    // Only load thumbnail from cloud if the video itself is in cloud storage
    const isVideoInCloud = video.videoPath?.startsWith('cloud:') ?? false;
    const thumbnailPathForCloud = isVideoInCloud ? video.thumbnailPath : null;
    const thumbnailUrl = useCloudStorageUrl(thumbnailPathForCloud, 'thumbnail');
    const localThumbnailUrl = !isVideoInCloud && video.thumbnailPath
        ? `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5551'}${video.thumbnailPath}`
        : undefined;

    return (
        <Box sx={{ width: 168, minWidth: 168, position: 'relative' }}>
            {!isImageLoaded && (
                <Skeleton
                    variant="rectangular"
                    width="100%"
                    height={94}
                    animation="wave"
                    sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        bgcolor: 'grey.800'
                    }}
                />
            )}
            <CardMedia
                component="img"
                loading="lazy"
                sx={{
                    width: '100%',
                    height: 94,
                    objectFit: 'cover',
                    opacity: isImageLoaded ? 1 : 0,
                    transition: 'opacity 0.2s',
                    // The image is always rendered but hidden until loaded
                }}
                onLoad={() => setIsImageLoaded(true)}
                image={thumbnailUrl || localThumbnailUrl || video.thumbnailUrl || 'https://via.placeholder.com/168x94?text=No+Thumbnail'}
                alt={video.title}
                onError={(e) => {
                    setIsImageLoaded(true);
                    const target = e.target as HTMLImageElement;
                    target.onerror = null;
                    target.src = 'https://via.placeholder.com/168x94?text=No+Thumbnail';
                }}
            />
            {video.duration && (
                <Chip
                    label={formatDuration(video.duration)}
                    size="small"
                    sx={{
                        position: 'absolute',
                        bottom: 4,
                        right: 4,
                        height: 20,
                        fontSize: '0.75rem',
                        bgcolor: 'rgba(0,0,0,0.8)',
                        color: 'white'
                    }}
                />
            )}
        </Box>
    );
};

const UpNextSidebar: React.FC<UpNextSidebarProps> = ({
    relatedVideos,
    autoPlayNext,
    onAutoPlayNextChange,
    onVideoClick,
    onAddToCollection
}) => {
    const { t } = useLanguage();
    const { visitorMode } = useVisitorMode();
    const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    const handleAddToCollectionClick = (e: React.MouseEvent, videoId: string) => {
        e.stopPropagation();
        onAddToCollection(videoId);
    };

    return (
        <Box sx={{ p: { xs: 2, md: 0 }, pt: { xs: 2, md: 0 } }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight="bold" sx={{ mb: 0 }}>{t('upNext')}</Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={autoPlayNext}
                            onChange={(e) => onAutoPlayNextChange(e.target.checked)}
                            size="small"
                        />
                    }
                    label={<Typography variant="body2">{t('autoPlayNext')}</Typography>}
                    labelPlacement="start"
                    sx={{ ml: 0, mr: 0 }}
                />
            </Stack>
            <Grid container spacing={2}>
                {relatedVideos.map(relatedVideo => (
                    <Grid key={relatedVideo.id} size={{ xs: 12, md: 6, lg: 12 }}>
                        <Card
                            sx={{ display: 'flex', cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, position: 'relative' }}
                            onClick={() => onVideoClick(relatedVideo.id)}
                            onMouseEnter={() => setHoveredVideoId(relatedVideo.id)}
                            onMouseLeave={() => setHoveredVideoId(null)}
                        >
                            <SidebarThumbnail video={relatedVideo} />

                            <CardContent sx={{ flex: '1 1 auto', minWidth: 0, p: 1, '&:last-child': { pb: 1 }, position: 'relative', display: 'flex', flexDirection: 'column' }}>
                                <Typography variant="body2" fontWeight="bold" sx={{ lineHeight: 1.2, mb: 0.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {relatedVideo.title}
                                </Typography>
                                <Typography variant="caption" display="block" color="text.secondary">
                                    {relatedVideo.author}
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', mt: 'auto' }}>
                                    <Typography variant="caption" color="text.secondary">
                                        {formatDate(relatedVideo.date)}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                        ·  {relatedVideo.viewCount || 0} {t('views')}
                                    </Typography>
                                </Box>

                                {hoveredVideoId === relatedVideo.id && !isMobile && !isTouch && !visitorMode && (
                                    <Tooltip title={t('addToCollection')} disableHoverListener={isTouch}>
                                        <IconButton
                                            size="small"
                                            onClick={(e) => handleAddToCollectionClick(e, relatedVideo.id)}
                                            sx={{
                                                position: 'absolute',
                                                bottom: 4,
                                                right: 4,
                                                padding: 0.5,
                                                bgcolor: 'rgba(0,0,0,0.9)',
                                            }}
                                        >
                                            <Add fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>
            {relatedVideos.length === 0 && (
                <Typography variant="body2" color="text.secondary">{t('noOtherVideos')}</Typography>
            )}
        </Box>
    );
};

export default UpNextSidebar;
